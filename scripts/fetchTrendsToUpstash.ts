/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO — Off-Render Google Trends fetcher → Upstash
 * scripts/fetchTrendsToUpstash.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Runs in GitHub Actions (NOT on Render), so the Google Trends request originates
 * from a non-Render IP that is far less likely to be blocked. It:
 *
 *   1. Reads the work queue (`kaiso:trend:requested`) the Render app fills on cache
 *      misses, plus a small SEED list so the very first manual run produces output.
 *   2. Fetches Google Trends for each keyword (reusing the app's own logic).
 *   3. Writes each result to `kaiso:trend:v1:<keyword>` with a 14-day TTL.
 *   4. Removes successfully-fetched keywords from the queue.
 *   5. Prints a summary: TOTAL / REAL / UNKNOWN — the signal for whether GitHub's
 *      runner IPs are blocked by Google Trends (all-UNKNOWN ⇒ blocked, pivot plan).
 *
 * Requires env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
 * Run with: npx tsx scripts/fetchTrendsToUpstash.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  fetchKeywordTrend,
  cleanKeyword,
  trendCacheKey,
  TREND_REQUESTED_SET,
  type CachedTrend,
} from '../src/services/trendsService';
import * as upstash from '../src/services/upstashKv';

const CACHE_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days
const REQUEST_DELAY_MS = 1500;               // polite spacing between Google calls

/** Representative keywords seeded on every run so the queue is never empty while
 * validating. These also keep common themes warm in the cache. */
const SEED_KEYWORDS = [
  'electric vehicle battery',
  'generative ai',
  'semiconductor packaging',
  'glp-1 weight loss',
  'green hydrogen',
  'cybersecurity insurance',
  'industrial automation',
  'carbon capture',
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!upstash.isConfigured()) {
    console.error('[TrendsFetch] UPSTASH_REDIS_REST_URL/TOKEN not set — aborting.');
    process.exit(1);
  }

  // Build the work set: queued misses ∪ seed list, normalized + de-duplicated.
  const queued = (await upstash.kvSMembers(TREND_REQUESTED_SET)) ?? [];
  const keywords = [...new Set([...queued, ...SEED_KEYWORDS].map(cleanKeyword))].filter(Boolean);

  console.log(`[TrendsFetch] ${keywords.length} keyword(s) to fetch (${queued.length} queued + ${SEED_KEYWORDS.length} seed).`);

  let real = 0;
  let unknown = 0;
  let failed = 0;

  for (const kw of keywords) {
    const result = await fetchKeywordTrend(kw);

    if (!result) {
      failed += 1;
      console.warn(`[TrendsFetch] ✗ "${kw}" — fetch returned null (network/parse).`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const payload: CachedTrend = {
      trendScore: result.trendScore,
      trendDirection: result.trendDirection,
      trendDirectionLabel: result.trendDirectionLabel,
      fetchedAt: new Date().toISOString(),
    };

    const wrote = await upstash.kvSetJson(trendCacheKey(kw), payload, CACHE_TTL_SECONDS);
    if (wrote) {
      // Clear from the queue only once the result is safely stored.
      await upstash.kvSRem(TREND_REQUESTED_SET, kw);
    }

    if (result.trendDirection === 'UNKNOWN') unknown += 1;
    else real += 1;

    console.log(`[TrendsFetch] ✓ "${kw}" → ${result.trendDirectionLabel}`);
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[TrendsFetch] DONE — total ${keywords.length} | real ${real} | unknown ${unknown} | failed ${failed}.`,
  );
  if (keywords.length > 0 && real === 0) {
    console.warn('[TrendsFetch] ⚠ No REAL trend data this run — GitHub runner IP may be blocked by Google Trends.');
  }
}

main().catch((err) => {
  console.error('[TrendsFetch] Fatal:', err);
  process.exit(1);
});
