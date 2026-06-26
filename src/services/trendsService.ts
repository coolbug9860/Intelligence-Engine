/**
 * trendsService.ts
 *
 * Post-processing enrichment step — runs AFTER Gemini outputs the 8
 * suggestions. Queries Google Trends for each suggestion's marketKeyword
 * and appends three fields to every suggestion:
 *
 *   trendScore         — current interest level, 0–100 (Google's scale)
 *   trendDirection     — 'RISING' | 'STABLE' | 'DECLINING'
 *   trendDirectionLabel — human-readable label for the UI
 *
 * Google Trends is completely free and requires no API key.
 * This uses the unofficial `google-trends-api` npm package which wraps
 * Google's internal trends endpoint.
 *
 * IMPORTANT: This step is non-fatal. If Google Trends is unavailable or
 * rate-limits the requests, suggestions are returned unchanged. The core
 * pipeline never breaks because of trend enrichment.
 */

import googleTrends from 'google-trends-api';
import { ReportSuggestion } from '../types';
import * as upstash from './upstashKv';

// ─────────────────────────────────────────────────────────────────────────────
// UPSTASH CACHE KEYS (shared with scripts/fetchTrendsToUpstash.ts)
//
// The GitHub Action fetches Google Trends from a non-Render IP and writes results
// here; Render reads cache-first and enqueues misses for the next Action run.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-keyword cached result key. Versioned so the shape can evolve safely. */
export function trendCacheKey(cleanedKeyword: string): string {
  return `kaiso:trend:v1:${cleanedKeyword}`;
}

/** Set of cleaned keywords the app wanted but missed — the Action's work queue. */
export const TREND_REQUESTED_SET = 'kaiso:trend:requested';

