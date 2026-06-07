/**
 * serpOpportunityDetectionService.ts
 *
 * SERP-based white-space / opportunity detection. Replaced the legacy fixed
 * four-publisher scrape. Validates each
 * opportunity keyword against real search-engine results (via a SERP provider),
 * counts distinct competing syndicated-report domains across multiple signal
 * types, and produces a deterministic GREEN / YELLOW / RED classification mapped
 * onto the existing whiteSpace* contract consumed by actionClassificationEngine.
 *
 * This module is structured as a pure functional core (normalize → match →
 * classify → extract → count → rubric → field mapping) plus a thin I/O shell
 * (provider, cache, budget). Tasks 2–8 add the functions; this file (Task 1.4)
 * establishes the shared internal types and the single source-of-truth config.
 */

import type { SerpSignalType, OpportunityClass, ReportSuggestion } from '../types';
import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL TYPES (pure-core data shapes)
// ─────────────────────────────────────────────────────────────────────────────

export interface SerpOrganicResult {
  title: string;
  link: string;                // full URL
  domain: string;              // host extracted from link
  snippet?: string;
  hasReportSchema?: boolean;   // schema.org Report/Product observed (R3.4)
  isPaywalled?: boolean;       // R4.4
}

export interface SerpResponse {
  keyword: string;
  organic: SerpOrganicResult[];
  ads: SerpOrganicResult[];          // R3.2 paid block
  aiOverviewSources: string[];       // cited domains from AI Overview (R3.3)
}

export interface ResultClassification {
  domain: string;
  isCompetitorReport: boolean;
  matchedSignals: SerpSignalType[];
  excludedReason?: 'blog' | 'no_indicator' | 'own_domain';
}

export interface SignalExtraction {
  perResult: ResultClassification[];
  aiOverviewDomains: string[];
  signalTypesPresent: SerpSignalType[];
}

export interface Classification {
  opportunityClass: OpportunityClass;
  score: number;                       // White_Space_Score 0–100
  reason: 'gap' | 'partial' | 'crowded' | 'commoditised' | 'unknown';
}

