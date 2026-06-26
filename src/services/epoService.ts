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
 * cache, and non-fatal behaviour throughout (warn + return [] / null, never throw).
 * Output: IngestionRecord[].
 *
 * FREE-TIER GUARDRAILS (Task 5.2 — "respect the OPS weekly free-tier quota"):
 *   - 24h success-cache: a fresh fetch suppresses all EPO calls for 24h.
 *   - OAuth token cache: the bearer token is reused until it nears expiry, so we
 *     stop re-authenticating on every cache-miss.
 *   - Persistent WEEKLY request budget (hard-stop): a rolling 7-day counter blocks
 *     ALL upstream requests once the safety threshold is breached.
 *   - Throttle-triggered COOLDOWN (negative cache): a 429/403 from EPO writes a
 *     cooldown marker (honouring Retry-After, default 1h); subsequent runs short-
 *     circuit and return [] until it expires — preventing retry storms.
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
import * as upstash from './upstashKv';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const EPO_AUTH_URL = 'https://ops.epo.org/3.2/auth/accesstoken';
const EPO_SEARCH_URL = 'https://ops.epo.org/3.2/rest-services/published-data/search/biblio';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms — success-cache freshness
const WEEK_MS = 7 * 24 * 60 * 60 * 1000; // rolling weekly budget window
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1h default when Retry-After is absent
const TOKEN_SAFETY_MARGIN_S = 60; // re-auth this many seconds before real expiry

/**
 * Publication lookback window. EPO publishes weekly (Wednesdays), so a 24h window
 * returns nothing ~6 days out of 7. Default 7 days; override via EPO_LOOKBACK_DAYS.
 * Decoupled from the cache TTL.
 */
const LOOKBACK_MS = Number(process.env.EPO_LOOKBACK_DAYS ?? 7) * 24 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 10_000;
const RESULT_RANGE = '1-25'; // bounded page — quota safety
const MAX_EXCERPT_LENGTH = 700;

/** Marker/quota file paths resolved at call time so env overrides apply. */
function cacheFile(): string {
  return process.env.EPO_CACHE_PATH ?? path.join('/tmp', 'epo-cache.json');
}
function cooldownFile(): string {
  return process.env.EPO_COOLDOWN_PATH ?? path.join('/tmp', 'epo-cooldown.json');
}
function weeklyFile(): string {
  return process.env.EPO_WEEKLY_QUOTA_PATH ?? path.join('/tmp', 'epo-weekly-quota.json');
}
function tokenFile(): string {
  return process.env.EPO_TOKEN_PATH ?? path.join('/tmp', 'epo-token.json');
}

/** Weekly upstream-request safety threshold (hard-stop). Override via env. */
function weeklyLimit(): number {
  return Number(process.env.EPO_WEEKLY_LIMIT ?? 1000);
}

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
// THROTTLE COOLDOWN (negative cache) — set on 429/403, honours Retry-After
// Durable via Upstash (key existence + TTL) when configured; /tmp fallback else.
// ─────────────────────────────────────────────────────────────────────────────

/** Durable Redis key for the throttle cooldown (presence = cooling down). */
const COOLDOWN_KEY = 'kaiso:epo:cooldown';

/** Epoch ms until which EPO is in cooldown (0 = none / unreadable). */
function readCooldownUntil(): number {
  try {
    const file = cooldownFile();
    if (!fs.existsSync(file)) return 0;
    const state = JSON.parse(fs.readFileSync(file, 'utf-8')) as { until?: string };
    const t = state?.until ? new Date(state.until).getTime() : NaN;
    return Number.isNaN(t) ? 0 : t;
  } catch {
    return 0;
  }
}

async function isCoolingDown(): Promise<boolean> {
  if (upstash.isConfigured()) {
    const exists = await upstash.kvExists(COOLDOWN_KEY);
    if (exists !== null) return exists; // Redis TTL auto-expires the key.
  }
  return Date.now() < readCooldownUntil();
}

