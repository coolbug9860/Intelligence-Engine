/**
 * searchDemandGrounding.ts
 *
 * Grounds the LLM's `seoSearchabilityScore` (a guess at "are buyers searching
 * this?") with REAL Google Trends data, then re-derives `opportunityScore` so the
 * RANKING — not just the verdict — reflects measured search demand.
 *
 * WHY A POST-ENRICHMENT STEP (not in the scoring pipeline):
 * `opportunityScore` is computed in-pipeline (orchestrator Stage 2), but the real
 * `trendScore` only arrives AFTER the pipeline (server.ts `enrichWithTrends`, which
 * reads the Upstash cache the GitHub Action fills). So we re-run the exact same
 * deterministic chain the orchestrator uses — score → freshness → title-coherence —
 * with only `seoSearchabilityScore` swapped for the grounded value. Every other
 * input (sub-scores, credibility, risk, calibration, article age) is unchanged, so
 * the math is identical except for the one grounded factor. `calculateOpportunityScore`
 * recomputes from the raw sub-scores (undecayed), so re-applying freshness here does
 * NOT double-decay.
 *
 * This module is PURE (no IO) — the trend value is already attached to the signal —
 * so it is safe to import anywhere and is fully unit-testable.
 *
 * GRACEFUL DEGRADATION: when Trends returned no usable reading (UNKNOWN / blocked /
 * cache-miss), the signal is left exactly as-is, keeping the LLM estimate.
 *
 * CAVEAT: Google's `trendScore` is a RELATIVE interest level (0–100 vs the term's own
 * history), not an absolute cross-term search volume. It is an imperfect — but real,
 * and better-than-a-guess — proxy for search demand.
 */

import { ReportSuggestion } from '../types';
import type { VerticalCalibration } from './outcomeLedger';
import { calculateOpportunityScore } from './scoringEngine';
import { applyFreshnessScoring } from './freshnessEngine';
import { applyTitleCoherence } from './titleCoherenceEngine';

/**
 * Map a Google Trends interest level (0–100) onto the 1–10 commercial sub-score
 * scale the scoring engine expects. Non-finite input → neutral 5.
 */
export function trendScoreToSeoScore(trendScore: number): number {
  if (!Number.isFinite(trendScore)) return 5;
  return Math.max(1, Math.min(10, Math.round(trendScore / 10)));
}

/**
 * True only when Google Trends returned a concrete level AND a known direction.
 * UNKNOWN/missing means Trends was blocked or the cache hasn't warmed — in which
 * case we must NOT ground (we'd be inventing a demand reading).
 */
export function hasRealTrend(s: ReportSuggestion): boolean {
  return (
    typeof s.trendScore === 'number' &&
    Number.isFinite(s.trendScore) &&
    s.trendDirection != null &&
    s.trendDirection !== 'UNKNOWN'
  );
}

/**
 * Replace the LLM `seoSearchabilityScore` with the trend-grounded value for every
 * signal that has a real trend reading, then re-derive `opportunityScore` via the
 * same deterministic chain the pipeline uses. Signals without a usable trend are
 * returned untouched. Never throws; returns a new array.
 */
export function groundSearchDemand(
  portfolio: ReportSuggestion[],
  calibration: VerticalCalibration = {},
): ReportSuggestion[] {
  if (!portfolio?.length) return portfolio;

  return portfolio.map((s) => {
    if (!hasRealTrend(s)) return s; // no real data → keep the LLM estimate

    const grounded = trendScoreToSeoScore(s.trendScore as number);
    if (grounded === s.seoSearchabilityScore) return s; // identical → nothing to redo

    let g: ReportSuggestion = { ...s, seoSearchabilityScore: grounded };
    g = calculateOpportunityScore(g, calibration); // undecayed recompute (grounded seo)
    g = applyFreshnessScoring(g);                   // single time-decay
    g = applyTitleCoherence(g);                     // re-apply event-subject cap
    return g;
  });
}
