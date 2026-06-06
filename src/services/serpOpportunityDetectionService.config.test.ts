/**
 * serpOpportunityDetectionService.config.test.ts (Task 1.5*)
 *
 * Asserts thresholds/budget come from the single config source (R2.6, R9.1,
 * R11.3): the rubric exposes named threshold/band fields and RUN_CONTROL.runBudget
 * defaults to >= 1. This guards against numeric literals leaking back into the
 * classification path.
 */

import { describe, it, expect } from 'vitest';
import { SCORING_RUBRIC, RUN_CONTROL } from './serpOpportunityDetectionService';

describe('SCORING_RUBRIC configuration', () => {
  it('exposes the named Competitor_Count threshold partition', () => {
    expect(SCORING_RUBRIC.thresholds.greenMax).toBe(0);
    expect(SCORING_RUBRIC.thresholds.yellowMax).toBe(2);
    expect(SCORING_RUBRIC.thresholds.crowdedMax).toBe(6);
    // Partition is ordered and non-overlapping.
    expect(SCORING_RUBRIC.thresholds.greenMax).toBeLessThan(SCORING_RUBRIC.thresholds.yellowMax);
    expect(SCORING_RUBRIC.thresholds.yellowMax).toBeLessThan(SCORING_RUBRIC.thresholds.crowdedMax);
  });

  it('exposes White_Space_Score bands consistent with R6.1–6.3', () => {
    expect(SCORING_RUBRIC.scoreBands.greenBase).toBeGreaterThanOrEqual(75);
    expect(SCORING_RUBRIC.scoreBands.yellowBase).toBeGreaterThanOrEqual(40);
    expect(SCORING_RUBRIC.scoreBands.yellowBase).toBeLessThanOrEqual(74);
    expect(SCORING_RUBRIC.scoreBands.redBase).toBeLessThan(40);
  });

  it('declares indicator/exclusion sets used by the classifier', () => {
    expect(SCORING_RUBRIC.reportIndicators.titlePatterns.length).toBeGreaterThan(0);
    expect(SCORING_RUBRIC.reportIndicators.reportUrlPaths.length).toBeGreaterThan(0);
    expect(SCORING_RUBRIC.blogPatterns.length).toBeGreaterThan(0);
    expect(SCORING_RUBRIC.reportMarketplaces.length).toBeGreaterThan(0);
    expect(SCORING_RUBRIC.ownDomains.length).toBeGreaterThan(0);
  });
});

describe('RUN_CONTROL configuration', () => {
  it('clamps runBudget to >= 1 (R9.1)', () => {
    expect(RUN_CONTROL.runBudget).toBeGreaterThanOrEqual(1);
  });

  it('exposes non-negative delay and refresh window and a cache path', () => {
    expect(RUN_CONTROL.interCallDelayMs).toBeGreaterThanOrEqual(0);
    expect(RUN_CONTROL.refreshWindowMs).toBeGreaterThan(0);
    expect(typeof RUN_CONTROL.cachePath).toBe('string');
    expect(RUN_CONTROL.cachePath.length).toBeGreaterThan(0);
  });
});
