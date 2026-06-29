/**
 * adzunaService.ts
 *
 * Hiring-momentum connector — the sixth ingestion stream.
 *
 * Uses the Adzuna Jobs API (https://api.adzuna.com/v1/api). Rather than dumping
 * noisy individual postings, this connector reads the TOTAL active-vacancy `count`
 * (last 30 days) for a few broad vertical keyword groups and synthesizes ONE dense
 * "hiring momentum" IngestionRecord per group — a leading indicator of where
 * enterprises are actively staffing up (and therefore about to spend). Top hiring
 * employers and a few sample roles are folded in from the same response, so no
 * extra calls are needed.
 *
 * Mirrors the established connector pattern: credentials read from env by NAME only
 * (ADZUNA_APP_ID / ADZUNA_APP_KEY), native `fetch` with a 10s AbortController
 * timeout, a 24h /tmp disk cache, and non-fatal behaviour throughout (warn +
 * return [] / fewer records, never throw). Output: IngestionRecord[].
 *
 * The keyword groups intentionally reuse the local keyword-gate vocabulary, and the
 * synthesized abstract embeds those exact terms, so every emitted record passes the
 * zero-LLM gate without a special case.
 *
 * NOTE: response shape coded to the documented Adzuna v1 contract; validate against
 * a live key on first deploy. Missing credentials → clean skip (returns []).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IngestionRecord } from './ingestion/ingestionTypes';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms — cache freshness
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_DAYS_OLD = 30;        // active-vacancy lookback window
const RESULTS_PER_PAGE = 10;    // we only need a sample for top-hirers/roles
const MAX_EXCERPT_LENGTH = 700;
const MAX_TOP_COMPANIES = 5;
const MAX_SAMPLE_ROLES = 3;

/** Two-letter Adzuna country code (default 'us'; override via ADZUNA_COUNTRY). */
function country(): string {
  return (process.env.ADZUNA_COUNTRY ?? 'us').toLowerCase();
}

function cacheFile(): string {
  return process.env.ADZUNA_CACHE_PATH ?? path.join('/tmp', 'adzuna-cache.json');
}

/**
 * Three broad keyword groups (terms drawn from the local keyword-gate vocabulary
 * so every synthesized record passes the gate). Each becomes ONE Adzuna `what_or`
 * query and ONE synthesized hiring-momentum record.
 */
interface QueryGroup {
  key: string;
  label: string;
  terms: string[];
}

const QUERY_GROUPS: readonly QueryGroup[] = [
  {
    key: 'health-tech',
    label: 'Healthcare, Semiconductor & Tech',
    terms: ['semiconductor', 'medical device', 'clinical trial', 'data center', 'cybersecurity', 'cloud migration'],
  },
  {
    key: 'energy-mobility',
    label: 'Energy, Mobility & Chemicals',
    terms: ['electric vehicle', 'battery', 'renewable energy', 'energy storage', 'hydrogen', 'specialty chemicals'],
  },
  {
    key: 'finance-industrial',
    label: 'Finance, Defense & Industrial',
    terms: ['digital payments', 'embedded finance', 'defense procurement', 'supply chain', 'precision agriculture', 'modular construction'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE (24h TTL) — same shape as the other connectors
// ─────────────────────────────────────────────────────────────────────────────

interface AdzunaCache {
  fetchedAt: string;
  records: IngestionRecord[];
}

function readCache(): AdzunaCache | null {
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as AdzunaCache;
  } catch {
    return null;
  }
}

function writeCache(records: IngestionRecord[]): void {
  try {
    const cache: AdzunaCache = { fetchedAt: new Date().toISOString(), records };
    fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Adzuna] Failed to write cache:', err);
  }
}

function isCacheValid(cache: AdzunaCache): boolean {
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

function buildUrl(group: QueryGroup, appId: string, appKey: string): string {
  const params = new URLSearchParams();
  params.set('app_id', appId);
  params.set('app_key', appKey);
  params.set('what_or', group.terms.join(' '));
  params.set('max_days_old', String(MAX_DAYS_OLD));
  params.set('results_per_page', String(RESULTS_PER_PAGE));
  params.set('content-type', 'application/json');
  return `${ADZUNA_BASE}/${country()}/search/1?${params.toString()}`;
}

/** Distinct employer display names from the result sample, in first-seen order. */
function topCompanies(results: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    const name = typeof r?.company?.display_name === 'string' ? r.company.display_name.trim() : '';
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
      if (out.length >= MAX_TOP_COMPANIES) break;
    }
  }
  return out;
}

