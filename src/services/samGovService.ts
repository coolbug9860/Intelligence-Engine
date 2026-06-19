/**
 * samGovService.ts
 *
 * Queries the SAM.gov Get Opportunities API (api.sam.gov/opportunities) for
 * recent federal contract opportunities that match Kaiso's industry verticals.
 *
 * Structurally mirrors edgarService.ts: vertical→keyword mapping, resilient
 * (non-fatal) fetch loop, parse-to-signal, and a 24-hour local JSON disk cache.
 *
 * API KEY: SAM.gov's opportunities endpoint requires an `api_key` query
 * parameter. We read it from the SAM_GOV_API_KEY environment variable rather
 * than hardcoding it. The key is treated as OPTIONAL at the request layer: if
 * it is absent, the service logs and returns an empty array (defensive
 * fallback) exactly like EDGAR/NewsAPI degrade gracefully — it never throws and
 * never fabricates data. (A real SAM.gov call without a key returns 401/403.)
 *
 * API docs: https://open.gsa.gov/api/get-opportunities-public-api/
 *
 * Output: SamSignal[] — structured contract-opportunity signals tagged with
 * notice metadata and the matched Kaiso vertical.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL TYPE (declared here — types.ts is intentionally left unmodified)
// ─────────────────────────────────────────────────────────────────────────────

export interface SamSignal {
  title: string;          // Notice title + type, e.g. "Advanced Radar Systems — Solicitation"
  noticeType: string;     // "Solicitation" | "Presolicitation" | "Award Notice" | ...
  agency: string;         // Issuing department / sub-tier organization
  postedDate: string;     // ISO/string date the notice was posted
  excerpt: string;        // Cleaned description text (≤700 chars)
  url: string;            // Human-readable SAM.gov UI link to the notice
  vertical: string;       // Matched Kaiso vertical
  matchedKeyword: string; // The search keyword that surfaced this notice
}

// ─────────────────────────────────────────────────────────────────────────────
// SAM.GOV API CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const SAMGOV_BASE_URL = 'https://api.sam.gov/opportunities/v2/search';

// Optional — read from env, never hardcoded. Absent key → defensive no-op.
const SAMGOV_API_KEY = process.env.SAM_GOV_API_KEY ?? '';

// Descriptive User-Agent, mirroring EDGAR's fair-access courtesy header.
const SAMGOV_USER_AGENT =
  'KaisoResearch/1.0 (market research intelligence platform; contact@kaisoresearch.com)';

// How many notices to request per keyword query. Kept low; the global cap below
// is the real ceiling.
const RESULTS_PER_QUERY = 3;

// Only pull notices posted in the last N days — keeps signals fresh.
const DAYS_LOOKBACK = 30;

// Cleaned-excerpt ceiling — same as EDGAR/RSS.
const MAX_EXCERPT_LENGTH = 700;

// Strict ingestion-cycle cap: never return more than this many signals per run.
const MAX_SIGNALS_PER_CYCLE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// VERTICAL → KEYWORD MAPPING (Kaiso's 14 canonical verticals)
// ─────────────────────────────────────────────────────────────────────────────

const VERTICAL_KEYWORDS: Record<string, string[]> = {
  'Healthcare': ['medical devices', 'digital health', 'healthcare services'],
  'Electronics': ['electronic components', 'sensors', 'embedded systems'],
  'Semiconductor': ['semiconductor', 'microelectronics', 'chip fabrication'],
  'Automotive': ['electric vehicles', 'autonomous vehicles', 'fleet electrification'],
  'Chemicals': ['specialty chemicals', 'advanced materials', 'industrial coatings'],
  'Energy': ['renewable energy', 'energy storage', 'grid modernization'],
  'Fintech': ['digital payments', 'financial technology', 'blockchain services'],
  'Aerospace': ['unmanned aerial systems', 'satellite communications', 'space systems'],
  'BFSI': ['banking services', 'insurance technology', 'financial management'],
  'Food & Beverage': ['food supply chain', 'food safety', 'cold chain logistics'],
  'Construction': ['infrastructure construction', 'modular construction', 'facility modernization'],
  'Agriculture': ['precision agriculture', 'agricultural technology', 'crop systems'],
  'Retail & E-Commerce': ['e-commerce logistics', 'supply chain technology', 'last mile delivery'],
  'IT & Telecom': ['5G infrastructure', 'cloud migration', 'cybersecurity services'],
};

/** Reverse-lookup the vertical a caller-supplied keyword belongs to. */
function verticalForKeyword(keyword: string): string {
  const k = keyword.toLowerCase().trim();
  for (const [vertical, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
    if (keywords.some((kw) => kw.toLowerCase() === k)) return vertical;
  }
  return 'General';
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE — 24-HOUR TTL
//
// Mirrors edgarService's caching: shields runtime from repeated endpoint
// queries. Cache file: /tmp/samgov-cache.json by default (override with
// SAMGOV_CACHE_PATH). /tmp persists for the life of the running instance and is
// writable on Render (unlike process.cwd()).
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_FILE = process.env.SAMGOV_CACHE_PATH ?? path.join('/tmp', 'samgov-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SamGovCache {
  fetchedAt: string; // ISO timestamp of when the cache was written
  signals: SamSignal[];
}

/** Read cache from disk. Returns null if file doesn't exist or is unreadable. */
function readCache(): SamGovCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as SamGovCache;
  } catch {
    return null;
  }
}

