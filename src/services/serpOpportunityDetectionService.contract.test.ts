/**
 * serpOpportunityDetectionService.contract.test.ts (Task 1.3*)
 *
 * Smoke/type test for the preserved output contract (R10.9): the legacy
 * white-space fields must still exist on ReportSuggestion with their original
 * types. Assigning concrete typed values to a ReportSuggestion is the
 * compile-time guard (verified by `tsc --noEmit`); the runtime expects below
 * confirm the literal types round-trip.
 */

import { describe, it, expect } from 'vitest';
import type { ReportSuggestion } from '../types';

describe('ReportSuggestion legacy white-space contract', () => {
  it('preserves the five legacy white-space fields with their original types', () => {
    const suggestion: ReportSuggestion = {
      id: 'contract-1',
      vertical: 'Healthcare',
      reportTitle: 'Global Widget Market',
      marketKeyword: 'widget market',
      thematicCluster: 'Industrial',

      // Legacy contract fields — types must match types.ts exactly.
      whiteSpaceStatus: 'CONFIRMED_GAP',
      whiteSpaceScore: 87,
      whiteSpaceLabel: '🟢 Confirmed Gap',
      whiteSpaceCompetitors: ['marketsandmarkets.com'],
      whiteSpaceGapReason: 'No competing syndicated report found.',
    };

    expect(suggestion.whiteSpaceStatus).toBe('CONFIRMED_GAP');
    expect(typeof suggestion.whiteSpaceScore).toBe('number');
    expect(typeof suggestion.whiteSpaceLabel).toBe('string');
    expect(Array.isArray(suggestion.whiteSpaceCompetitors)).toBe(true);
    expect(typeof suggestion.whiteSpaceGapReason).toBe('string');
  });

  it('accepts every documented whiteSpaceStatus literal', () => {
    const statuses: NonNullable<ReportSuggestion['whiteSpaceStatus']>[] = [
      'CONFIRMED_GAP',
      'PARTIAL_COVERAGE',
      'COMMODITISED',
      'UNKNOWN',
    ];
    expect(statuses).toHaveLength(4);
  });
});
