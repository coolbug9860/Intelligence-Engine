/**
 * serpOpportunityDetectionService.extractDomain.test.ts (Task 2.8*)
 *
 * Feature: serp-opportunity-detection, Property 6: Publisher domain extraction —
 * for any organic result whose `link` is a valid URL, the extracted domain
 * equals the host component (scheme, port, path, and query removed).
 *
 * Validates: Requirements 1.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractDomain } from './serpOpportunityDetectionService';

describe('Property 6: extractDomain returns the URL host', () => {
  it('strips scheme, port, path, and query from a valid URL', () => {
    fc.assert(
      fc.property(
        fc.domain(),
        fc.constantFrom('http', 'https'),
        fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
        fc.constantFrom('', '/path', '/a/b/c', '/market-report/widgets'),
        fc.constantFrom('', '?q=1', '?a=1&b=2'),
        (domain, scheme, port, path, query) => {
          const authority = port === undefined ? domain : `${domain}:${port}`;
          const link = `${scheme}://${authority}${path}${query}`;
          expect(extractDomain(link)).toBe(domain.toLowerCase());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns empty string for an unparseable link', () => {
    expect(extractDomain('not a url')).toBe('');
    expect(extractDomain('')).toBe('');
  });
});