/** Write signals to disk cache with current timestamp. */
function writeCache(signals: SamSignal[]): void {
  try {
    const cache: SamGovCache = {
      fetchedAt: new Date().toISOString(),
      signals,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
    console.log(`[SAM.gov] Cache written: ${signals.length} signals → samgov-cache.json`);
  } catch (err) {
    // Non-fatal — if we can't write cache, just continue without it.
    console.warn('[SAM.gov] Failed to write cache:', err);
  }
}

/** Returns true if the cache exists and was written less than 24 hours ago. */
function isCacheValid(cache: SamGovCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

/** Human-readable cache age string for logs, e.g. "3h 42m". */
function cacheAgeLabel(fetchedAt: string): string {
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns an MM/DD/YYYY date string N days ago — SAM.gov's postedFrom format. */
function daysAgoSamDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** SAM.gov's postedTo format for "today" (MM/DD/YYYY). */
function todaySamDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** Strip HTML tags and collapse whitespace for clean excerpt text. */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXCERPT_LENGTH);
}

/**
 * Fetch one SAM.gov opportunities query.
 * Returns the raw opportunity objects from the API (empty on any non-OK
 * response — logged, never thrown, mirroring EDGAR).
 */
async function fetchSamGovResults(
  keyword: string,
  postedFrom: string,
  postedTo: string
): Promise<any[]> {
  const params = new URLSearchParams({
    keyword,
    postedFrom,
    postedTo,
    limit: String(RESULTS_PER_QUERY),
    offset: '0',
  });

  // api_key is included only when configured. Absent key → likely 401/403,
  // which we handle below as a non-fatal skip.
  if (SAMGOV_API_KEY) {
    params.set('api_key', SAMGOV_API_KEY);
  }

  const url = `${SAMGOV_BASE_URL}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': SAMGOV_USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    console.warn(`[SAM.gov] HTTP ${response.status} for query: "${keyword}"`);
    return [];
  }

  const data = await response.json();

  // SAM.gov v2 response shape: { totalRecords, opportunitiesData: [...] }
  return data?.opportunitiesData ?? [];
}

/**
 * Parse a single SAM.gov opportunity into a SamSignal.
 * Returns null if essential fields are missing.
 */
function parseSamOpportunity(
  op: any,
  vertical: string,
  matchedKeyword: string
): SamSignal | null {
  try {
    const title: string = op.title ?? 'Untitled Notice';
    const noticeType: string = op.type ?? op.baseType ?? 'Notice';
    const agency: string =
      op.fullParentPathName ?? op.organizationName ?? op.department ?? 'Unknown Agency';
    const postedDate: string = op.postedDate ?? op.publishDate ?? '';

    // `description` is sometimes a text blob, sometimes a URL to fetch the text.
    // Use it only when it looks like text; otherwise fall back to the title.
    const rawDescription: string = typeof op.description === 'string' ? op.description : '';
    const looksLikeUrl = /^https?:\/\//i.test(rawDescription.trim());
    const rawExcerpt = looksLikeUrl || !rawDescription ? title : rawDescription;

    const url: string =
      op.uiLink ??
      (op.noticeId
        ? `https://sam.gov/opp/${op.noticeId}/view`
        : 'https://sam.gov/search/?index=opp');

    if (!title) return null;

    return {
      title: `${title} — ${noticeType}`,
      noticeType,
      agency,
      postedDate,
      excerpt: cleanText(rawExcerpt),
      url,
      vertical,
      matchedKeyword,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fetchSamGovSignals(keywords)
 *
 * Queries SAM.gov for contract opportunities. When `keywords` are supplied they
 * drive the search (each mapped back to its Kaiso vertical where possible);
 * otherwise the full 14-vertical keyword map is used. Deduplicates, caps the
 * result at MAX_SIGNALS_PER_CYCLE (50), and returns a clean SamSignal[].
 *
 * Resilient by design: missing API key, slow endpoint, or per-query failure all
 * log a warning and continue, so the caller never breaks. Returns [] in the
 * worst case rather than throwing.
 */
export async function fetchSamGovSignals(keywords: string[] = []): Promise<SamSignal[]> {
  // ── Cache check ────────────────────────────────────────────────────────────
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(
      `[SAM.gov] Cache hit — ${cached.signals.length} signals loaded from disk ` +
      `(age: ${cacheAgeLabel(cached.fetchedAt)})`
    );
    return cached.signals;
  }

  if (cached) {
    console.log(`[SAM.gov] Cache expired (age: ${cacheAgeLabel(cached.fetchedAt)}) — fetching fresh signals...`);
  } else {
    console.log('[SAM.gov] No cache found — fetching fresh signals...');
  }
  // ── End cache check ─────────────────────────────────────────────────────────

  // Defensive fallback: without a key the endpoint cannot be queried. Skip
  // cleanly (and don't poison the cache) rather than hammering it for 401s.
  if (!SAMGOV_API_KEY) {
    console.log(
      '[SAM.gov] No SAM_GOV_API_KEY configured — skipping. ' +
      'Add the key in environment variables to enable contract-opportunity signals.'
    );
    return [];
  }

  // Build the (vertical, keyword) query list.
  const queries: Array<{ vertical: string; keyword: string }> =
    keywords.length > 0
      ? keywords.map((k) => ({ vertical: verticalForKeyword(k), keyword: k }))
      : Object.entries(VERTICAL_KEYWORDS).flatMap(([vertical, kws]) =>
          kws.map((keyword) => ({ vertical, keyword }))
        );

  const postedFrom = daysAgoSamDate(DAYS_LOOKBACK);
  const postedTo = todaySamDate();

  const allSignals: SamSignal[] = [];
  const seen = new Set<string>();

  console.log(
    `[SAM.gov] Starting fetch across ${queries.length} queries, looking back ${DAYS_LOOKBACK} days...`
  );

  for (const { vertical, keyword } of queries) {
    // Stop early once the strict per-cycle cap is reached.
    if (allSignals.length >= MAX_SIGNALS_PER_CYCLE) break;

    try {
      const opportunities = await fetchSamGovResults(keyword, postedFrom, postedTo);

      for (const op of opportunities) {
        const signal = parseSamOpportunity(op, vertical, keyword);
        if (!signal) continue;

        // Deduplicate by title + agency + posted date.
        const dedupeKey = `${signal.title}|${signal.agency}|${signal.postedDate}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        allSignals.push(signal);
        if (allSignals.length >= MAX_SIGNALS_PER_CYCLE) break;
      }
    } catch (err) {
      // Non-fatal: log and continue to the next keyword.
      console.warn(`[SAM.gov] Failed to fetch for keyword "${keyword}":`, err);
    }

    // 150ms pause between requests — courteous rate limiting, mirrors EDGAR.
    await new Promise((r) => setTimeout(r, 150));
  }

  // Strict slice cap as a final guarantee (never exceed 50 per cycle).
  const capped = allSignals.slice(0, MAX_SIGNALS_PER_CYCLE);

  console.log(`[SAM.gov] Complete: ${capped.length} unique signals fetched (cap ${MAX_SIGNALS_PER_CYCLE})`);

  writeCache(capped);

  return capped;
}
