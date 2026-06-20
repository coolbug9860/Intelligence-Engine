/**
 * blsReferenceService.ts (Task 6)
 *
 * Decoupled BLS macroeconomic REFERENCE layer — NOT an ingestion stream.
 *
 * Provides a daily-refreshed, deeply-cached static table of Producer Price Index
 * (PPI) macro weight vectors, keyed by Kaiso sector. It is read read-only by the
 * scoring engine (Task 6.1) and never participates in the Promise.allSettled
 * ingestion fan-out (Req 4.1).
 *
 * Initial series (Req 10):
 *   - PCU334413334413 → "Technology/Semiconductors"
 *   - PCU325412325412 → "Pharmaceutical Manufacturing"
 *
 * Resilient by design (Req 4.2, 4.3): cache-first (24h /tmp); on any failure it
 * returns the last good cached table, or an empty table when none exists — never throws.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 10.1, 10.2, 10.3, 10.4, 10.5
 *
 * NOTE: BLS API v2 uses its OWN optional `registrationkey` (BLS_API_KEY), distinct
 * from DATA_GOV_API_KEY. Read by name; absent → keyless (unregistered) tier, which is
 * ample for a daily 2-series refresh. The response shape is coded to the documented v2
 * contract; validate against the live API before production.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface BlsSectorReference {
  vertical: string;    // Kaiso sector key
  ppiIndex: number;    // latest Producer Price Index value
  ppiYoyPct: number;   // YoY % change (sector cost pressure)
  wageIndex: number;   // reserved (0 until a wage series is configured)
  wageYoyPct: number;  // reserved (0 until a wage series is configured)
  refreshedAt: string; // ISO timestamp of the row
}

export type BlsReferenceTable = Record<string, BlsSectorReference>;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const BLS_BASE_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms — daily refresh
const REQUEST_TIMEOUT_MS = 10_000;

/** One-to-one PPI series → Kaiso sector mapping (Req 10.1, 10.2, 10.4). */
const SERIES_VERTICAL_MAP: Record<string, string> = {
  PCU334413334413: 'Technology/Semiconductors',
  PCU325412325412: 'Pharmaceutical Manufacturing',
};

function cacheFile(): string {
  return process.env.BLS_CACHE_PATH ?? path.join('/tmp', 'bls-reference.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE (24h TTL)
// ─────────────────────────────────────────────────────────────────────────────

interface BlsCache {
  fetchedAt: string;
  table: BlsReferenceTable;
}

function readCache(): BlsCache | null {
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BlsCache;
  } catch {
    return null;
  }
}

function writeCache(table: BlsReferenceTable): void {
  try {
    const cache: BlsCache = { fetchedAt: new Date().toISOString(), table };
    fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[BLS] Failed to write cache:', err);
  }
}

function isCacheValid(cache: BlsCache): boolean {
  return Date.now() - new Date(cache.fetchedAt).getTime() < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE
// ─────────────────────────────────────────────────────────────────────────────

/** Compute the latest index value and YoY % change from a BLS series' data points. */
function computeSeries(dataPoints: any[]): { ppiIndex: number; ppiYoyPct: number } {
  const valid = (dataPoints ?? []).filter((d) => d && !Number.isNaN(Number(d.value)));
  if (valid.length === 0) return { ppiIndex: 0, ppiYoyPct: 0 };

  // BLS returns most-recent first.
  const latest = valid[0];
  const latestVal = Number(latest.value);

  const priorYear = valid.find(
    (d) => d.period === latest.period && Number(d.year) === Number(latest.year) - 1
  );
  const ppiYoyPct =
    priorYear && Number(priorYear.value) !== 0
      ? ((latestVal - Number(priorYear.value)) / Number(priorYear.value)) * 100
      : 0;

  return { ppiIndex: latestVal, ppiYoyPct: Number(ppiYoyPct.toFixed(2)) };
}

function buildTable(seriesResults: any[]): BlsReferenceTable {
  const refreshedAt = new Date().toISOString();
  const table: BlsReferenceTable = {};
  for (const series of seriesResults ?? []) {
    const vertical = SERIES_VERTICAL_MAP[series?.seriesID];
    if (!vertical) continue; // exclude unmapped/invalid series (Req 10.5)
    const { ppiIndex, ppiYoyPct } = computeSeries(series?.data);
    table[vertical] = { vertical, ppiIndex, ppiYoyPct, wageIndex: 0, wageYoyPct: 0, refreshedAt };
  }
  return table;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the daily BLS reference table. Cache-first (24h). On any failure, returns
 * the last good cached table, or an empty table when none exists (Req 4.3). Never throws.
 */
export async function getBlsReferenceTable(): Promise<BlsReferenceTable> {
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    return cached.table;
  }

  const now = new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const key = process.env.BLS_API_KEY ?? '';
    const body: Record<string, unknown> = {
      seriesid: Object.keys(SERIES_VERTICAL_MAP),
      startyear: String(now.getUTCFullYear() - 1),
      endyear: String(now.getUTCFullYear()),
    };
    if (key) body.registrationkey = key;

    const response = await fetch(BLS_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[BLS] HTTP ${response.status} — using last good cache.`);
      return cached?.table ?? {};
    }

    const data = await response.json();
    if (data?.status !== 'REQUEST_SUCCEEDED') {
      console.warn(`[BLS] Non-success status "${data?.status}" — using last good cache.`);
      return cached?.table ?? {};
    }

    const table = buildTable(data?.Results?.series);
    writeCache(table);
    return table;
  } catch (err) {
    console.warn('[BLS] Refresh failed — using last good cache:', err);
    return cached?.table ?? {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synchronous read used inside the deterministic scoring path. Returns undefined
 * when the vertical is absent (Req 4.4) so scoring stays neutral.
 */
export function lookupSectorReference(
  table: BlsReferenceTable,
  vertical: string
): BlsSectorReference | undefined {
  return table[vertical];
}