function sampleRoles(results: any[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    const title = typeof r?.title === 'string' ? r.title.replace(/\s+/g, ' ').trim() : '';
    if (title) out.push(title);
    if (out.length >= MAX_SAMPLE_ROLES) break;
  }
  return out;
}

/** Synthesize one hiring-momentum IngestionRecord from a group's search response. */
function synthesizeRecord(group: QueryGroup, data: any, now: Date): IngestionRecord | null {
  const count = Number(data?.count);
  if (!Number.isFinite(count) || count <= 0) return null; // no live hiring → no signal

  const results = Array.isArray(data?.results) ? data.results : [];
  const companies = topCompanies(results);
  const roles = sampleRoles(results);
  const cc = country().toUpperCase();
  const termList = group.terms.join(', ');

  const headline = `Hiring momentum (${group.label}): ${count.toLocaleString('en-US')} active ${cc} job openings — last ${MAX_DAYS_OLD} days`;

  // The abstract embeds the exact gate terms so the keyword gate always matches.
  const parts = [
    `Job-market signal: ${count.toLocaleString('en-US')} live ${cc} openings over the last ${MAX_DAYS_OLD} days across ${termList}.`,
  ];
  if (companies.length) parts.push(`Top hiring employers: ${companies.join(', ')}.`);
  if (roles.length) parts.push(`Representative roles: ${roles.join('; ')}.`);
  const abstract = parts.join(' ').slice(0, MAX_EXCERPT_LENGTH);

  return {
    source_system: 'ADZUNA_JOBS',
    content_type: 'hiring_signal',
    jurisdiction: cc,
    headline,
    abstract,
    source_url: `https://www.adzuna.com/search?q=${encodeURIComponent(group.terms[0])}`,
    full_text_url: null, // synthesized aggregate — nothing to lazily fetch
    tracking_timestamp: now.toISOString(),
    external_id: `adzuna-${country()}-${group.key}-${utcYmd(now)}`,
    vertical_hint: null, // group spans multiple verticals — let downstream decide
    language: 'en',
  };
}

async function fetchGroup(group: QueryGroup, appId: string, appKey: string, now: Date): Promise<IngestionRecord | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(group, appId, appKey), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[Adzuna] HTTP ${response.status} for "${group.key}" — skipping group.`);
      return null;
    }
    const data = await response.json();
    return synthesizeRecord(group, data, now);
  } catch (err) {
    console.warn(`[Adzuna] Request failed for "${group.key}":`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch hiring-momentum signals as IngestionRecord[].
 *
 * Cache-first (24h /tmp). Reads ADZUNA_APP_ID + ADZUNA_APP_KEY by name; absent →
 * warn + []. Non-fatal: per-group HTTP/network/timeout/parse failures yield fewer
 * records, never throw. At most 3 upstream calls per cache-miss run.
 */
export async function fetchAdzunaHiringSignals(): Promise<IngestionRecord[]> {
  const cached = readCache();
  if (cached && isCacheValid(cached)) {
    console.log(`[Adzuna] Cache hit — ${cached.records.length} records.`);
    return cached.records;
  }

  const appId = process.env.ADZUNA_APP_ID ?? '';
  const appKey = process.env.ADZUNA_APP_KEY ?? '';
  if (!appId || !appKey) {
    console.warn('[Adzuna] ADZUNA_APP_ID / ADZUNA_APP_KEY not configured — skipping.');
    return [];
  }

  const now = new Date();
  const settled = await Promise.all(
    QUERY_GROUPS.map((g) => fetchGroup(g, appId, appKey, now))
  );
  const records = settled.filter((r): r is IngestionRecord => r != null);

  console.log(`[Adzuna] Synthesized ${records.length} hiring-momentum record(s).`);
  writeCache(records);
  return records;
}