export interface CachedClassification {
  keyword: string;
  classification: Classification;
  domains: string[];
  signals: SerpSignalType[];
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING_RUBRIC — single source of truth for thresholds, bands, and indicators.
// No numeric thresholds or band values may be inlined elsewhere in the
// classification path (R2.6, R11.3).
// ─────────────────────────────────────────────────────────────────────────────

export const SCORING_RUBRIC = {
  // Competitor_Count → Opportunity_Class partition (R2.1–2.4).
  thresholds: {
    greenMax: 0,    // count === 0            → GREEN (gap)
    yellowMax: 2,   // 1..2                   → YELLOW (partial)
    crowdedMax: 6,  // 3..6                   → RED (crowded); >= 7 → RED (commoditised)
  },
  // White_Space_Score bands (R6.1–6.3): GREEN >= 75, YELLOW 40..74, RED < 40.
  scoreBands: {
    greenBase: 85,
    yellowBase: 55,
    redBase: 25,
  },
  // Report indicators (R3.7, R4.1): a result is a Competitor_Report only if it
  // exhibits at least one of these.
  reportIndicators: {
    titlePatterns: [/market\s+size/i, /market\s+share/i, /market\s+forecast/i],
    reportUrlPaths: [/\/(industry-)?report/i, /\/market-report/i, /-market\b/i],
    pdfMarkers: [/\.pdf($|\?)/i],
  },
  // Blog/news/article URL patterns excluded unconditionally (R4.2).
  blogPatterns: [/\/blog\//i, /\/news\//i, /\/article(s)?\//i, /\/press-release/i],
  // Report-marketplace aggregator domains counted as Competitor_Reports (R3.5).
  reportMarketplaces: ['researchandmarkets.com', 'reportlinker.com', 'marketresearch.com'],
  // Kaiso's own domains, always excluded from Competitor_Count (R4.5).
  ownDomains: ['kaiso'],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RUN_CONTROL — cost/rate/cache configuration, env-overridable with defaults.
// runBudget is clamped to >= 1 (R9.1).
// ─────────────────────────────────────────────────────────────────────────────

export const RUN_CONTROL = {
  runBudget: Math.max(1, Number(process.env.SERP_RUN_BUDGET ?? 12)),          // R9.1
  interCallDelayMs: Math.max(0, Number(process.env.SERP_DELAY_MS ?? 1200)),   // R9.3
  refreshWindowMs: Number(process.env.SERP_REFRESH_MS ?? 7 * 24 * 60 * 60 * 1000), // R8.4 (7d)
  cachePath: process.env.SERP_CACHE_PATH ?? '/tmp/serp-cache.json',           // R8.5
} as const;

/** The rubric shape, derived from the single source-of-truth object so the pure
 * core can be unit-tested with the real config or a stub of the same shape. */
export type ScoringRubric = typeof SCORING_RUBRIC;

// ─────────────────────────────────────────────────────────────────────────────
// PURE CORE — keyword normalization, title matching, derivation, domain extract.
// Deterministic, no I/O. Property-tested (Properties 3–6).
// ─────────────────────────────────────────────────────────────────────────────

/** Generic stopwords for token-set title matching (R5.2). Intentionally small
 * so genuine report tokens are never discarded. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'in', 'on', 'to', 'by', 'with', '&',
]);

/** Canonicalize a single token to a singular form so plural/singular variants
 * compare equal (R5.3). Strips a single trailing "s" (but not "-ss" words like
 * "business"); short words are left untouched. */
function singularize(token: string): string {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss')
    ? token.slice(0, -1)
    : token;
}

/** Tokenize free text into a canonical content-token set: lowercase, split on
 * non-alphanumerics, drop stopwords, singularize. Shared by title matching. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(singularize);
}

/**
 * R5.1 / Property 3 — normalize a raw keyword to the canonical Search_Keyword:
 * lowercase, trim, collapse internal whitespace, strip every leading "global"
 * and trailing "market"/"industry" qualifier. Idempotent by construction (all
 * qualifiers are stripped in a single call, so a second call is a no-op).
 */
export function normalizeKeyword(raw: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^global\s+/, '').trim();
  } while (s !== prev);
  do {
    prev = s;
    s = s.replace(/\s+(market|industry)$/, '').trim();
  } while (s !== prev);
  return s;
}

/**
 * R5.2 / R5.3 / Property 4 — title matches a keyword when every canonical
 * keyword token is present in the title's canonical token set. Order-insensitive
 * (set membership) and singular/plural-insensitive (shared singularizer).
 * An empty keyword never matches.
 */
export function titleMatchesKeyword(title: string, keyword: string): boolean {
  const keywordTokens = tokenize(keyword);
  if (keywordTokens.length === 0) return false;
  const titleTokens = new Set(tokenize(title));
  return keywordTokens.every((t) => titleTokens.has(t));
}

/**
 * R1.1 / Property 5 — derive the Search_Keyword for a suggestion: use the
 * normalized `marketKeyword` when non-empty, otherwise fall back to the
 * normalized `reportTitle`. Empty when both are absent/blank.
 */
export function deriveSearchKeyword(
  suggestion: Pick<ReportSuggestion, 'marketKeyword' | 'reportTitle'>,
): string {
  const fromKeyword = normalizeKeyword(suggestion.marketKeyword ?? '');
  if (fromKeyword) return fromKeyword;
  return normalizeKeyword(suggestion.reportTitle ?? '');
}

/**
 * R1.4 / Property 6 — extract the publisher domain (host) from a result link.
 * Returns the lowercased hostname with scheme, port, path, and query removed;
 * returns '' for an unparseable URL.
 */
export function extractDomain(link: string): string {
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE CORE — single-result classification, signal extraction, competitor count.
// Deterministic, no I/O. Property-tested (Properties 8–10).
// ─────────────────────────────────────────────────────────────────────────────

/** R4.5 — a Kaiso-owned domain, always excluded from Competitor_Count. */
function isOwnDomain(domain: string, config: ScoringRubric): boolean {
  return config.ownDomains.some((d) => domain.includes(d));
}

/** R3.5 — a report-marketplace aggregator (exact host or sub-host). */
function isReportMarketplace(domain: string, config: ScoringRubric): boolean {
  return config.reportMarketplaces.some((m) => domain === m || domain.endsWith('.' + m));
}

/**
 * R3.4–3.7 / R4.1–4.5 / Property 8 — classify a single result as a
 * Competitor_Report iff it exhibits ≥1 report indicator (report-style URL path,
 * "Market Size/Share/Forecast" title pattern, schema.org Report/Product markup,
 * Report_Marketplace domain, or PDF) AND its domain is not Kaiso-owned AND it is
 * not a blog/news/article URL. The blog exclusion overrides any indicators; a
 * paywalled result is still counted (paywall is not an exclusion).
 */
export function classifyResult(
  result: SerpOrganicResult,
  _keyword: string,
  config: ScoringRubric,
): ResultClassification {
  const domain = result.domain || extractDomain(result.link);
  const url = result.link ?? '';
  const matchedSignals: SerpSignalType[] = [];

  // Own-domain exclusion (R4.5) — overrides everything.
  if (isOwnDomain(domain, config)) {
    return { domain, isCompetitorReport: false, matchedSignals, excludedReason: 'own_domain' };
  }

  // Blog/news/article exclusion (R4.2) — overrides any report indicators.
  if (config.blogPatterns.some((re) => re.test(url))) {
    return { domain, isCompetitorReport: false, matchedSignals, excludedReason: 'blog' };
  }

  // Report indicators (R3.4–3.7, R4.1).
  if (config.reportIndicators.titlePatterns.some((re) => re.test(result.title))) {
    matchedSignals.push('TITLE_PATTERN');
  }
  if (result.hasReportSchema) {
    matchedSignals.push('SCHEMA_MARKUP');
  }
  if (isReportMarketplace(domain, config)) {
    matchedSignals.push('REPORT_MARKETPLACE');
  }
  if (config.reportIndicators.pdfMarkers.some((re) => re.test(url))) {
    matchedSignals.push('PDF');
  }
  // Report-style URL path is an indicator but maps to no named SerpSignalType.
  const hasReportUrl = config.reportIndicators.reportUrlPaths.some((re) => re.test(url));

  const isCompetitorReport = matchedSignals.length > 0 || hasReportUrl;
  return isCompetitorReport
    ? { domain, isCompetitorReport: true, matchedSignals }
    : { domain, isCompetitorReport: false, matchedSignals, excludedReason: 'no_indicator' };
}

/**
 * R3.1–3.3 / R3.8 / Property 9 — extract every SERP_Signal from a full response.
 * Classifies organic and paid results and pulls AI Overview cited domains;
 * records which signal types contributed to the counted Competitor_Reports.
 */
export function extractSignals(
  response: SerpResponse,
  keyword: string,
  config: ScoringRubric,
): SignalExtraction {
  const perResult: ResultClassification[] = [];
  const signalTypesPresent = new Set<SerpSignalType>();

  const ingest = (results: SerpOrganicResult[], source: 'ORGANIC' | 'PAID_AD') => {
    for (const r of results) {
      const c = classifyResult(r, keyword, config);
      if (c.isCompetitorReport) {
        signalTypesPresent.add(source);
        c.matchedSignals.forEach((sig) => signalTypesPresent.add(sig));
      }
      perResult.push(c);
    }
  };

  ingest(response.organic, 'ORGANIC');   // R3.1
  ingest(response.ads, 'PAID_AD');       // R3.2

  // R3.3 — AI Overview cited domains count as coverage (own-domains excluded).
  const aiOverviewDomains = response.aiOverviewSources
    .map((d) => d.toLowerCase())
    .filter((d) => d.length > 0 && !isOwnDomain(d, config));
  if (aiOverviewDomains.length > 0) signalTypesPresent.add('AI_OVERVIEW');

  return { perResult, aiOverviewDomains, signalTypesPresent: Array.from(signalTypesPresent) };
}

/**
 * R2.5 / R4.3 / R10.8 / Property 10 — Competitor_Count is the number of distinct
 * competing publisher domains across organic/paid Competitor_Reports plus AI
 * Overview cited domains, de-duplicated and with Kaiso-owned domains excluded.
 */
export function countCompetitors(
  extraction: SignalExtraction,
  config: ScoringRubric,
): { count: number; domains: string[] } {
  const domains = new Set<string>();
  for (const r of extraction.perResult) {
    if (r.isCompetitorReport && r.domain && !isOwnDomain(r.domain, config)) {
      domains.add(r.domain);
    }
  }
  for (const d of extraction.aiOverviewDomains) {
    if (d && !isOwnDomain(d, config)) domains.add(d);
  }
  const list = Array.from(domains);
  return { count: list.length, domains: list };
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE CORE — Scoring_Rubric application and output-field mapping.
// Deterministic, no I/O. Property-tested (Properties 1, 2, 11, 12, 13, 14).
// ─────────────────────────────────────────────────────────────────────────────

/** The downstream white-space contract fields produced for a ReportSuggestion. */
export interface WhiteSpaceFields {
  whiteSpaceStatus: 'CONFIRMED_GAP' | 'PARTIAL_COVERAGE' | 'COMMODITISED' | 'UNKNOWN';
  whiteSpaceScore?: number;
  whiteSpaceLabel?: string;
  whiteSpaceCompetitors?: string[];
  whiteSpaceGapReason?: string;
  whiteSpaceSignals?: SerpSignalType[];
  opportunityClass?: OpportunityClass;
}

/**
 * R2.1–2.4 / R6.1–6.4 / Properties 1 & 2 — map Competitor_Count to the
 * Opportunity_Class partition and a deterministic in-band White_Space_Score:
 * 0 → GREEN (85), 1–2 → YELLOW (55), 3–6 → RED "crowded" (25), ≥7 → RED
 * "commoditised" (decays below 25). Strong report signals nudge confidence in a
 * RED call downward but never cross a band boundary.
 */
export function applyRubric(
  competitorCount: number,
  signals: SerpSignalType[],
  config: ScoringRubric,
): Classification {
  const count = Math.max(0, Math.floor(competitorCount));
  const { greenMax, yellowMax, crowdedMax } = config.thresholds;
  const { greenBase, yellowBase, redBase } = config.scoreBands;

  if (count <= greenMax) return { opportunityClass: 'GREEN', score: greenBase, reason: 'gap' };
  if (count <= yellowMax) return { opportunityClass: 'YELLOW', score: yellowBase, reason: 'partial' };

  const reason: Classification['reason'] = count <= crowdedMax ? 'crowded' : 'commoditised';
  const decay = Math.max(0, count - crowdedMax) * 3;
  const signalPenalty = signals.some((s) => s === 'SCHEMA_MARKUP' || s === 'REPORT_MARKETPLACE') ? 2 : 0;
  const score = Math.max(0, Math.min(redBase, redBase - decay - signalPenalty));
  return { opportunityClass: 'RED', score, reason };
}

/**
 * R6.5 / Property 12 — one-sentence explanation containing the numeric
 * Competitor_Count and naming each contributing SERP_Signal type.
 */
export function buildGapReason(count: number, signals: SerpSignalType[]): string {
  const noun = count === 1 ? 'competing report domain' : 'competing report domains';
  if (signals.length === 0) {
    return `Found ${count} ${noun} across the scanned SERP signals.`;
  }
  return `Found ${count} ${noun} across these SERP signals: ${signals.join(', ')}.`;
}

/** Opportunity_Class → whiteSpaceStatus (R10.2–10.5) and display label. */
const STATUS_LABEL: Record<WhiteSpaceFields['whiteSpaceStatus'], string> = {
  CONFIRMED_GAP: '🟢 Confirmed Gap',
  PARTIAL_COVERAGE: '🟡 Partial Coverage',
  COMMODITISED: '🔴 Commoditised',
  UNKNOWN: '⚪ Unknown',
};

/**
 * R10.1–10.7 / R3.8 / Properties 11, 13, 14 — map an Opportunity_Class to the
 * downstream contract fields. GREEN→CONFIRMED_GAP, YELLOW→PARTIAL_COVERAGE,
 * RED→COMMODITISED; a missing or unrecognized class maps to UNKNOWN. Populates
 * every field it can derive on a best-effort basis (never aborts on a missing
 * one). UNKNOWN carries only the status, leaving legacy fields untouched.
 */
export function toWhiteSpaceFields(
  classification: Classification | undefined,
  domains: string[],
  signals: SerpSignalType[],
): WhiteSpaceFields {
  const cls = classification?.opportunityClass;
  const status: WhiteSpaceFields['whiteSpaceStatus'] =
    cls === 'GREEN' ? 'CONFIRMED_GAP'
    : cls === 'YELLOW' ? 'PARTIAL_COVERAGE'
    : cls === 'RED' ? 'COMMODITISED'
    : 'UNKNOWN';

  if (status === 'UNKNOWN') return { whiteSpaceStatus: 'UNKNOWN' };

  return {
    whiteSpaceStatus: status,
    whiteSpaceScore: classification?.score,
    whiteSpaceLabel: STATUS_LABEL[status],
    whiteSpaceCompetitors: domains,
    whiteSpaceGapReason: buildGapReason(domains.length, signals),
    whiteSpaceSignals: signals,
    opportunityClass: cls,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O SHELL — SERP provider (Tavily Search API) and result cache.
// Provider-agnostic interface; one concrete vendor implementation. Mock-tested.
// ─────────────────────────────────────────────────────────────────────────────

/** Provider-agnostic SERP client. One implementation per vendor. */
export interface SerpProvider {
  /** True when a usable API credential is configured for this run (R7.2). */
  isConfigured(): boolean;
  /** Fetch a SerpResponse for one keyword; rejects with SerpProviderError. */
  search(keyword: string): Promise<SerpResponse>;
}

/** Carries the failure class so the I/O shell can tell credential errors
 * (skip-all) from transient per-keyword failures (mark one UNKNOWN). */
export class SerpProviderError extends Error {
  constructor(message: string, public code: string, public keyword: string) {
    super(message);
    this.name = 'SerpProviderError';
  }
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}
interface TavilyPayload {
  results?: TavilyResult[];
}

/** Minimal fetch surface so the provider is unit-testable without the network. */
type HttpFetch = (
  url: string,
  init?: unknown,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** R1.3 — normalize a Tavily Search payload into the internal SerpResponse.
 * Tavily returns ranked organic web results (title/url/content); it exposes no
 * ads or AI-Overview block, so those are empty (organic-only detection). */
export function normalizeTavily(keyword: string, payload: TavilyPayload): SerpResponse {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const organic: SerpOrganicResult[] = results.map((r) => {
    const link = r.url ?? '';
    return {
      title: r.title ?? '',
      link,
      domain: extractDomain(link),
      snippet: r.content,
    };
  });
  return { keyword, organic, ads: [], aiOverviewSources: [] };
}

/**
 * R1.2 / R1.3 / R7.2 — Tavily Search API provider. Reads TAVILY_API_KEY; the
 * free tier is 1,000 credits/month (1 per search), commercial-use OK, no card.
 * `isConfigured()` is false when the credential is absent.
 */
export class TavilyProvider implements SerpProvider {
  constructor(
    private readonly key: string = (process.env.TAVILY_API_KEY ?? '').trim(),
    private readonly fetchFn: HttpFetch = (url, init) => fetch(url, init as RequestInit),
  ) {}

  isConfigured(): boolean {
    return this.key.length > 0;
  }

  async search(keyword: string): Promise<SerpResponse> {
    if (!this.isConfigured()) {
      throw new SerpProviderError('Tavily credential missing', 'NO_CREDENTIAL', keyword);
    }
    let res: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      res = await this.fetchFn('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ query: keyword, search_depth: 'basic', max_results: 10 }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SerpProviderError(`Tavily request failed: ${msg}`, 'NETWORK', keyword);
    }
    if (!res.ok) {
      const code = res.status === 429 ? 'RATE_LIMIT' : res.status === 401 || res.status === 403 ? 'FORBIDDEN' : `HTTP_${res.status}`;
      throw new SerpProviderError(`Tavily HTTP ${res.status}`, code, keyword);
    }
    const payload = (await res.json()) as TavilyPayload;
    return normalizeTavily(keyword, payload);
  }
}

/** Per-run result cache keyed by normalized Search_Keyword. */
export interface ResultCache {
  get(key: string, now: number, refreshWindowMs: number): CachedClassification | null;
  set(key: string, value: CachedClassification, now: number): void;
  flush(): Promise<void>;
}

/**
 * R8.1/8.3/8.4/8.5 — JSON-file result cache. Loads once per run, serves entries
 * keyed by normalized keyword, treats missing/stale (age > Refresh_Window)
 * entries as misses, and flushes to disk once at run end. A read/parse error is
 * treated as an empty cache (non-fatal).
 */
export class FileResultCache implements ResultCache {
  private store = new Map<string, CachedClassification>();
  private loaded = false;

  constructor(private readonly path: string = RUN_CONTROL.cachePath) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf-8')) as Record<string, CachedClassification>;
      for (const [k, v] of Object.entries(data)) this.store.set(k, v);
    } catch {
      // Missing or corrupt cache file → start empty (R8, non-fatal).
    }
  }

  get(key: string, now: number, refreshWindowMs: number): CachedClassification | null {
    this.load();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (now - entry.timestamp > refreshWindowMs) return null; // stale → miss (R8.4)
    return entry;
  }

  set(key: string, value: CachedClassification, now: number): void {
    this.load();
    this.store.set(key, { ...value, timestamp: now }); // current timestamp (R8.3)
  }

  async flush(): Promise<void> {
    await writeFile(this.path, JSON.stringify(Object.fromEntries(this.store)), 'utf-8');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATION — enrichWithWhiteSpaceDetection. Wires the pure core + I/O shell
// with per-run keyword de-duplication, budget cap, caching, inter-call delay,
// and non-fatal error handling. Same exported signature as the legacy service.
// ─────────────────────────────────────────────────────────────────────────────

type RunControlConfig = { runBudget: number; interCallDelayMs: number; refreshWindowMs: number };

/** Injectable dependencies — production wiring is filled in by default so
 * `server.ts` can call `enrichWithWhiteSpaceDetection(suggestions)` with no deps;
 * tests inject a MockSerpProvider, in-memory cache, clock, and sleep spy. */
export interface DetectionDeps {
  provider: SerpProvider;
  cache: ResultCache;
  rubric: ScoringRubric;
  runControl: RunControlConfig;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function resolveDeps(d: Partial<DetectionDeps>): DetectionDeps {
  return {
    provider: d.provider ?? new TavilyProvider(),
    cache: d.cache ?? new FileResultCache(),
    rubric: d.rubric ?? SCORING_RUBRIC,
    runControl: d.runControl ?? RUN_CONTROL,
    now: d.now ?? (() => Date.now()),
    sleep: d.sleep ?? defaultSleep,
  };
}

/** Merge derived white-space fields onto a suggestion without disturbing the
 * rest of it, and record whether the result was served from cache (R9.4). */
function applyFields(
  suggestion: ReportSuggestion,
  fields: WhiteSpaceFields,
  cached: boolean,
): ReportSuggestion {
  return { ...suggestion, ...fields, whiteSpaceSerpCached: cached };
}

/** UNKNOWN fields — used for empty keyword, absent credential, budget exhausted,
 * provider failure, and unexpected errors. */
const UNKNOWN_FIELDS: WhiteSpaceFields = { whiteSpaceStatus: 'UNKNOWN' };

async function runDetection(
  suggestions: ReportSuggestion[],
  deps: DetectionDeps,
): Promise<ReportSuggestion[]> {
  const { provider, cache, rubric, runControl, now, sleep } = deps;
  const credentialOk = provider.isConfigured(); // R7.2
  const attempts = new Map<string, { fields: WhiteSpaceFields; cached: boolean }>(); // R5.4/5.5
  let billableCalls = 0;
  let madeAnyCall = false;
  const out: ReportSuggestion[] = [];

  for (const suggestion of suggestions) {
    try {
      const keyword = deriveSearchKeyword(suggestion);

      // R1.5 empty keyword, R7.2 absent credential → UNKNOWN, no provider call.
      if (!keyword || !credentialOk) {
        out.push(applyFields(suggestion, UNKNOWN_FIELDS, false));
        continue;
      }

      // R5.4/5.5 — reuse a prior attempt (success or failure) for this keyword.
      const memo = attempts.get(keyword);
      if (memo) {
        out.push(applyFields(suggestion, memo.fields, memo.cached));
        continue;
      }

      // R8.1/8.2/8.4/9.4 — fresh cache hit avoids a billable call and budget.
      const hit = cache.get(keyword, now(), runControl.refreshWindowMs);
      if (hit) {
        const fields = toWhiteSpaceFields(hit.classification, hit.domains, hit.signals);
        attempts.set(keyword, { fields, cached: true });
        out.push(applyFields(suggestion, fields, true));
        continue;
      }

      // R9.2 — budget cap: remaining unprocessed keywords become UNKNOWN.
      if (billableCalls >= runControl.runBudget) {
        attempts.set(keyword, { fields: UNKNOWN_FIELDS, cached: false });
        out.push(applyFields(suggestion, UNKNOWN_FIELDS, false));
        continue;
      }

      // R9.3 — inter-call delay between billable provider calls.
      if (madeAnyCall && runControl.interCallDelayMs > 0) await sleep(runControl.interCallDelayMs);
      madeAnyCall = true;
      billableCalls++;

      try {
        const response = await provider.search(keyword);
        const extraction = extractSignals(response, keyword, rubric);
        const { count, domains } = countCompetitors(extraction, rubric);
        const classification = applyRubric(count, extraction.signalTypesPresent, rubric);
        cache.set(keyword, { keyword, classification, domains, signals: extraction.signalTypesPresent, timestamp: now() }, now()); // R8.3
        const fields = toWhiteSpaceFields(classification, domains, extraction.signalTypesPresent);
        attempts.set(keyword, { fields, cached: false });
        out.push(applyFields(suggestion, fields, false));
      } catch (err) {
        // R7.1 — isolate provider failure to this keyword; memo so dupes don't retry.
        console.error(`[WhiteSpace] Provider failed for "${keyword}":`, err instanceof Error ? err.message : err);
        attempts.set(keyword, { fields: UNKNOWN_FIELDS, cached: false });
        out.push(applyFields(suggestion, UNKNOWN_FIELDS, false));
      }
    } catch (err) {
      // R7.3 — per-suggestion guard: never throw out of the loop.
      console.error('[WhiteSpace] Unexpected error classifying a suggestion:', err);
      out.push(applyFields(suggestion, UNKNOWN_FIELDS, false));
    }
  }

  try {
    await cache.flush(); // R8.5
  } catch (err) {
    console.error('[WhiteSpace] Cache flush failed:', err);
  }
  console.info(`[WhiteSpace] Complete — ${billableCalls} billable SERP call(s) this run.`); // R9.5
  return out;
}

/**
 * R1.x/5.x/7.x/8.x/9.x — classify each suggestion's competitive white space via
 * SERP signals and map onto the legacy whiteSpace* contract. Non-fatal: always
 * resolves to an array of the same length, never throws (R7.3/7.4).
 */
export async function enrichWithWhiteSpaceDetection(
  suggestions: ReportSuggestion[],
  deps: Partial<DetectionDeps> = {},
): Promise<ReportSuggestion[]> {
  try {
    return await runDetection(suggestions, resolveDeps(deps));
  } catch (err) {
    console.error('[WhiteSpace] Detection aborted; returning input unchanged.', err);
    return suggestions;
  }
}
