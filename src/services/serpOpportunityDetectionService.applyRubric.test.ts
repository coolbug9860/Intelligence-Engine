/**
 * serpOpportunityDetectionService.applyRubric.test.ts (Tasks 5.2*, 5.3*)
 *
 * Feature: serp-opportunity-detection, Property 1: Threshold partition
 * determines class and score band — 0→GREEN, 1–2→YELLOW, 3–6→RED "crowded",
 * ≥7→RED "commoditised"; GREEN ≥75, YELLOW 40–74, RED <40.
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3
 *
 * Feature: serp-opportunity-detection, Property 2: Scoring is deterministic —
 * classifying the same SerpResponse twice yields an identical Classification.
 * Validates: Requirements 6.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyRubric,
  extractSignals,
  countCompetitors,
  SCORING_RUBRIC,
  type SerpResponse,
  type SerpOrganicResult,
} from './serpOpportunityDetectionService';

describe('Property 1: threshold partition determines class and score band', () => {
  it('assigns the partitioned class and an in-band score for any count', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (count) => {
        const { greenMax, yellowMax, crowdedMax } = SCORING_RUBRIC.thresholds;
        const { opportunityClass, score, reason } = applyRubric(count, [], SCORING_RUBRIC);

        if (count <= greenMax) {
          expect(opportunityClass).toBe('GREEN');
          expect(reason).toBe('gap');
          expect(score).toBeGreaterThanOrEqual(75);
        } else if (count <= yellowMax) {
          expect(opportunityClass).toBe('YELLOW');
          expect(reason).toBe('partial');
          expect(score).toBeGreaterThanOrEqual(40);
          expect(score).toBeLessThanOrEqual(74);
        } else {
          expect(opportunityClass).toBe('RED');
          expect(reason).toBe(count <= crowdedMax ? 'crowded' : 'commoditised');
          expect(score).toBeLessThan(40);
          expect(score).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: scoring is deterministic', () => {
  it('produces an identical classification when run twice on the same response', () => {
    const competitor = (n: number): SerpOrganicResult => ({
      title: 'Widget Market Size Report',
      link: `https://pub${n}.com/industry-report/widgets`,
      domain: `pub${n}.com`,
    });
    const classify = (resp: SerpResponse) => {
      const extraction = extractSignals(resp, 'widget', SCORING_RUBRIC);
      const { count } = countCompetitors(extraction, SCORING_RUBRIC);
      return applyRubric(count, extraction.signalTypesPresent, SCORING_RUBRIC);
    };

    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 12 }), (ids) => {
        const resp: SerpResponse = { keyword: 'widget', organic: ids.map(competitor), ads: [], aiOverviewSources: [] };
        expect(classify(resp)).toEqual(classify(resp));
      }),
      { numRuns: 100 },
    );
  });
});