/** Cached payload shape stored in Upstash. */
export interface CachedTrend {
  trendScore: number;
  trendDirection: TrendDirection;
  trendDirectionLabel: string;
  fetchedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

// Look back 12 months — long enough to calculate direction reliably
const LOOKBACK_MONTHS = 12;

// Compare last 3 months vs previous 3 months to determine direction
const TREND_WINDOW_MONTHS = 3;

// Minimum % difference between windows to call something RISING or DECLINING
// Below this threshold = STABLE
const DIRECTION_THRESHOLD_PCT = 15;

// Delay between Trends requests — Google will rate-limit aggressive polling
const REQUEST_DELAY_MS = 1200;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type TrendDirection = 'RISING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';

export interface TrendResult {
  keyword: string;
  trendScore: number;           // Most recent interest value, 0–100
  trendDirection: TrendDirection;
  trendDirectionLabel: string;  // e.g. "📈 Rising" — ready for the UI
  recentAvg: number;            // Last 3-month average
  previousAvg: number;          // Prior 3-month average
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE QUERY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query Google Trends for a single keyword.
 * Returns null if the request fails for any reason.
 */
/**
 * Clean a raw marketKeyword (e.g. "global electric vehicle battery market")
 * into a Google Trends-friendly search term ("electric vehicle battery").
 * Google Trends has no data for overly specific phrases with "global" or "market".
 */
export function cleanKeyword(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^global\s+/i, '')          // strip leading "global "
    .replace(/\s+market$/i, '')          // strip trailing " market"
    .replace(/\s+industry$/i, '')        // strip trailing " industry"
    .replace(/\s+sector$/i, '')          // strip trailing " sector"
    .replace(/\s+solutions$/i, '')       // strip trailing " solutions"
    .trim();
}

async function queryTrends(keyword: string): Promise<TrendResult | null> {
  const startTime = new Date();
  startTime.setMonth(startTime.getMonth() - LOOKBACK_MONTHS);

  // Clean the keyword before sending to Google Trends
  const cleanedKeyword = cleanKeyword(keyword);

  try {
    const rawResult = await googleTrends.interestOverTime({
      keyword: cleanedKeyword,
      startTime,
      geo: '',          // Worldwide
      hl: 'en-US',
    });

    const parsed = JSON.parse(rawResult);
    const timelineData: Array<{ value: number[] }> =
      parsed?.default?.timelineData ?? [];

    if (timelineData.length < TREND_WINDOW_MONTHS * 2) {
      // Not enough data points to calculate direction
      return {
        keyword: cleanedKeyword,
        trendScore: 0,
        trendDirection: 'UNKNOWN',
        trendDirectionLabel: '— Unknown',
        recentAvg: 0,
        previousAvg: 0,
      };
    }

    // Extract the interest values (each entry = one week of data)
    const values = timelineData.map((d) => d.value[0] ?? 0);

    // Most recent value = current score
    const trendScore = values[values.length - 1];

    // Split into windows — approximate months using 4 weeks per month
    const weeksPerWindow = TREND_WINDOW_MONTHS * 4;
    const recentWindow = values.slice(-weeksPerWindow);
    const previousWindow = values.slice(
      -weeksPerWindow * 2,
      -weeksPerWindow
    );

    const recentAvg = average(recentWindow);
    const previousAvg = average(previousWindow);

    const direction = calcDirection(recentAvg, previousAvg);

    return {
      keyword: cleanedKeyword,
      trendScore,
      trendDirection: direction,
      trendDirectionLabel: directionLabel(direction, recentAvg),
      recentAvg: Math.round(recentAvg),
      previousAvg: Math.round(previousAvg),
    };
  } catch (err) {
    console.warn(`[Trends] Failed for "${cleanedKeyword}" (raw: "${keyword}"):`, (err as Error).message ?? err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function average(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calcDirection(recent: number, previous: number): TrendDirection {
  if (previous === 0 && recent === 0) return 'UNKNOWN';
  if (previous === 0) return 'RISING'; // went from zero to something

  const changePct = ((recent - previous) / previous) * 100;

  if (changePct >= DIRECTION_THRESHOLD_PCT) return 'RISING';
  if (changePct <= -DIRECTION_THRESHOLD_PCT) return 'DECLINING';
  return 'STABLE';
}

function directionLabel(direction: TrendDirection, score: number): string {
  switch (direction) {
    case 'RISING':    return `📈 Rising (${Math.round(score)})`;
    case 'DECLINING': return `📉 Declining (${Math.round(score)})`;
    case 'STABLE':    return `➡️ Stable (${Math.round(score)})`;
    case 'UNKNOWN':   return '— No data';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-KEYWORD EXPORT (used by the ground-truth ledger's trend re-checks)
//
// Thin wrapper over the internal queryTrends() so outcomeLedger can re-poll a
// single marketKeyword at the 30/60/90-day checkpoints without duplicating the
// Google Trends query/parse logic. Returns null on any failure (non-fatal).
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchKeywordTrend(keyword: string): Promise<TrendResult | null> {
  return queryTrends(keyword);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * enrichWithTrends()
 *
 * Takes the final curatedPortfolio suggestions and appends trend fields.
 *
 * When Upstash is configured (production): reads each keyword's trend from the
 * Upstash cache that the scheduled GitHub Action populates from a non-blocked IP.
 * A cache MISS enqueues the keyword for the next Action run and yields UNKNOWN —
 * Render never calls Google directly (its IP is blocked, so it would only waste
 * time). Eventually-consistent: new keywords resolve within one Action cycle.
 *
 * When Upstash is NOT configured (dev/local): falls back to the legacy direct
 * Google Trends query, preserving the original behavior.
 *
 * Non-fatal throughout: any failure leaves suggestions with UNKNOWN trend fields.
 */
export async function enrichWithTrends(
  suggestions: ReportSuggestion[]
): Promise<ReportSuggestion[]> {
  if (!suggestions.length) return suggestions;

  if (upstash.isConfigured()) {
    return enrichFromCache(suggestions);
  }

  return enrichFromGoogle(suggestions);
}

/** Production path: cache-first via Upstash, enqueue misses for the Action. */
async function enrichFromCache(
  suggestions: ReportSuggestion[]
): Promise<ReportSuggestion[]> {
  console.log(`[Trends] Cache-first enrichment for ${suggestions.length} suggestions...`);
  const enriched: ReportSuggestion[] = [];
  const misses: string[] = [];

  for (const suggestion of suggestions) {
    const keyword = suggestion.marketKeyword;
    if (!keyword) {
      enriched.push(suggestion);
      continue;
    }

    const cleaned = cleanKeyword(keyword);
    let cached: CachedTrend | null = null;
    const raw = await upstash.kvGet(trendCacheKey(cleaned));
    if (raw) {
      try {
        cached = JSON.parse(raw) as CachedTrend;
      } catch {
        cached = null;
      }
    }

    if (cached) {
      enriched.push({
        ...suggestion,
        trendScore: cached.trendScore,
        trendDirection: cached.trendDirection,
        trendDirectionLabel: cached.trendDirectionLabel,
      });
    } else {
      misses.push(cleaned);
      enriched.push({
        ...suggestion,
        trendDirection: 'UNKNOWN',
        trendDirectionLabel: '— No data',
      });
    }
  }

  // Enqueue every miss so the next GitHub Action run fetches it.
  if (misses.length) {
    await upstash.kvSAdd(TREND_REQUESTED_SET, ...misses);
    console.log(`[Trends] ${misses.length} cache miss(es) queued for the next fetch: ${misses.join(', ')}`);
  }
  console.log('[Trends] Cache-first enrichment complete.');
  return enriched;
}

/** Dev/local path: direct Google Trends query (unchanged legacy behavior). */
async function enrichFromGoogle(
  suggestions: ReportSuggestion[]
): Promise<ReportSuggestion[]> {
  console.log(`[Trends] Enriching ${suggestions.length} suggestions...`);

  const enriched: ReportSuggestion[] = [];

  for (const suggestion of suggestions) {
    const keyword = suggestion.marketKeyword;

    if (!keyword) {
      enriched.push(suggestion);
      continue;
    }

    const result = await queryTrends(keyword);

    if (result) {
      enriched.push({
        ...suggestion,
        trendScore: result.trendScore,
        trendDirection: result.trendDirection,
        trendDirectionLabel: result.trendDirectionLabel,
      });

      console.log(
        `[Trends] "${keyword}" → ${result.trendDirectionLabel} | score: ${result.trendScore}`
      );
    } else {
      // Trend fetch failed — return suggestion unchanged
      enriched.push({
        ...suggestion,
        trendDirection: 'UNKNOWN',
        trendDirectionLabel: '— No data',
      });
    }

    // Polite delay between requests
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[Trends] Enrichment complete`);
  return enriched;
}
