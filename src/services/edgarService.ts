/**
 * edgarService.ts
 *
 * Queries the SEC EDGAR Full-Text Search API for recent regulatory filings
 * (10-K, 10-Q, 8-K) that match Kaiso's industry verticals.
 *
 * EDGAR is completely free and requires no API key. The User-Agent header is
 * required by SEC fair-access policy — it must identify your application.
 *
 * API docs: https://efts.sec.gov/LATEST/search-index?q=...
 *
 * Output: EDGARSignal[] — structured signals tagged with filing metadata so
 * Gemini knows these come from official regulatory disclosures (higher
 * authority than RSS headlines).
 */

import { EDGARSignal } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// EDGAR API CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const EDGAR_BASE_URL = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_VIEWER_BASE = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany';

// SEC fair-access policy requires a descriptive User-Agent
const EDGAR_USER_AGENT =
  'KaisoResearch/1.0 (market research intelligence platform; contact@kaisoresearch.com)';

// How many filing results to fetch per keyword query
// Keep this low — we cap further in geminiService before Gemini sees them
const RESULTS_PER_QUERY = 3;

// Only pull filings from the last 90 days — keeps signals fresh
const DAYS_LOOKBACK = 90;

// Filing types that carry the most strategic market intelligence
const TARGET_FORM_TYPES = ['10-K', '10-Q', '8-K'];

// Max excerpt length passed to Gemini — same ceiling as RSS prepareArticles()
const MAX_EXCERPT_LENGTH = 700;

// ─────────────────────────────────────────────────────────────────────────────
// VERTICAL → KEYWORD MAPPING
//
// Each vertical maps to 2–3 search terms chosen to surface commercially
// significant disclosures: market entries, risk factor changes, demand shifts,
// supply chain disclosures, regulatory triggers.
//
// Keywords are kept specific enough to avoid noise but broad enough that
// they'll appear in annual/quarterly filings from sector leaders.
// ─────────────────────────────────────────────────────────────────────────────

const VERTICAL_KEYWORDS: Record<string, string[]> = {
  'Semiconductor & Electronics': [
    'semiconductor supply chain',
    'chip manufacturing capacity',
    'advanced packaging',
  ],
  'Construction': [
    'infrastructure investment',
    'construction materials demand',
    'modular construction',
  ],
  'Automotive': [
    'electric vehicle battery',
    'autonomous driving technology',
    'vehicle electrification',
  ],
  'Energy & Cleantech': [
    'renewable energy transition',
    'energy storage deployment',
    'carbon capture investment',
  ],
  'BFSI & Fintech': [
    'digital payments infrastructure',
    'embedded finance',
    'banking as a service',
  ],
  'Chemicals': [
    'specialty chemicals demand',
    'bio-based polymers',
    'chemical supply chain disruption',
  ],
  'Aerospace & Defense': [
    'defense procurement',
    'unmanned aerial systems',
    'satellite communications',
  ],
  'Agriculture': [
    'precision agriculture',
    'agritech investment',
    'crop protection biologicals',
  ],
  'Food & Beverage': [
    'alternative protein market',
    'food safety regulation',
    'cold chain logistics',
  ],
  'Retail & E-Commerce': [
    'e-commerce logistics',
    'retail technology adoption',
    'last mile delivery',
  ],
  'IT & Telecom': [
    '5G infrastructure deployment',
    'enterprise cloud migration',
    'cybersecurity spending',
  ],
  'Pharma & Biotech': [
    'biologics manufacturing',
    'clinical trial investment',
    'drug shortage supply chain',
  ],
  'Healthcare': [
    'medical device regulatory approval',
    'digital health platform',
    'value-based care',
  ],
  'Fintech': [
    'open banking regulation',
    'cryptocurrency compliance',
    'insurtech growth',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE — 24-HOUR TTL
//
// EDGAR fetches ~2000+ signals across 40+ keyword queries and takes ~60 seconds.
// Filings don't change minute-to-minute — a 24-hour cache is plenty fresh.
//
// Cache file: /tmp/edgar-cache.json by default (override with EDGAR_CACHE_PATH).
// IMPORTANT: use /tmp, NOT process.cwd(). On Render, process.cwd() is the build
// directory, which is read-only / wiped between deploys — writing there silently
// failed, so EDGAR re-fetched (~60s) on every single run. /tmp persists for the
// life of the running instance, matching the memory-file strategy in server.ts.
// On cache hit  → instant load, ~0ms, no SEC requests
// On cache miss → full fetch (~60s), then saved for next 24 hours
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_FILE = process.env.EDGAR_CACHE_PATH ?? path.join('/tmp', 'edgar-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface EdgarCache {
  fetchedAt: string;   // ISO timestamp of when the cache was written
  signals: EDGARSignal[];
}

/** Read cache from disk. Returns null if file doesn't exist or is unreadable. */
function readCache(): EdgarCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as EdgarCache;
  } catch {
    return null;
  }
}

