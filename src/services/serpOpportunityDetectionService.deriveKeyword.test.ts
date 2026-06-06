/**
 * serpOpportunityDetectionService.deriveKeyword.test.ts (Task 2.6*)
 *
 * Feature: serp-opportunity-detection, Property 5: Search keyword derivation
 * source-of-truth — the derived Search_Keyword originates from `marketKeyword`
 * when its normalization is non-empty, and otherwise from `reportTitle`.
 *
 * Validates: Requirements 1.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveSearchKeyword, normalizeKeyword } from './serpOpportunityDetectionService';

// Mix of plain strings and blank/qualifier-only values that normalize to ''.
const maybeBlank = fc.oneof(
  fc.string(),
  fc.constantFrom('', '   ', 'global', 'global market', 'market', 'industry'),
  fc.constantFrom('electric vehicle battery', 'solar panel', 'hydrogen fuel'),
);

describe('Property 5: deriveSearchKeyword source-of-truth', () => {
  it('prefers normalized marketKeyword, else falls back to reportTitle', () => {
    fc.assert(
      fc.property(maybeBlank, maybeBlank, (marketKeyword, reportTitle) => {
        const derived = deriveSearchKeyword({ marketKeyword, reportTitle });
        const fromKeyword = normalizeKeyword(marketKeyword);

        if (fromKeyword) {
          expect(derived).toBe(fromKeyword);
        } else {
          expect(derived).toBe(normalizeKeyword(reportTitle));
        }
      }),
      { numRuns: 100 },
    );
  });
});
