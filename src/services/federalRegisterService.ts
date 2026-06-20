/**
 * federalRegisterService.ts (Task 5)
 *
 * U.S. Federal Register connector — Module 1, and the DYNAMIC SAM watchlist source.
 *
 * Dual role:
 *   1. Produces IngestionRecord[] for recent U.S. regulatory notices.
 *   2. Exposes `extractSolicitationIds(text)` — the ONLY trigger for the surgical
 *      SAM.gov by-ID lookup (Task 7). Task 8 runs this extractor over each FR
 *      record's lazily-fetched full text and feeds the distinct IDs to
 *      `fetchSamNoticeById`. SAM IDs are NEVER obtained by keyword sweep (Req 8.4, 8.5).
 *
 * Uses the GPO/Federal Register API (`/api/v1/documents.json`) scoped to a strict
 * rolling 24h UTC publication_date window. Native `fetch`, 10s AbortController timeout,
 * 24h (86,400,000 ms) /tmp cache-first, silent-skip resilience. Output: IngestionRecord[].
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 11.4, 12.4
 *
 * NOTE (reconciliation): The FR API is itself keyless, but per Req 8.2/8.3 this
 * connector reads DATA_GOV_API_KEY by name, skips when it is absent, and appends it as
 * `api_key` (api.data.gov-compatible). Relax that gate if keyless operation is preferred.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IngestionRecord } from './ingestion/ingestionTypes';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const FR_DOCUMENTS_URL = 'https://www.federalregister.gov/api/v1/documents.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms — cache freshness

/**
 * Publication lookback window. The Federal Register does not publish on weekends or
 * federal holidays, so a 24h window returns nothing on those days. Default 4 days
 * (bridges a weekend); override via FR_LOOKBACK_DAYS. Decoupled from the cache TTL.
 */
const LOOKBACK_MS = Number(process.env.FR_LOOKBACK_DAYS ?? 4) * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const RESULT_PER_PAGE = 25;
const MAX_EXCERPT_LENGTH = 700;

function cacheFile(): string {
  return process.env.FR_CACHE_PATH ?? path.join('/tmp', 'federal-register-cache.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE (24h TTL)
// ─────────────────────────────────────────────────────────────────────────────

interface FrCache {
  fetchedAt: string;
  records: IngestionRecord[];
}

function readCache(): FrCache | null {
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as FrCache;
  } catch {
    return null;
  }
}

function writeCache(records: IngestionRecord[]): void {
  try {
    const cache: FrCache = { fetchedAt: new Date().toISOString(), records };
    fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[FedReg] Failed to write cache:', err);
  }
}

function isCacheValid(cache: FrCache): boolean {
  return Date.now() - new Date(cache.fetchedAt).getTime() < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOLICITATION / AWARD ID EXTRACTION (the SAM lookup trigger)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Federal solicitation / award number patterns commonly referenced in regulatory text.
 *  - Dashed agency format:  W911NF-24-R-0001, FA8750-23-R-1000, SP4701-24-R-0123
 *  - Compact HHS/NIH format: 75N98024R00001
 */
const SOLICITATION_PATTERNS: RegExp[] = [
  /\b[A-Z0-9]{2,8}-\d{2}-[A-Z]-\d{3,5}\b/g,
  /\b\d{2}[A-Z]\d{5}[A-Z]\d{5}\b/g,
];

/**
 * Extract distinct U.S. federal solicitation/award IDs from arbitrary text.
 * Pure, exported, order-preserving, de-duplicated (Req 8.4). This is the sole
 * mechanism that yields SAM watchlist IDs.
 */
export function extractSolicitationIds(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const pattern of SOLICITATION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const id = match[0].toUpperCase();
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function utcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Rolling 24h UTC publication_date window (YYYY-MM-DD). Exported for tests (Req 9.1). */
export function buildFrDateRange(now: Date): { gte: string; lte: string } {
  return { gte: utcDate(new Date(now.getTime() - LOOKBACK_MS)), lte: utcDate(now) };
}

function normalizeDate(raw: unknown): string {
  if (typeof raw === 'string') {
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00.000Z`;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function buildUrl(apiKey: string, now: Date): string {
  const { gte, lte } = buildFrDateRange(now);
  const params = new URLSearchParams();
  params.set('per_page', String(RESULT_PER_PAGE));
  params.set('order', 'newest');
  params.set('conditions[publication_date][gte]', gte);
  params.set('conditions[publication_date][lte]', lte);
  for (const f of ['document_number', 'title', 'abstract', 'html_url', 'publication_date', 'raw_text_url', 'full_text_xml_url', 'type']) {
    params.append('fields[]', f);
  }
  params.set('api_key', apiKey); // api.data.gov-compatible (Req 8.2)
  return `${FR_DOCUMENTS_URL}?${params.toString()}`;
}

/** Map one Federal Register document to an IngestionRecord; null if essentials are missing. */
function parseDocument(doc: any): IngestionRecord | null {
  try {
    const externalId: string = doc?.document_number ?? '';
    const headline: string = doc?.title ?? '';
    if (!externalId || !headline) return null;

    const abstractText: string = doc?.abstract ?? '';
    const abstract = (abstractText || headline).slice(0, MAX_EXCERPT_LENGTH);
    const sourceUrl: string = doc?.html_url ?? `https://www.federalregister.gov/documents/${externalId}`;
    const fullTextUrl: string = doc?.raw_text_url ?? doc?.full_text_xml_url ?? sourceUrl;

    return {
      source_system: 'US_FEDERAL_REGISTER',
      content_type: 'regulatory_filing',
      jurisdiction: 'US',
      headline,
      abstract,
      source_url: sourceUrl,
      full_text_url: fullTextUrl,
      tracking_timestamp: normalizeDate(doc?.publication_date),
      external_id: externalId,
      vertical_hint: null,
      language: 'en',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch recent U.S. Federal Register notices as IngestionRecord[].
 *
 * Cache-first (24h /tmp). Reads DATA_GOV_API_KEY by name; absent/empty → warn + [].
 * Non-fatal: non-OK, network error, timeout, and per-doc parse failures yield [] /
 * fewer records, never throw.
 */
export async function fetchFederalRegisterNotices(): Promise<IngestionRecord[]> {
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(`[FedReg] Cache hit — ${cached.records.length} records.`);
    return cached.records;
  }

  const apiKey = process.env.DATA_GOV_API_KEY ?? '';
  if (!apiKey) {
    console.warn('[FedReg] DATA_GOV_API_KEY not configured — skipping.');
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(apiKey, new Date()), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[FedReg] HTTP ${response.status} — returning none.`);
      return [];
    }

    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    const records: IngestionRecord[] = [];
    for (const doc of results) {
      const record = parseDocument(doc);
      if (record) records.push(record);
    }

    console.log(`[FedReg] Parsed ${records.length} regulatory records.`);
    writeCache(records);
    return records;
  } catch (err) {
    console.warn('[FedReg] Request failed:', err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
