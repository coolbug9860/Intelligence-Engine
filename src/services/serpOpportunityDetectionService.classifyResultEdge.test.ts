/**
 * serpOpportunityDetectionService.classifyResultEdge.test.ts (Task 4.3)
 *
 * Edge-case unit coverage for classifyResult: PDF detection (R3.6) and a
 * paywalled result that still carries an indicator (R4.4). Also confirms the
 * blog/news exclusion overrides a present report indicator (R4.2).
 *
 * Requirements: 3.6, 4.4, 4.2
 */

import { describe, it, expect } from 'vitest';
import { classifyResult, SCORING_RUBRIC, type SerpOrganicResult } from './serpOpportunityDetectionService';

describe('classifyResult edge cases', () => {
  it('detects a PDF report link (R3.6)', () => {
    const result: SerpOrganicResult = {
      title: 'Widget Forecast Deck',
      link: 'https://grandviewresearch.com/docs/widget.pdf',
      domain: 'grandviewresearch.com',
    };
    const c = classifyResult(result, 'widget', SCORING_RUBRIC);
    expect(c.isCompetitorReport).toBe(true);
    expect(c.matchedSignals).toContain('PDF');
  });

  it('counts a paywalled result that carries a title pattern (R4.4)', () => {
    const result: SerpOrganicResult = {
      title: 'Widget Market Share Analysis',
      link: 'https://grandviewresearch.com/x',
      domain: 'grandviewresearch.com',
      isPaywalled: true,
    };
    const c = classifyResult(result, 'widget', SCORING_RUBRIC);
    expect(c.isCompetitorReport).toBe(true);
    expect(c.matchedSignals).toContain('TITLE_PATTERN');
  });

  it('excludes a blog URL even when it carries a report indicator (R4.2)', () => {
    const result: SerpOrganicResult = {
      title: 'Widget Market Size — our take',
      link: 'https://grandviewresearch.com/blog/widget-market-size',
      domain: 'grandviewresearch.com',
    };
    const c = classifyResult(result, 'widget', SCORING_RUBRIC);
    expect(c.isCompetitorReport).toBe(false);
    expect(c.excludedReason).toBe('blog');
  });
});
