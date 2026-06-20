/**
 * tedService.ts (Task 3)
 *
 * EU TED (Tenders Electronic Daily) procurement connector — native, key-free, $0.
 *
 * Uses the public TED Search API v3 (`POST /v3/notices/search`) with an expert query
 * scoped to a strict rolling 24h UTC publication window. No Apify, no third-party
 * scraper. Mirrors the epoService pattern: native `fetch` with a 10s AbortController
 * timeout, 24h (86,400,000 ms) /tmp cache-first, and non-fatal behaviour throughout
 * (warn + return [] / skip, never throw). Output: IngestionRecord[].
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 9.2, 11.4
 *
 * NOTE: TED's expert-query date syntax and the exact notice field shapes are coded to
 * the documented v3 contract; the parser is intentionally defensive (TED fields are
 * deeply nested and multilingual). Validate against the live API before production.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IngestionRecord } from './ingestion/ingestionTypes';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const TED_SEARCH_URL = 'https://api.ted.europa.eu/v3/notices/search';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms
const REQUEST_TIMEOUT_MS = 10_000;
const RESULT_LIMIT = 25; // bounded page — keeps payloads light

function cacheFile(): string {
  return process.env.TED_CACHE_PATH ?? path.join('/tmp', 'ted-cache.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE (24h TTL)
// ─────────────────────────────────────────────────────────────────────────────

interface TedCache {
  fetchedAt: string;
  records: IngestionRecord[];
}

function readCache(): TedCache | null {
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as TedCache;
  } catch {
    return null;
  }
}

function writeCache(records: IngestionRecord[]): void {
  try {
    const cache: TedCache = { fetchedAt: new Date().toISOString(), records };
    fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[TED] Failed to write cache:', err);
  }
}

function isCacheValid(cache: TedCache): boolean {
  return Date.now() - new Date(cache.fetchedAt).getTime() < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function utcYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Strict rolling 24h UTC publication-date expert query, e.g.
 * `PD>=20260618 AND PD<=20260619`. Pure + exported for testability (Req 9.2).
 */
export function buildTedQuery(now: Date): string {
  const from = new Date(now.getTime() - CACHE_TTL_MS);
  return `PD>=${utcYmd(from)} AND PD<=${utcYmd(now)}`;
}

function isEnglish(entry: any): boolean {
  const lang = entry?.language ?? entry?.['@lang'] ?? '';
  return /^(en|eng)$/i.test(String(lang));
}

/**
 * Flatten TED's "string | {value} | language-map | array of {language,value}"
 * field shapes into a single string, preferring English.
 */
function coerceText(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node.trim();
  if (Array.isArray(node)) {
    const chosen = node.find(isEnglish) ?? node[0];
    return coerceText(chosen?.value ?? chosen);
  }
  if (typeof node === 'object') {
    if ('value' in node) return coerceText(node.value);
    const keys = Object.keys(node);
    const enKey = keys.find((k) => /^(en|eng)$/i.test(k));
    const key = enKey ?? keys[0];
    return key ? coerceText(node[key]) : '';
  }
  return String(node).trim();
}

/** Depth-first search for the first http(s) URL anywhere in a links node. */
function findFirstUrl(node: any): string | null {
  if (node == null) return null;
  if (typeof node === 'string') return /^https?:\/\//i.test(node) ? node : null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node)) {
      const found = findFirstUrl(value);
      if (found) return found;
    }
  }
  return null;
}

/** Normalize a TED publication date (YYYYMMDD or ISO) to an ISO timestamp. */
function normalizeDate(raw: string): string {
  const ymd = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00.000Z`;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

/** Map one TED notice to an IngestionRecord; null when essential fields are absent. */
function parseNotice(notice: any): IngestionRecord | null {
  try {
    const externalId = coerceText(notice?.ND ?? notice?.['publication-number']);
    const headline = coerceText(notice?.TI ?? notice?.title);
    if (!externalId || !headline) return null;

    const abstract = coerceText(notice?.DS ?? notice?.description) || headline;
    const jurisdiction = coerceText(notice?.CY ?? notice?.country) || 'EU';
    const pdRaw = coerceText(notice?.PD ?? notice?.['publication-date']);
    const url =
      findFirstUrl(notice?.links) ??
      `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(externalId)}`;

    return {
      source_system: 'EU_TED',
      content_type: 'procurement_notice',
      jurisdiction,
      headline,
      abstract,
      source_url: url,
      full_text_url: url,
      tracking_timestamp: pdRaw ? normalizeDate(pdRaw) : new Date().toISOString(),
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
 * Fetch recent EU TED procurement notices as IngestionRecord[].
 *
 * Cache-first (24h /tmp). Non-fatal: non-OK responses, network errors, timeouts,
 * and per-notice parse failures all log and yield [] (or fewer records), never throw.
 */
export async function fetchTedNotices(): Promise<IngestionRecord[]> {
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(`[TED] Cache hit — ${cached.records.length} records.`);
    return cached.records;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TED_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: buildTedQuery(new Date()),
        fields: ['ND', 'TI', 'DS', 'PD', 'CY', 'links'],
        limit: RESULT_LIMIT,
        scope: 'ACTIVE',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[TED] Search HTTP ${response.status} — returning none.`);
      return [];
    }

    const data = await response.json();
    const notices = Array.isArray(data?.notices) ? data.notices : [];

    const records: IngestionRecord[] = [];
    for (const notice of notices) {
      const record = parseNotice(notice);
      if (record) records.push(record);
    }

    console.log(`[TED] Parsed ${records.length} procurement records.`);
    writeCache(records);
    return records;
  } catch (err) {
    console.warn('[TED] Search request failed:', err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
