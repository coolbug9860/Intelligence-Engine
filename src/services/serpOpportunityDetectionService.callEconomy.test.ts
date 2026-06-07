/**
 * serpOpportunityDetectionService.callEconomy.test.ts (Tasks 8.7*, 8.8*, 8.9*, 8.10*)
 *
 * Property 18: Each distinct keyword is queried at most once per run (R5.4, 5.5).
 * Property 19: Fresh cache hits avoid billable calls (R8.1, 8.2, 8.4, 9.4).
 * Property 20: Successful classifications are cached with a timestamp (R8.3).
 * Property 21: Billable calls never exceed the Run_Budget (R9.2).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  enrichWithWhiteSpaceDetection,
  normalizeKeyword,
  type CachedClassification,
} from './serpOpportunityDetectionService';
import {
  MockSerpProvider,
  InMemoryCache,
  testDeps,
  makeSuggestion,
  responseWithCompetitors,
} from './serpDetectionTestKit';

const NOW = 1_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const KW_POOL = ['electric vehicle battery', 'solar panel tech', 'hydrogen fuel cell', 'smart grid sensor'];

describe('Property 18: each distinct keyword is queried at most once per run', () => {
  it('queries the provider once per distinct normalized keyword', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...KW_POOL), { minLength: 1, maxLength: 10 }), async (kws) => {
        const provider = new MockSerpProvider(true, (kw) => responseWithCompetitors(kw, ['a-research.com']));
        const suggestions = kws.map((kw, i) => makeSuggestion(`s${i}`, kw));
        await enrichWithWhiteSpaceDetection(suggestions, testDeps({ provider }));

        const distinct = new Set(kws.map(normalizeKeyword));
        expect(provider.calls.length).toBe(distinct.size);
        expect(new Set(provider.calls).size).toBe(provider.calls.length); // no duplicate calls
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property 21: billable calls never exceed the Run_Budget', () => {
  it('caps provider calls at the budget and marks the remainder UNKNOWN', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 6 }),
        async (distinctCount, budget) => {
          const provider = new MockSerpProvider(true, (kw) => responseWithCompetitors(kw, ['a-research.com']));
          const suggestions = Array.from({ length: distinctCount }, (_, i) =>
            makeSuggestion(`s${i}`, `widget ${i} segment`),
          );
          const out = await enrichWithWhiteSpaceDetection(
            suggestions,
            testDeps({ provider, runControl: { runBudget: budget, interCallDelayMs: 0, refreshWindowMs: 7 * DAY } }),
          );

          expect(provider.calls.length).toBeLessThanOrEqual(budget);
          expect(provider.calls.length).toBe(Math.min(distinctCount, budget));
          const unknown = out.filter((s) => s.whiteSpaceStatus === 'UNKNOWN').length;
          expect(unknown).toBe(Math.max(0, distinctCount - budget));
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('Property 19: fresh cache hits avoid billable calls', () => {
  it('serves a fresh entry without calling the provider', async () => {
    const cache = new InMemoryCache();
    const entry: CachedClassification = {
      keyword: 'electric vehicle battery',
      classification: { opportunityClass: 'GREEN', score: 85, reason: 'gap' },
      domains: [],
      signals: ['ORGANIC'],
      timestamp: NOW,
    };
    cache.set(entry.keyword, entry, NOW);
    const provider = new MockSerpProvider(true, (kw) => responseWithCompetitors(kw, ['a.com']));

    const out = await enrichWithWhiteSpaceDetection(
      [makeSuggestion('s', 'electric vehicle battery')],
      testDeps({ provider, cache, now: () => NOW }),
    );

    expect(provider.calls).toHaveLength(0);
    expect(out[0].whiteSpaceSerpCached).toBe(true);
    expect(out[0].whiteSpaceStatus).toBe('CONFIRMED_GAP');
  });

  it('re-fetches when the entry is older than the refresh window', async () => {
    const cache = new InMemoryCache();
    cache.set(
      'electric vehicle battery',
      {
        keyword: 'electric vehicle battery',
        classification: { opportunityClass: 'GREEN', score: 85, reason: 'gap' },
        domains: [],
        signals: ['ORGANIC'],
        timestamp: NOW - 8 * DAY,
      },
      NOW - 8 * DAY,
    );
    const provider = new MockSerpProvider(true, (kw) => responseWithCompetitors(kw, ['a.com']));

    await enrichWithWhiteSpaceDetection(
      [makeSuggestion('s', 'electric vehicle battery')],
      testDeps({ provider, cache, now: () => NOW, runControl: { runBudget: 100, interCallDelayMs: 0, refreshWindowMs: 7 * DAY } }),
    );

    expect(provider.calls).toEqual(['electric vehicle battery']);
  });
});

describe('Property 20: successful classifications are cached with a timestamp', () => {
  it('writes the classification and current timestamp on success', async () => {
    const cache = new InMemoryCache();
    const provider = new MockSerpProvider(true, (kw) => responseWithCompetitors(kw, ['a.com', 'b.com']));

    await enrichWithWhiteSpaceDetection(
      [makeSuggestion('s', 'electric vehicle battery')],
      testDeps({ provider, cache, now: () => NOW }),
    );

    const stored = cache.store.get('electric vehicle battery');
    expect(stored).toBeDefined();
    expect(stored?.timestamp).toBe(NOW);
    expect(stored?.classification.opportunityClass).toBe('YELLOW'); // 2 distinct competitor domains
  });
});
