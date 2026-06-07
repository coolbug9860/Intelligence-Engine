/**
 * serpOpportunityDetectionService.countCompetitors.test.ts (Task 4.7*)
 *
 * Feature: serp-opportunity-detection, Property 10: Competitor_Count is the
 * distinct-domain count — a domain appearing in multiple results is counted
 * once, and the returned domain list has no duplicates.
 *
 * Validates: Requirements 2.5, 4.3, 10.8
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  extractSignals,
  countCompetitors,
  SCORING_RUBRIC,
  type SerpResponse,
  type SerpOrganicResult,
} from './serpOpportunityDetectionService';

const COMPETITOR_DOMAINS = ['a-research.com', 'b-insights.com', 'c-reports.com'];

const competitorResult = (domain: string): SerpOrganicResult => ({
  title: 'Widget Market Size Report',
  link: `https://${domain}/industry-report/widgets`,
  domain,
});

const noiseResult = (n: number): SerpOrganicResult => ({
  title: 'Just a blog opinion piece',
  link: `https://noise${n}.com/overview`,
  domain: `noise${n}.com`,
});

describe('Property 10: Competitor_Count is the distinct-domain count', () => {
  it('counts each distinct competitor domain once and excludes non-reports', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...COMPETITOR_DOMAINS), { minLength: 1, maxLength: 8 }),
        fc.array(fc.integer({ min: 1, max: 5 }), { maxLength: 4 }),
        (competitorPicks, noiseIds) => {
          const response: SerpResponse = {
            keyword: 'widget',
            organic: [
              ...competitorPicks.map(competitorResult),
              ...noiseIds.map(noiseResult),
            ],
            ads: [],
            aiOverviewSources: [],
          };

          const extraction = extractSignals(response, 'widget', SCORING_RUBRIC);
          const { count, domains } = countCompetitors(extraction, SCORING_RUBRIC);

          const expectedDistinct = new Set(competitorPicks);
          expect(count).toBe(expectedDistinct.size);
          expect(new Set(domains).size).toBe(domains.length); // no duplicates
          expect([...domains].sort()).toEqual([...expectedDistinct].sort());
        },
      ),
      { numRuns: 100 },
    );
  });
});
