/**
 * samGovService.ts (Task 7 — DEMOTED)
 *
 * SAM.gov is no longer a primary discovery stream. The mass vertical→keyword sweep
 * has been removed to protect SAM.gov's ~10 requests/day public limit. SAM is now a
 * SECONDARY, surgical lookup service: it fetches a single notice by ID, only when an
 * ID is surfaced by the Federal Register connector (Module 1).
 *
 * Guarantees:
 *   - `fetchSamNoticeById(noticeId)` issues AT MOST one request per call.
 *   - A persistent daily quota gate (default 10/day, /tmp) hard-stops accidental
 *     over-use: once the day's budget is spent, calls return null WITHOUT a request.
 *   - Empty/whitespace ID, missing key, non-OK, not-found, timeout, or network error
 *     all yield null — non-fatal, never throws.
 *   - The `SamSignal` interface and the SamSignal→EDGARSignal seam are UNCHANGED.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.7
 *
 * NOTE: The by-ID endpoint shape is coded to the documented SAM.gov v2 contract;
 * validate against a live key before production.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL TYPE — UNCHANGED (the SamSignal→EDGARSignal seam depends on this shape)
// ─────────────────────────────────────────────────────────────────────────────

export interface SamSignal {
  title: string;          // Notice title + type, e.g. "Advanced Radar Systems — Solicitation"
  noticeType: string;     // "Solicitation" | "Presolicitation" | "Award Notice" | ...
  agency: string;         // Issuing department / sub-tier organization
  postedDate: string;     // ISO/string date the notice was posted
  excerpt: string;        // Cleaned description text (≤700 chars)
  url: string;            // Human-readable SAM.gov UI link to the notice
  vertical: string;       // Matched Kaiso vertical
  matchedKeyword: string; // The keyword/ID that surfaced this notice
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const SAMGOV_NOTICE_URL = (id: string) =>
  `https://api.sam.gov/opportunities/v2/opportunities/${encodeURIComponent(id)}`;

const SAMGOV_USER_AGENT =
  'KaisoResearch/1.0 (market research intelligence platform; contact@kaisoresearch.com)';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXCERPT_LENGTH = 700;

/** Daily request budget, resolved at call time so overrides apply. */
function dailyLimit(): number {
  return Number(process.env.SAMGOV_DAILY_LIMIT ?? 10);
}

function quotaFile(): string {
  return process.env.SAMGOV_QUOTA_PATH ?? path.join('/tmp', 'samgov-quota.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY QUOTA GATE — persistent protection for the ~10 req/day limit
// ─────────────────────────────────────────────────────────────────────────────

interface QuotaState {
  date: string;  // UTC YYYY-MM-DD the count applies to
  count: number; // requests already spent today
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Read today's quota; resets automatically when the stored date is not today. */
function readQuota(): QuotaState {
  const today = todayUtc();
  try {
    const file = quotaFile();
    if (fs.existsSync(file)) {
      const stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as QuotaState;
      if (stored?.date === today && typeof stored.count === 'number') return stored;
    }
  } catch {
    /* fall through to a fresh count */
  }
  return { date: today, count: 0 };
}

function writeQuota(state: QuotaState): void {
  try {
    fs.writeFileSync(quotaFile(), JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.warn('[SAM.gov] Failed to persist quota:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXCERPT_LENGTH);
}

/** First argument that is a present, non-empty (after trim) string; else ''. */
function firstNonEmptyString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return '';
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': SAMGOV_USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a single SAM.gov opportunity into a SamSignal; null if essentials (title or a usable date) are missing. */
function parseSamNotice(op: any, noticeId: string): SamSignal | null {
  try {
    // Title is the notice's identity — require a real, non-empty string.
    // (firstNonEmptyString rejects non-strings and whitespace-only values, so a
    // numeric/boolean/blank title fails fast rather than producing a poison signal.)
    const title = firstNonEmptyString(op?.title);
    if (!title) return null;

    // Fallback chains use firstNonEmptyString (not `??`) so a non-string value
    // like `type: 0` can never leak a non-string field into the SamSignal.
    const noticeType = firstNonEmptyString(op?.type, op?.baseType) || 'Notice';
    const agency =
      firstNonEmptyString(op?.fullParentPathName, op?.organizationName, op?.department) ||
      'Unknown Agency';

    // A signal without a usable date is poison for chronological tracking and
    // would fail strict downstream adapter validation anyway — fail fast.
    // (Uses firstNonEmptyString, not `??`, so an empty `postedDate` correctly
    // falls through to `publishDate` rather than sticking as ''.)
    const postedDate = firstNonEmptyString(op?.postedDate, op?.publishDate);
    if (!postedDate) return null;

    const rawDescription = firstNonEmptyString(op?.description);
    const looksLikeUrl = /^https?:\/\//i.test(rawDescription.trim());
    const rawExcerpt = looksLikeUrl || !rawDescription ? title : rawDescription;

    const url =
      firstNonEmptyString(op?.uiLink) ||
      `https://sam.gov/opp/${encodeURIComponent(noticeId)}/view`;

    return {
      title: `${title} — ${noticeType}`,
      noticeType,
      agency,
      postedDate,
      excerpt: cleanText(rawExcerpt),
      url,
      vertical: 'General',
      matchedKeyword: noticeId,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — surgical by-ID lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a SINGLE SAM.gov notice by its ID. Returns null (non-fatal "unavailable")
 * for an empty ID, a missing API key, an exhausted daily quota, a non-OK/not-found
 * response, a timeout, or a network error. Issues at most one request, and only when
 * the daily quota permits.
 */
export async function fetchSamNoticeById(noticeId: string): Promise<SamSignal | null> {
  // Guard: no ID → no request (Req 5.3).
  if (!noticeId || !noticeId.trim()) {
    return null;
  }

  const apiKey = process.env.SAM_GOV_API_KEY ?? '';
  if (!apiKey) {
    console.warn('[SAM.gov] SAM_GOV_API_KEY not configured — lookup skipped.');
    return null;
  }

  // Quota gate: hard-stop BEFORE any network call (Req 5.7, budget protection).
  const limit = dailyLimit();
  const quota = readQuota();
  if (quota.count >= limit) {
    console.warn(`[SAM.gov] Daily quota of ${limit} reached — lookup unavailable for "${noticeId}".`);
    return null;
  }

  // Reserve the request against the daily budget before spending it.
  writeQuota({ date: quota.date, count: quota.count + 1 });

  try {
    const params = new URLSearchParams({ api_key: apiKey });
    const url = `${SAMGOV_NOTICE_URL(noticeId)}?${params.toString()}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.warn(`[SAM.gov] HTTP ${response.status} for notice "${noticeId}".`);
      return null;
    }

    const data = await response.json();
    const op = Array.isArray(data?.opportunitiesData)
      ? data.opportunitiesData[0]
      : data?.opportunitiesData ?? data;

    return op ? parseSamNotice(op, noticeId) : null;
  } catch (err) {
    console.warn(`[SAM.gov] Lookup failed for notice "${noticeId}":`, err);
    return null;
  }
}

/**
 * @deprecated SAM.gov mass keyword discovery has been removed (Task 7). This stub
 * remains only so existing imports keep compiling until server.ts is rewired (Task 8).
 * It performs NO network calls and returns no signals. Use `fetchSamNoticeById` for
 * surgical, watchlist-driven lookups instead.
 */
export async function fetchSamGovSignals(_keywords: string[] = []): Promise<SamSignal[]> {
  console.warn('[SAM.gov] fetchSamGovSignals is deprecated and disabled — use fetchSamNoticeById.');
  return [];
}
