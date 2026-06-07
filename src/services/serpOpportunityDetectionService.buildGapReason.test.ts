/**
 * serpOpportunityDetectionService.buildGapReason.test.ts (Task 5.5*)
 *
 * Feature: serp-opportunity-detection, Property 12: Explanation names the count
 * and contributing signals — the generated reason is a one-sentence string
 * containing the numeric Competitor_Count and naming each contributing
 * SERP_Signal type.
 *
 * Validates: Requirements 6.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildGapReason } from './serpOpportunityDetectionService';
import type { SerpSignalType } from '../types';

const SIGNAL_TYPES: SerpSignalType[] = [
  'ORGANIC', 'PAID_AD', 'AI_OVERVIEW', 'SCHEMA_MARKUP', 'REPORT_MARKETPLACE', 'PDF', 'TITLE_PATTERN',
];

describe('Property 12: gap reason names the count and contributing signals', () => {
  it('contains the numeric count and every contributing signal type', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.uniqueArray(fc.constantFrom(...SIGNAL_TYPES), { maxLength: SIGNAL_TYPES.length }),
        (count, signals) => {
          const reason = buildGapReason(count, signals);

          expect(reason).toContain(String(count));
          for (const sig of signals) {
            expect(reason).toContain(sig);
          }
          // One sentence: ends with a period and contains no line breaks.
          expect(reason.trim().endsWith('.')).toBe(true);
          expect(reason).not.toContain('\n');
        },
      ),
      { numRuns: 100 },
    );
  });
});
