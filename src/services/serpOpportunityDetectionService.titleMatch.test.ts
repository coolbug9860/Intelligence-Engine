/**
 * serpOpportunityDetectionService.titleMatch.test.ts (Task 2.4*)
 *
 * Feature: serp-opportunity-detection, Property 4: Title matching ignores token
 * order and singular/plural form — for any keyword and a title that matches it,
 * shuffling the title's token order and/or pluralizing/singularizing its tokens
 * does not change the match result.
 *
 * Validates: Requirements 5.2, 5.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { titleMatchesKeyword } from './serpOpportunityDetectionService';

// Pool: content words, none ending in 's', all length > 4 so the singularizer
// round-trips a simple "+s" pluralization cleanly.
const WORD_POOL = [
  'electric', 'vehicle', 'battery', 'solar', 'panel', 'hydrogen',
  'sensor', 'robot', 'polymer', 'biofuel', 'turbine', 'coating',
];

const shuffle = (arr: string[], seed: number): string[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (seed * 9301 + 49297 + i) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

describe('Property 4: titleMatchesKeyword ignores order and plural form', () => {
  it('is invariant under token shuffle and pluralization for matching titles', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...WORD_POOL), { minLength: 1, maxLength: 3 }),
        fc.array(fc.constantFrom(...WORD_POOL), { maxLength: 4 }),
        fc.integer({ min: 0, max: 1000 }),
        (keywordWords, extraWords, seed) => {
          const keyword = keywordWords.join(' ');
          const titleWords = shuffle([...keywordWords, ...extraWords], seed);
          const title = titleWords.join(' ');

          // Baseline: a title containing all keyword tokens matches.
          expect(titleMatchesKeyword(title, keyword)).toBe(true);

          // Order-insensitive: a different shuffle yields the same result.
          const reshuffled = shuffle(titleWords, seed + 1).join(' ');
          expect(titleMatchesKeyword(reshuffled, keyword)).toBe(
            titleMatchesKeyword(title, keyword),
          );

          // Plural-insensitive: pluralizing every title token still matches.
          const pluralTitle = titleWords.map((w) => w + 's').join(' ');
          expect(titleMatchesKeyword(pluralTitle, keyword)).toBe(true);

          // ...and pluralizing the keyword tokens still matches the base title.
          const pluralKeyword = keywordWords.map((w) => w + 's').join(' ');
          expect(titleMatchesKeyword(title, pluralKeyword)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
