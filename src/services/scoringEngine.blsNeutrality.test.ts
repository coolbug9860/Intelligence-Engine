/**
 * scoringEngine.blsNeutrality.test.ts (Task 6.2)
 *
 * Feature: zero-cost-ingestion-layer — BLS read-seam neutrality.
 * Validates: Requirements 4.5, 4.6, 4.7
 *
 * Locks the guarantee that the optional, unread `blsReference` argument to
 * `calculateOpportunityScore` NEVER changes the output — whether omitted, undefined,
 * pointing at an absent vertical, OR pointing at a populated matching vertical. If
 * anyone ever wires BLS into the scoring math without updating this test, it breaks.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
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

function blsRow(vertical: string): BlsSectorReference {
  return { vertical, ppiIndex: 130, ppiYoyPct: 18.5, wageIndex: 0, wageYoyPct: 0, refreshedAt: '2026-06-19T00:00:00.000Z' };
}

const calibration: VerticalCalibration = {};

describe('calculateOpportunityScore — BLS neutrality (Req 4.5, 4.6, 4.7)', () => {
  it('should return identical results whether blsReference is omitted or undefined', () => {
    const s = makeSuggestion();
    expect(calculateOpportunityScore(s, calibration, undefined)).toEqual(
      calculateOpportunityScore(s, calibration)
    );
  });

  it('should return identical results when the table lacks the suggestion vertical', () => {
    const s = makeSuggestion({ vertical: 'Semiconductor' } as Partial<ReportSuggestion>);
    const table: BlsReferenceTable = { 'Pharmaceutical Manufacturing': blsRow('Pharmaceutical Manufacturing') };
    expect(calculateOpportunityScore(s, calibration, table)).toEqual(
      calculateOpportunityScore(s, calibration)
    );
  });

  it('should return identical results even when the table CONTAINS a matching vertical', () => {
    const s = makeSuggestion({ vertical: 'Technology/Semiconductors' } as unknown as Partial<ReportSuggestion>);
    const table: BlsReferenceTable = { 'Technology/Semiconductors': blsRow('Technology/Semiconductors') };
    expect(calculateOpportunityScore(s, calibration, table)).toEqual(
      calculateOpportunityScore(s, calibration)
    );
  });

  it('property: output is invariant to the BLS table for arbitrary commercial sub-scores', () => {
    const scoreArb = fc.integer({ min: 1, max: 10 });
    fc.assert(
      fc.property(
        fc.record({
          buyerWillingnessScore: scoreArb,
          quantifiabilityScore: scoreArb,
          seoSearchabilityScore: scoreArb,
          segmentabilityScore: scoreArb,
          cagrViabilityScore: scoreArb,
          competitiveDensityScore: scoreArb,
          confidenceScore: scoreArb,
          credibilityScore: fc.integer({ min: 0, max: 100 }),
        }),
        (fields) => {
          const s = makeSuggestion(fields as Partial<ReportSuggestion>);
          const table: BlsReferenceTable = { Semiconductor: blsRow('Semiconductor') };

          const baseline = calculateOpportunityScore(s, calibration);
          const withUndefined = calculateOpportunityScore(s, calibration, undefined);
          const withTable = calculateOpportunityScore(s, calibration, table);

          expect(withUndefined).toEqual(baseline);
          expect(withTable).toEqual(baseline);
        }
      )
    );
  });
});
