/**
 * epoService.ts (Task 5.2)
 *
 * EU EPO patent connector — the fifth zero-cost ingestion stream.
 *
 * Uses the EPO Open Patent Services (OPS) v3.2 API:
 *   1. OAuth2 client-credentials grant (Basic auth with consumer key/secret) → bearer token.
 *   2. published-data biblio search scoped to a strict rolling 24h UTC publication window.
 *
 * Mirrors the established connector pattern: credentials read from env by NAME only,
 * native `fetch` with a 10s AbortController timeout, a 24h (86,400,000 ms) /tmp disk
 * cache to respect EPO's weekly free-tier quota, and non-fatal behaviour throughout
 * (warn + return [] / null, never throw). Output: IngestionRecord[].
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 9.x, 11.4, 12.4
 *
 * NOTE: The OPS auth endpoint, biblio response shape, and CQL date syntax are
 * implemented to the documented v3.2 contract. They should be validated against a
 * live key before production, as that cannot be exercised in this environment.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IngestionRecord } from './ingestion/ingestionTypes';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const EPO_AUTH_URL = 'https://ops.epo.org/3.2/auth/accesstoken';
const EPO_SEARCH_URL = 'https://ops.epo.org/3.2/rest-services/published-data/search/biblio';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms

/** Cache path resolved at call time so it honours EPO_CACHE_PATH overrides. */
function cacheFile(): string {
  return process.env.EPO_CACHE_PATH ?? path.join('/tmp', 'epo-cache.json');
}

const REQUEST_TIMEOUT_MS = 10_000;
const RESULT_RANGE = '1-25';      // bounded page — quota safety
const MAX_EXCERPT_LENGTH = 700;

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE (24h TTL) — same shape as samGovService/edgarService
// ─────────────────────────────────────────────────────────────────────────────

interface EpoCache {
  fetchedAt: string;
  records: IngestionRecord[];
}

function readCache(): EpoCache | null {
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as EpoCache;
  } catch {
    return null;
  }
}

function writeCache(records: IngestionRecord[]): void {
  try {
    const cache: EpoCache = { fetchedAt: new Date().toISOString(), records };
    fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[EPO] Failed to write cache:', err);
  }
}

