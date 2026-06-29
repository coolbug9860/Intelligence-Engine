/**
 * searchDemandGrounding.test.ts
 *
 * Feature: ground the seoSearchability sub-score with real Google Trends so the
 * RANKING (opportunityScore) reflects measured demand, not an LLM guess.
 */

import { describe, it, expect } from 'vitest';
import {
  trendScoreToSeoScore,
  hasRealTrend,
  groundSearchDemand,
} from './searchDemandGrounding';
import type { ReportSuggestion } from '../types';

/** Minimal suggestion carrying the fields the scoring chain reads. */
function makeSuggestion(over: Partial<ReportSuggestion> = {}): ReportSuggestion {
  return {
    id: 'sig-test-0',
    reportTitle: 'Global Industrial Robotics Market',
    marketKeyword: 'industrial robotics market',
    vertical: 'IT & Telecom',
    thematicCluster: 'Automation',
    confidenceScore: 7,
    credibilityScore: 80,
    executionRisk: 'Medium',
    regulatoryHurdle: 'Standard',
    buyerWillingnessScore: 6,
    quantifiabilityScore: 6,
    seoSearchabilityScore: 5,
    segmentabilityScore: 6,
    cagrViabilityScore: 6,
    competitiveDensityScore: 5,
    commercialViabilityScore: 6,
    sourceArticleTimestamp: Date.now(), // fresh → no decay
    ...over,
  } as unknown as ReportSuggestion;
}

describe('trendScoreToSeoScore', () => {
  it('maps the 0–100 trend level onto the 1–10 sub-score scale', () => {
    expect(trendScoreToSeoScore(0)).toBe(1);   // clamped up from 0
    expect(trendScoreToSeoScore(50)).toBe(5);
    expect(trendScoreToSeoScore(95)).toBe(10);  // rounds to 9.5 → 10
    expect(trendScoreToSeoScore(100)).toBe(10);
  });

  it('returns a neutral 5 for non-finite input', () => {
    expect(trendScoreToSeoScore(Number.NaN)).toBe(5);
    expect(trendScoreToSeoScore(Infinity)).toBe(5);
  });
});

describe('hasRealTrend', () => {
  it('is true only with a finite score AND a known direction', () => {
    expect(hasRealTrend(makeSuggestion({ trendScore: 60, trendDirection: 'RISING' as any }))).toBe(true);
    expect(hasRealTrend(makeSuggestion({ trendScore: 0, trendDirection: 'STABLE' as any }))).toBe(true);
  });

  it('is false for UNKNOWN, missing, or non-finite trend', () => {
    expect(hasRealTrend(makeSuggestion({ trendScore: 60, trendDirection: 'UNKNOWN' as any }))).toBe(false);
    expect(hasRealTrend(makeSuggestion({ trendDirection: 'RISING' as any }))).toBe(false); // no score
    expect(hasRealTrend(makeSuggestion({ trendScore: 50 }))).toBe(false); // no direction
  });
});

describe('groundSearchDemand', () => {
  it('returns an empty portfolio unchanged', () => {
    expect(groundSearchDemand([])).toEqual([]);
  });

  it('leaves signals without a usable trend reading untouched (same reference)', () => {
    const s = makeSuggestion({ trendDirection: 'UNKNOWN' as any, trendScore: 70 });
    const [out] = groundSearchDemand([s]);
    expect(out).toBe(s); // identical reference — no rescore
  });

  it('does not rescore when the grounded value equals the existing sub-score', () => {
    // trendScore 50 → grounded 5, which already equals seoSearchabilityScore 5.
    const s = makeSuggestion({ seoSearchabilityScore: 5, trendScore: 50, trendDirection: 'STABLE' as any });
    const [out] = groundSearchDemand([s]);
    expect(out).toBe(s);
  });

  it('raises opportunityScore when real demand exceeds the LLM estimate', () => {
    const low = makeSuggestion({ seoSearchabilityScore: 2, trendScore: 10, trendDirection: 'RISING' as any });
    const high = makeSuggestion({ seoSearchabilityScore: 2, trendScore: 90, trendDirection: 'RISING' as any });

    const [groundedLow] = groundSearchDemand([low]);
    const [groundedHigh] = groundSearchDemand([high]);

    expect(groundedHigh.opportunityScore!).toBeGreaterThan(groundedLow.opportunityScore!);
  });

  it('grounds the sub-score itself to the trend-derived value', () => {
    const s = makeSuggestion({ seoSearchabilityScore: 2, trendScore: 80, trendDirection: 'RISING' as any });
    const [out] = groundSearchDemand([s]);
    expect(out.seoSearchabilityScore).toBe(8); // 80 → 8
    expect(typeof out.opportunityScore).toBe('number');
  });

  it('passes vertical calibration through to the recompute', () => {
    const s = makeSuggestion({ seoSearchabilityScore: 2, trendScore: 90, trendDirection: 'RISING' as any });
    const neutral = groundSearchDemand([s], {})[0].opportunityScore!;
    const boosted = groundSearchDemand([s], { 'IT & Telecom': 1.1 })[0].opportunityScore!;
    expect(boosted).toBeGreaterThan(neutral);
  });
});