async function writeCooldown(ms: number): Promise<void> {
  if (upstash.isConfigured()) {
    const until = new Date(Date.now() + ms).toISOString();
    const ok = await upstash.kvSetEx(COOLDOWN_KEY, until, Math.ceil(ms / 1000));
    if (ok) return;
  }
  try {
    const until = new Date(Date.now() + ms).toISOString();
    fs.writeFileSync(cooldownFile(), JSON.stringify({ until }), 'utf-8');
  } catch (err) {
    console.warn('[EPO] Failed to persist cooldown:', err);
  }
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms; default 1h. */
function parseRetryAfterMs(response: Response): number {
  try {
    const raw = response?.headers?.get?.('retry-after');
    if (!raw) return DEFAULT_COOLDOWN_MS;
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
    return DEFAULT_COOLDOWN_MS;
  } catch {
    return DEFAULT_COOLDOWN_MS;
  }
}

/** True if the response is an upstream throttle/quota rejection. */
function isThrottled(response: Response): boolean {
  return response.status === 429 || response.status === 403;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY REQUEST BUDGET (persistent hard-stop) — rolling 7-day window
// ─────────────────────────────────────────────────────────────────────────────

interface WeeklyState {
  weekStart: string; // ISO timestamp the current window opened
  count: number; // upstream requests spent this window
}

/** Read the current week's budget, auto-resetting when the window has elapsed. */
function readWeekly(): WeeklyState {
  const now = Date.now();
  try {
    const file = weeklyFile();
    if (fs.existsSync(file)) {
      const stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as WeeklyState;
      if (
        stored?.weekStart &&
        typeof stored.count === 'number' &&
        now - new Date(stored.weekStart).getTime() < WEEK_MS
      ) {
        return stored;
      }
    }
  } catch {
    /* fall through to a fresh window */
  }
  return { weekStart: new Date(now).toISOString(), count: 0 };
}

/**
 * Reserve ONE upstream request against the weekly budget. Returns false (and does
 * NOT increment) when the safety threshold is already reached — the hard-stop.
 *
 * Prefers a durable Upstash counter (atomic INCR, survives Render restarts) keyed
 * to a fixed epoch-aligned 7-day bucket; falls back to the /tmp rolling-window file
 * when Upstash is unset or unreachable.
 */
async function tryReserveWeeklyRequest(): Promise<boolean> {
  const limit = weeklyLimit();
  if (upstash.isConfigured()) {
    const bucket = Math.floor(Date.now() / WEEK_MS);
    const key = `kaiso:epo:quota:week:${bucket}`;
    const count = await upstash.kvIncr(key);
    if (count !== null) {
      if (count === 1) await upstash.kvExpire(key, 14 * 24 * 60 * 60); // 14d cleanup
      return count <= limit;
    }
    // Upstash unavailable → fall through to the local file gate.
  }
  const state = readWeekly();
  if (state.count >= limit) return false;
  try {
    fs.writeFileSync(
      weeklyFile(),
      JSON.stringify({ weekStart: state.weekStart, count: state.count + 1 }),
      'utf-8'
    );
  } catch (err) {
    console.warn('[EPO] Failed to persist weekly quota:', err);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH TOKEN CACHE — reuse the bearer token until it nears expiry
// ─────────────────────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms (already includes the safety margin)
}

function readTokenCache(): TokenCache | null {
  try {
    const file = tokenFile();
    if (!fs.existsSync(file)) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf-8')) as TokenCache;
    if (typeof state?.token === 'string' && typeof state?.expiresAt === 'number') return state;
  } catch {
    /* ignore */
  }
  return null;
}

function writeTokenCache(token: string, expiresInSec: number): void {
  const expiresAt = Date.now() + Math.max(0, expiresInSec - TOKEN_SAFETY_MARGIN_S) * 1000;
  try {
    fs.writeFileSync(tokenFile(), JSON.stringify({ token, expiresAt }), 'utf-8');
  } catch (err) {
    console.warn('[EPO] Failed to persist token cache:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** YYYYMMDD in UTC. */
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
  const from = new Date(now.getTime() - LOOKBACK_MS);
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
// OAUTH2 — client-credentials grant (token-cached, budget-gated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acquire an OPS bearer token via the client-credentials grant. Reuses a cached
 * token until it nears expiry. Reads keys from env by NAME only at call time.
 * Returns null (non-fatal) on missing creds, exhausted weekly budget, throttling,
 * or any failure. A 429/403 writes a cooldown marker.
 */
async function getAccessToken(): Promise<string | null> {
  const cached = readTokenCache();
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const key = process.env.EPO_CONSUMER_KEY ?? '';
  const secret = process.env.EPO_CONSUMER_SECRET ?? '';
  if (!key || !secret) {
    console.warn('[EPO] EPO_CONSUMER_KEY / EPO_CONSUMER_SECRET not configured — skipping.');
    return null;
  }

  // Hard-stop: never issue an auth request once the weekly budget is spent.
  if (!(await tryReserveWeeklyRequest())) {
    console.warn('[EPO] Weekly request budget exhausted — auth skipped.');
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

    if (isThrottled(response)) {
      const ms = parseRetryAfterMs(response);
      console.warn(`[EPO] Auth throttled (HTTP ${response.status}) — cooling down ~${Math.round(ms / 1000)}s.`);
      await writeCooldown(ms);
      return null;
    }
    if (!response.ok) {
      console.warn(`[EPO] Auth HTTP ${response.status} — skipping.`);
      return null;
    }

    const data = await response.json();
    const token = data?.access_token;
    if (typeof token === 'string' && token.length > 0) {
      const expiresIn = Number(data?.expires_in);
      writeTokenCache(token, Number.isFinite(expiresIn) ? expiresIn : 0);
      return token;
    }
    return null;
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
    // Attributes must be strings — a non-string (e.g. a number) must never leak
    // into the IngestionRecord. Non-string country/doc-number → skip the record.
    const country = typeof doc?.['@country'] === 'string' ? doc['@country'] : '';
    const docNumber = typeof doc?.['@doc-number'] === 'string' ? doc['@doc-number'] : '';
    const kind = typeof doc?.['@kind'] === 'string' ? doc['@kind'] : '';
    if (!country || !docNumber) return null;

    const externalId = `${country}${docNumber}${kind}`;

    const biblio = doc?.['bibliographic-data'] ?? {};

    // Title: prefer English, else first available.
    const titles = asArray<any>(biblio?.['invention-title']);
    const enTitle = titles.find((t) => t?.['@lang'] === 'en') ?? titles[0];
    const headline = textOf(enTitle).trim();
    const lang = enTitle?.['@lang'];
    const language = typeof lang === 'string' && lang.length > 0 ? lang : 'en';

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
 * Guardrail order: 24h success-cache → throttle cooldown → (token-cached) auth,
 * weekly-budget-gated → biblio search. Non-fatal throughout: missing creds, an
 * active cooldown, an exhausted weekly budget, auth/search failure, throttling,
 * timeout, or parse errors all log and yield [] rather than throwing.
 */
export async function fetchEpoPatents(): Promise<IngestionRecord[]> {
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(`[EPO] Cache hit — ${cached.records.length} records.`);
    return cached.records;
  }

  // Negative cache: a recent 429/403 parks us until the cooldown expires.
  if (await isCoolingDown()) {
    console.warn('[EPO] In cooldown after upstream throttling — skipping until it expires.');
    return [];
  }

  const token = await getAccessToken();
  if (!token) return [];

  // Hard-stop: never issue the search request once the weekly budget is spent.
  if (!(await tryReserveWeeklyRequest())) {
    console.warn('[EPO] Weekly request budget exhausted — search skipped.');
    return [];
  }

  try {
    const q = buildPublicationDateQuery(new Date());
    const url = `${EPO_SEARCH_URL}?q=${encodeURIComponent(q)}&Range=${RESULT_RANGE}`;
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (isThrottled(response)) {
      const ms = parseRetryAfterMs(response);
      console.warn(`[EPO] Search throttled (HTTP ${response.status}) — cooling down ~${Math.round(ms / 1000)}s.`);
      await writeCooldown(ms);
      return [];
    }
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