/** Write signals to disk cache with current timestamp. */
function writeCache(signals: EDGARSignal[]): void {
  try {
    const cache: EdgarCache = {
      fetchedAt: new Date().toISOString(),
      signals,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
    console.log(`[EDGAR] Cache written: ${signals.length} signals → edgar-cache.json`);
  } catch (err) {
    // Non-fatal — if we can't write cache, just continue without it
    console.warn('[EDGAR] Failed to write cache:', err);
  }
}

/** Returns true if the cache exists and was written less than 24 hours ago. */
function isCacheValid(cache: EdgarCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

/** Human-readable cache age string for logs, e.g. "3h 42m" */
function cacheAgeLabel(fetchedAt: string): string {
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns an ISO date string N days ago — used to scope EDGAR search results */
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

/** Strip HTML tags and collapse whitespace for clean excerpt text */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXCERPT_LENGTH);
}

/**
 * Fetch one EDGAR full-text search query.
 * Returns raw hit objects from the EFTS API.
 */
async function fetchEdgarResults(
  keyword: string,
  formTypes: string[],
  dateFrom: string
): Promise<any[]> {
  const params = new URLSearchParams({
    q: `"${keyword}"`,
    dateRange: 'custom',
    startdt: dateFrom,
    forms: formTypes.join(','),
    _source_size: String(RESULTS_PER_QUERY),
    size: String(RESULTS_PER_QUERY),
  });

  const url = `${EDGAR_BASE_URL}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': EDGAR_USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    // EDGAR returns 429 if polled too aggressively — log and skip, don't throw
    console.warn(`[EDGAR] HTTP ${response.status} for query: "${keyword}"`);
    return [];
  }

  const data = await response.json();

  // EDGAR EFTS response shape: { hits: { hits: [...] } }
  return data?.hits?.hits ?? [];
}

/**
 * Parse a single EDGAR hit into an EDGARSignal.
 * Returns null if essential fields are missing.
 */
function parseEdgarHit(
  hit: any,
  vertical: string,
  matchedKeyword: string
): EDGARSignal | null {
  try {
    const src = hit._source ?? {};

    const companyName: string = src.entity_name ?? src.display_names?.[0] ?? 'Unknown Company';
    const filingType: string = src.file_type ?? src.form_type ?? 'Filing';
    const filingDate: string = src.period_of_report ?? src.file_date ?? '';

    // Build a human-readable viewer URL
    // Priority 1: direct filing index page (requires CIK + accession)
    // Priority 2: EDGAR company filing page (requires CIK only)
    // Fallback: EDGAR full-text search HTML results page (always readable)
    const accessionRaw: string = src.accession_no ?? '';
    const accession = accessionRaw.replace(/-/g, '');
    const cik: string = src.entity_id ?? '';
    const url = accession && cik
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/`
      : cik
        ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${encodeURIComponent(filingType)}&dateb=&owner=include&count=10`
        : `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(matchedKeyword)}%22&forms=${encodeURIComponent(filingType)}`;

    // Pull the best available text snippet
    const rawExcerpt: string =
      hit.highlight?.['file_contents']?.[0] ??
      src.file_description ??
      src.business_description ??
      '';

    if (!companyName || !rawExcerpt) return null;

    return {
      title: `${companyName} — ${filingType}`,
      filingType,
      companyName,
      filingDate,
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
 * fetchEdgarSignals()
 *
 * Queries EDGAR for all Kaiso verticals in parallel (with a small stagger to
 * respect SEC rate limits), deduplicates results, and returns a clean
 * EDGARSignal[] ready to be passed to Gemini alongside RSS articles.
 *
 * Designed to be resilient: if EDGAR is slow or unavailable, it logs a
 * warning and returns an empty array so the pipeline continues normally.
 */
export async function fetchEdgarSignals(): Promise<EDGARSignal[]> {
  // ── Cache check ──────────────────────────────────────────────────────────
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(
      `[EDGAR] Cache hit — ${cached.signals.length} signals loaded from disk ` +
      `(age: ${cacheAgeLabel(cached.fetchedAt)}, refreshes in ` +
      `${Math.round((CACHE_TTL_MS - (Date.now() - new Date(cached.fetchedAt).getTime())) / 3600000)}h)`
    );
    return cached.signals;
  }

  if (cached) {
    console.log(`[EDGAR] Cache expired (age: ${cacheAgeLabel(cached.fetchedAt)}) — fetching fresh signals...`);
  } else {
    console.log('[EDGAR] No cache found — fetching fresh signals...');
  }
  // ── End cache check ───────────────────────────────────────────────────────

  const dateFrom = daysAgoISO(DAYS_LOOKBACK);
  const allSignals: EDGARSignal[] = [];

  // Track seen accession/company combos to deduplicate across keyword queries
  const seen = new Set<string>();

  const verticals = Object.entries(VERTICAL_KEYWORDS);

  console.log(
    `[EDGAR] Starting fetch across ${verticals.length} verticals, looking back ${DAYS_LOOKBACK} days...`
  );

  // Process verticals sequentially with a small delay between each to respect
  // SEC's fair-access policy (their guidance: no more than 10 req/sec)
  for (const [vertical, keywords] of verticals) {
    for (const keyword of keywords) {
      try {
        const hits = await fetchEdgarResults(keyword, TARGET_FORM_TYPES, dateFrom);

        for (const hit of hits) {
          const signal = parseEdgarHit(hit, vertical, keyword);
          if (!signal) continue;

          // Deduplicate by company + filing type + date combo
          const dedupeKey = `${signal.companyName}|${signal.filingType}|${signal.filingDate}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          allSignals.push(signal);
        }
      } catch (err) {
        // Non-fatal: log and continue to next keyword
        console.warn(`[EDGAR] Failed to fetch for keyword "${keyword}":`, err);
      }

      // 150ms pause between requests — keeps us well under SEC's rate limit
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.log(`[EDGAR] Complete: ${allSignals.length} unique signals fetched`);

  // Save to disk cache — next run within 24 hours will skip the fetch entirely
  writeCache(allSignals);

  return allSignals;
}
