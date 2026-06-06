/**
 * serpOpportunityDetectionService.ts
 *
 * SERP-based white-space / opportunity detection. Replaces the fixed
 * four-publisher scrape in competitorWhitespaceService.ts. Validates each
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
