/**
 * serpOpportunityDetectionService.classifyResult.test.ts (Task 4.2*)
 *
 * Feature: serp-opportunity-detection, Property 8: Competitor_Report
 * classification is exactly the indicator biconditional — a result is a
 * Competitor_Report iff it has >=1 report indicator AND its domain is not
 * Kaiso-owned AND it is not a blog/news/article URL (blog overrides indicators;
 * paywall does not exclude).
 *
 * Validates: Requirements 3.4, 3.5, 3.7, 4.1, 4.2, 4.4, 4.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyResult, SCORING_RUBRIC, type SerpOrganicResult } from './serpOpportunityDetectionService';

const DOMAINS = ['reports.kaiso.com', 'researchandmarkets.com', 'grandviewresearch.com', 'example.com'];
const PATHS = ['blog', 'report', 'pdf', 'plain'] as const;

describe('Property 8: classifyResult is the indicator biconditional', () => {
  it('marks a competitor report iff indicator AND not own-domain AND not blog', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DOMAINS),
        fc.constantFrom(...PATHS),
        fc.boolean(), // title carries a Market Size/Share/Forecast pattern
        fc.boolean(), // schema.org Report/Product markup
        fc.boolean(), // paywalled
        (domain, pathType, titlePattern, schema, paywalled) => {
          const pathSeg =
            pathType === 'blog' ? '/blog/post-1'
            : pathType === 'report' ? '/industry-report/widgets'
            : pathType === 'pdf' ? '/docs/whitepaper.pdf'
            : '/overview';
          const title = titlePattern ? 'Widget Market Size Report 2030' : 'Widget overview page';
          const result: SerpOrganicResult = {
            title,
            link: `https://${domain}${pathSeg}`,
            domain,
            hasReportSchema: schema,
            isPaywalled: paywalled,
          };

          const isOwn = domain.includes('kaiso');
          const isBlog = pathType === 'blog';
          const isMarketplace = domain === 'researchandmarkets.com';
          const hasIndicator =
            titlePattern || schema || isMarketplace || pathType === 'report' || pathType === 'pdf';
          const expected = hasIndicator && !isOwn && !isBlog;

          expect(classifyResult(result, 'widget', SCORING_RUBRIC).isCompetitorReport).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
