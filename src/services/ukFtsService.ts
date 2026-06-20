/**
 * ukFtsService.ts (Task 4)
 *
 * UK procurement connector — Find a Tender (FTS) + Contracts Finder, both via their
 * public OCDS (Open Contracting Data Standard) feeds. Native, key-free, $0. No Apify.
 *
 * One shared OCDS parser serves both endpoints and handles both package flavours:
 *   - ReleasePackage  → `releases[]`
 *   - RecordPackage   → `records[].compiledRelease`
 *   - Contracts Finder search wrapper → `results[].releasePackage`
 *
 * Mirrors the connector pattern: native `fetch` with a 10s AbortController timeout,
 * 24h (86,400,000 ms) /tmp cache-first, rolling 24h UTC lookback, and "silent-skip"
 * resilience — one endpoint failing continues with the other; both failing yields [].
 * Output: IngestionRecord[].
 *
 * Validates: Requirements 3.1–3.8, 9.3, 11.4
 *
 * NOTE: OCDS field coverage varies by publisher; the parser is intentionally defensive.
 * Validate the exact endpoint query params against the live services before production.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IngestionRecord } from './ingestion/ingestionTypes';
import type { SourceSystem } from './ingestion/ingestionTypes';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const UK_FTS_BASE = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
const UK_CF_BASE = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms
const REQUEST_TIMEOUT_MS = Number(process.env.UKFTS_TIMEOUT_MS ?? 10_000); // 10s, configurable
const MAX_EXCERPT_LENGTH = 700;

function cacheFile(): string {
  return process.env.UKFTS_CACHE_PATH ?? path.join('/tmp', 'ukfts-cache.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE (24h TTL)
// ─────────────────────────────────────────────────────────────────────────────

interface UkFtsCache {
  fetchedAt: string;
  records: IngestionRecord[];
}

function readCache(): UkFtsCache | null {
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as UkFtsCache;
  } catch {
    return null;
  }
}

function writeCache(records: IngestionRecord[]): void {
  try {
    const cache: UkFtsCache = { fetchedAt: new Date().toISOString(), records };
    fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[UK-FTS] Failed to write cache:', err);
  }
}

function isCacheValid(cache: UkFtsCache): boolean {
  return Date.now() - new Date(cache.fetchedAt).getTime() < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Rolling 24h UTC window as ISO timestamps. Pure + exported for testability (Req 9.3). */
export function buildUkDateRange(now: Date): { updatedFrom: string; updatedTo: string } {
  return {
    updatedFrom: new Date(now.getTime() - CACHE_TTL_MS).toISOString(),
    updatedTo: now.toISOString(),
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract OCDS release objects from any package flavour:
 * ReleasePackage (`releases`), RecordPackage (`records[].compiledRelease`), or a
 * Contracts Finder search wrapper (`results[].releasePackage` / `results[]`).
 */
function extractReleases(pkg: any): any[] {
  if (!pkg || typeof pkg !== 'object') return [];
  if (Array.isArray(pkg.releases)) return pkg.releases;
  if (Array.isArray(pkg.records)) {
    return pkg.records.map((r: any) => r?.compiledRelease).filter(Boolean);
  }
  if (Array.isArray(pkg.results)) {
    return pkg.results.flatMap((r: any) => extractReleases(r?.releasePackage ?? r));
  }
  return [];
}

function normalizeDate(raw: unknown): string {
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

/** Map one OCDS release → IngestionRecord; null when ocid or title is missing. */
function mapRelease(release: any, sourceSystem: SourceSystem, noticeBase: string): IngestionRecord | null {
  try {
    const ocid: string = release?.ocid ?? release?.id ?? '';
    const tender = release?.tender ?? {};
    const title: string = tender?.title ?? release?.title ?? '';
    if (!ocid || !title) return null;

    const description: string = tender?.description ?? release?.description ?? '';
    const abstract = (description || title).slice(0, MAX_EXCERPT_LENGTH);

    const docs = Array.isArray(tender?.documents) ? tender.documents : [];
    const firstDocUrl: string | undefined = docs.find((d: any) => typeof d?.url === 'string')?.url;
    const noticeUrl = `${noticeBase}/${encodeURIComponent(ocid)}`;

    return {
      source_system: sourceSystem,
      content_type: 'procurement_notice',
      jurisdiction: 'GB',
      headline: title,
      abstract,
      source_url: firstDocUrl ?? noticeUrl,
      full_text_url: firstDocUrl ?? noticeUrl,
      tracking_timestamp: normalizeDate(release?.date),
      external_id: ocid,
      vertical_hint: null,
      language: 'en',
    };
  } catch {
    return null;
  }
}

/** Fetch + parse a single OCDS endpoint. `ok` is false on any non-OK/exception. */
async function fetchEndpoint(
  url: string,
  sourceSystem: SourceSystem,
  noticeBase: string,
  label: string
): Promise<{ ok: boolean; records: IngestionRecord[] }> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      console.warn(`[UK-FTS] ${label} HTTP ${response.status} — skipping this endpoint.`);
      return { ok: false, records: [] };
    }
    const data = await response.json();
    const records: IngestionRecord[] = [];
    for (const release of extractReleases(data)) {
      const record = mapRelease(release, sourceSystem, noticeBase);
      if (record) records.push(record);
    }
    return { ok: true, records };
  } catch (err) {
    console.warn(`[UK-FTS] ${label} request failed:`, err);
    return { ok: false, records: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch recent UK FTS + Contracts Finder procurement notices as IngestionRecord[].
 *
 * Cache-first (24h /tmp). Non-fatal: one endpoint failing continues with the other;
 * both failing returns [] (and does NOT poison the cache so the next run retries).
 */
export async function fetchUkFtsNotices(): Promise<IngestionRecord[]> {
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(`[UK-FTS] Cache hit — ${cached.records.length} records.`);
    return cached.records;
  }

  const { updatedFrom, updatedTo } = buildUkDateRange(new Date());
  const ftsUrl = `${UK_FTS_BASE}?updatedFrom=${encodeURIComponent(updatedFrom)}&updatedTo=${encodeURIComponent(updatedTo)}&limit=25`;
  const cfUrl = `${UK_CF_BASE}?publishedFrom=${encodeURIComponent(updatedFrom)}&publishedTo=${encodeURIComponent(updatedTo)}&stages=tender`;

  const [fts, cf] = await Promise.all([
    fetchEndpoint(ftsUrl, 'UK_FTS', 'https://www.find-tender.service.gov.uk/Notice', 'Find-a-Tender'),
    fetchEndpoint(cfUrl, 'UK_CONTRACTS_FINDER', 'https://www.contractsfinder.service.gov.uk/Notice', 'Contracts-Finder'),
  ]);

  const merged = [...fts.records, ...cf.records];

  if (fts.ok || cf.ok) {
    console.log(`[UK-FTS] Parsed ${merged.length} procurement records (FTS ${fts.records.length} + CF ${cf.records.length}).`);
    writeCache(merged);
  } else {
    console.warn('[UK-FTS] Both endpoints failed — returning none, cache left intact.');
  }

  return merged;
}