function isCacheValid(cache: EpoCache): boolean {
  return Date.now() - new Date(cache.fetchedAt).getTime() < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** YYYYMMDD in UTC for an offset of `daysAgo` days. */
function utcYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Strict rolling 24h UTC publication-date CQL clause, e.g.
 * `pd within "20260618 20260619"`. Pure + exported for testability (Req 9.x).
 */
export function buildPublicationDateQuery(now: Date): string {
  const from = new Date(now.getTime() - CACHE_TTL_MS);
  return `pd within "${utcYmd(from)} ${utcYmd(now)}"`;
}

/** Normalize OPS JSON nodes that are "object or array" into an array. */
function asArray<T>(node: T | T[] | undefined | null): T[] {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

/** OPS text nodes are `{ "$": "value" }`. Extract the string safely. */
function textOf(node: unknown): string {
  if (node && typeof node === 'object' && '$' in (node as Record<string, unknown>)) {
    const v = (node as Record<string, unknown>)['$'];
    return typeof v === 'string' ? v : '';
  }
  return typeof node === 'string' ? node : '';
}

/** Convert a YYYYMMDD docdb date to an ISO timestamp; null if unparseable. */
function ymdToIso(ymd: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
}

/** `fetch` with a 10s AbortController timeout (mirrors the keyword gate). */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH2 — client-credentials grant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acquire an OPS bearer token via the client-credentials grant. Reads keys from
 * env by NAME only at call time. Returns null (non-fatal) on missing creds or any
 * failure.
 */
async function getAccessToken(): Promise<string | null> {
  const key = process.env.EPO_CONSUMER_KEY ?? '';
  const secret = process.env.EPO_CONSUMER_SECRET ?? '';

  if (!key || !secret) {
    console.warn('[EPO] EPO_CONSUMER_KEY / EPO_CONSUMER_SECRET not configured — skipping.');
    return null;
  }

  try {
    const basic = Buffer.from(`${key}:${secret}`).toString('base64');
    const response = await fetchWithTimeout(EPO_AUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
      console.warn(`[EPO] Auth HTTP ${response.status} — skipping.`);
      return null;
    }
    const data = await response.json();
    const token = data?.access_token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (err) {
    console.warn('[EPO] Auth request failed:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE — OPS exchange-document → IngestionRecord
// ─────────────────────────────────────────────────────────────────────────────

function parseExchangeDocument(doc: any): IngestionRecord | null {
  try {
    const country = doc?.['@country'] ?? '';
    const docNumber = doc?.['@doc-number'] ?? '';
    const kind = doc?.['@kind'] ?? '';
    if (!country || !docNumber) return null;

    const externalId = `${country}${docNumber}${kind}`;

    const biblio = doc?.['bibliographic-data'] ?? {};

    // Title: prefer English, else first available.
    const titles = asArray<any>(biblio?.['invention-title']);
    const enTitle = titles.find((t) => t?.['@lang'] === 'en') ?? titles[0];
    const headline = textOf(enTitle).trim();
    const language = (enTitle?.['@lang'] as string) || 'en';

    // Abstract: prefer English, fall back to the title so the gate has text.
    const abstracts = asArray<any>(doc?.['abstract']);
    const enAbstract = abstracts.find((a) => a?.['@lang'] === 'en') ?? abstracts[0];
    const abstractParas = asArray<any>(enAbstract?.['p']);
    const abstractText = abstractParas.map(textOf).join(' ').trim();
    const abstract = abstractText || headline;

    if (!headline) return null;

    // Publication date from any document-id carrying a date.
    const pubIds = asArray<any>(biblio?.['publication-reference']?.['document-id']);
    let iso: string | null = null;
    for (const id of pubIds) {
      const d = textOf(id?.['date']);
      iso = d ? ymdToIso(d) : null;
      if (iso) break;
    }

    const docdb = `${country}.${docNumber}.${kind}`;
    return {
      source_system: 'EU_EPO',
      content_type: 'epo_patent',
      jurisdiction: country,
      headline,
      abstract: abstract.slice(0, MAX_EXCERPT_LENGTH),
      source_url: `https://worldwide.espacenet.com/publicationDetails/biblio?CC=${country}&NR=${docNumber}&KC=${kind}`,
      full_text_url: `https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/${docdb}/description`,
      tracking_timestamp: iso ?? new Date().toISOString(),
      external_id: externalId,
      vertical_hint: null,
      language,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch recent EU EPO patent publications as IngestionRecord[].
 *
 * Cache-first (24h /tmp). Non-fatal: missing creds, auth failure, search failure,
 * timeout, or parse errors all log and yield [] (or fewer records) rather than throwing.
 */
export async function fetchEpoPatents(): Promise<IngestionRecord[]> {
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(`[EPO] Cache hit — ${cached.records.length} records.`);
    return cached.records;
  }

  const token = await getAccessToken();
  if (!token) return [];

  try {
    const q = buildPublicationDateQuery(new Date());
    const url = `${EPO_SEARCH_URL}?q=${encodeURIComponent(q)}&Range=${RESULT_RANGE}`;
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      console.warn(`[EPO] Search HTTP ${response.status} — returning none.`);
      return [];
    }

    const data = await response.json();
    const documents = asArray<any>(
      data?.['ops:world-patent-data']?.['exchange-documents']?.['exchange-document']
    );

    const records: IngestionRecord[] = [];
    for (const doc of documents) {
      const record = parseExchangeDocument(doc);
      if (record) records.push(record);
    }

    console.log(`[EPO] Parsed ${records.length} patent records.`);
    writeCache(records);
    return records;
  } catch (err) {
    console.warn('[EPO] Search request failed:', err);
    return [];
  }
}
