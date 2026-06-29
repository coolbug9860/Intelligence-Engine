/**
 * scoringEngine.blsActivation.test.ts
 *
 * Feature: activate the BLS macro reference as a bounded sector-dynamism nudge
 * (Option C) in calculateOpportunityScore.
 *
 * Guarantees:
 *   - No row for the vertical (or omitted/undefined table) → score is unchanged.
 *   - A matching row with sharp PPI YoY movement → score increases, BOUNDED to +5%.
 *   - The effect is symmetric on |ppiYoyPct| (a sharp drop nudges the same as a rise).
 *   - A flat sector (ppiYoyPct ≈ 0) → effectively neutral.
 */

import { describe, it, expect } from 'vitest';
import { calculateOpportunityScore } from './scoringEngine';
import type { BlsReferenceTable, BlsSectorReference } from './blsReferenceService';
import type { ReportSuggestion } from '../types';
import type { VerticalCalibration } from './outcomeLedger';

function makeSuggestion(overrides: Partial<ReportSuggestion> = {}): ReportSuggestion {
  return {
    reportTitle: 'Solid-State Battery Materials Outlook',
    vertical: 'Semiconductor',
    buyerWillingnessScore: 8,
    quantifiabilityScore: 7,
    seoSearchabilityScore: 6,
    segmentabilityScore: 7,
    cagrViabilityScore: 6,
    competitiveDensityScore: 5,
    commercialViabilityScore: 7,
    confidenceScore: 7,
    credibilityScore: 80,
    executionRisk: 'Medium',
    regulatoryHurdle: 'Standard',
    inferenceRatio: 0.2,
    ...overrides,
  } as unknown as ReportSuggestion;
}

function blsRow(vertical: string, ppiYoyPct: number): BlsSectorReference {
  return { vertical, ppiIndex: 130, ppiYoyPct, wageIndex: 0, wageYoyPct: 0, refreshedAt: '2026-06-19T00:00:00.000Z' };
}

const calibration: VerticalCalibration = {};
const score = (s: ReportSuggestion, t?: BlsReferenceTable) =>
  calculateOpportunityScore(s, calibration, t).opportunityScore as number;

describe('calculateOpportunityScore — BLS sector-dynamism nudge (Option C)', () => {
  it('leaves the score unchanged when the table is omitted or undefined', () => {
    const s = makeSuggestion();
    expect(score(s, undefined)).toBe(score(s));
  });

  it('leaves the score unchanged when no row matches the vertical', () => {
    const s = makeSuggestion({ vertical: 'Semiconductor' } as Partial<ReportSuggestion>);
    const table: BlsReferenceTable = { Healthcare: blsRow('Healthcare', 18) };
    expect(score(s, table)).toBe(score(s));
  });

  it('raises the score when a matching sector shows sharp PPI movement', () => {
    const s = makeSuggestion({ vertical: 'Semiconductor' } as Partial<ReportSuggestion>);
    const table: BlsReferenceTable = { Semiconductor: blsRow('Semiconductor', 18.5) };
    expect(score(s, table)).toBeGreaterThan(score(s));
  });

  it('caps the boost at +5% even for extreme PPI movement', () => {
    const s = makeSuggestion({ vertical: 'Semiconductor' } as Partial<ReportSuggestion>);
    const baseline = score(s);
    const extreme: BlsReferenceTable = { Semiconductor: blsRow('Semiconductor', 200) };
    const boosted = score(s, extreme);
    expect(boosted).toBeLessThanOrEqual(Math.round(baseline * 1.05));
    expect(boosted).toBeGreaterThan(baseline);
  });

  it('treats a sharp drop the same as a sharp rise (symmetric on |YoY|)', () => {
    const s = makeSuggestion({ vertical: 'Semiconductor' } as Partial<ReportSuggestion>);
    const up: BlsReferenceTable = { Semiconductor: blsRow('Semiconductor', 12) };
    const down: BlsReferenceTable = { Semiconductor: blsRow('Semiconductor', -12) };
    expect(score(s, up)).toBe(score(s, down));
  });

  it('is effectively neutral for a flat sector (ppiYoyPct ~ 0)', () => {
    const s = makeSuggestion({ vertical: 'Semiconductor' } as Partial<ReportSuggestion>);
    const flat: BlsReferenceTable = { Semiconductor: blsRow('Semiconductor', 0) };
    expect(score(s, flat)).toBe(score(s));
  });
});
