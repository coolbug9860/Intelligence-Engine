/**
 * serpOpportunityDetectionService.normalize.test.ts (Task 2.2*)
 *
 * Feature: serp-opportunity-detection, Property 3: Keyword normalization is
 * canonical and idempotent — output is lowercased, trimmed, has internal
 * whitespace runs collapsed, leading "global" and trailing "market"/"industry"
 * qualifiers removed; applying it twice yields the same result.
 *
 * Validates: Requirements 5.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizeKeyword } from './serpOpportunityDetectionService';

// Arbitrary that frequently embeds the qualifiers so the strip branches are hit.
const qualifierRich = fc
  .tuple(
    fc.constantFrom('', 'global ', 'Global ', 'global global '),
    fc.constantFrom('electric vehicle', 'Solar  Panel', '  Hydrogen ', 'sensor'),
    fc.constantFrom('', ' market', ' industry', ' market industry', ' Market'),
  )
  .map(([lead, core, trail]) => lead + core + trail);

describe('Property 3: normalizeKeyword is canonical and idempotent', () => {
  it('produces canonical output and is idempotent', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), qualifierRich), (raw) => {
        const out = normalizeKeyword(raw);

        // Canonical form.
        expect(out).toBe(out.toLowerCase());
        expect(out).toBe(out.trim());
        expect(out).not.toMatch(/\s{2,}/);
        expect(out.startsWith('global ')).toBe(false);
        expect(/\s(market|industry)$/.test(out)).toBe(false);

        // Idempotent.
        expect(normalizeKeyword(out)).toBe(out);
      }),
      { numRuns: 100 },
    );
  });
});
