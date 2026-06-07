/**
 * serpOpportunityDetectionService.extractSignals.test.ts (Task 4.5*)
 *
 * Feature: serp-opportunity-detection, Property 9: Coverage is detected across
 * organic, paid, and AI-Overview sources — a domain that qualifies as a
 * Competitor_Report contributes to detected coverage regardless of which block
 * it appears in.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
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

const COMPETITOR: SerpOrganicResult = {
  title: 'Widget Market Size Report 2030',
  link: 'https://grandviewresearch.com/industry-report/widgets',
  domain: 'grandviewresearch.com',
};

const emptyResponse = (): SerpResponse => ({ keyword: 'widget', organic: [], ads: [], aiOverviewSources: [] });

describe('Property 9: coverage detected across organic, paid, and AI-Overview', () => {
  it('counts a competitor domain regardless of the block it appears in', () => {
    fc.assert(
      fc.property(fc.constantFrom('organic', 'ads', 'ai'), (placement) => {
        const response = emptyResponse();
        const expectedSource =
          placement === 'organic' ? 'ORGANIC' : placement === 'ads' ? 'PAID_AD' : 'AI_OVERVIEW';

        if (placement === 'organic') response.organic = [COMPETITOR];
        else if (placement === 'ads') response.ads = [COMPETITOR];
        else response.aiOverviewSources = ['grandviewresearch.com'];

        const extraction = extractSignals(response, 'widget', SCORING_RUBRIC);
        const { count, domains } = countCompetitors(extraction, SCORING_RUBRIC);

        expect(domains).toContain('grandviewresearch.com');
        expect(count).toBeGreaterThanOrEqual(1);
        expect(extraction.signalTypesPresent).toContain(expectedSource);
      }),
      { numRuns: 100 },
    );
  });
});
