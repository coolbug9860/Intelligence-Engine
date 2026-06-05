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
function cleanKeyword(raw: string): string {
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
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * enrichWithTrends()
 *
 * Takes the final 8 curatedPortfolio suggestions, queries Google Trends for
 * each one's marketKeyword, and returns the enriched array with trend fields
 * added. Processes sequentially with a delay to respect rate limits.
 *
 * Non-fatal: suggestions without trend data are returned unchanged.
 */
export async function enrichWithTrends(
  suggestions: ReportSuggestion[]
): Promise<ReportSuggestion[]> {
  if (!suggestions.length) return suggestions;

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
