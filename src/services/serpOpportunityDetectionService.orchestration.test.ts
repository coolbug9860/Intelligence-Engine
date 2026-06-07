/**
 * serpOpportunityDetectionService.orchestration.test.ts (Tasks 8.3*, 8.4*, 8.5*, 8.6*, 8.11)
 *
 * Property 7: Empty keyword yields UNKNOWN without a provider call (R1.5).
 * Property 15: Output length is preserved and the service never throws (R7.3, 7.4).
 * Property 16: Provider failure isolates to UNKNOWN and processing continues (R7.1).
 * Property 17: Absent credential skips all lookups (R7.2).
 * Plus unit tests: inter-call delay applied and billable count logged once (R9.3, 9.5).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { enrichWithWhiteSpaceDetection } from './serpOpportunityDetectionService';
import {
  MockSerpProvider,
  InMemoryCache,
  testDeps,
  makeSuggestion,
  responseWithCompetitors,
} from './serpDetectionTestKit';

afterEach(() => vi.restoreAllMocks());

const EMPTY_DERIVING = ['', '   ', '\t', '  \n  '];

describe('Property 7: empty keyword yields UNKNOWN without a provider call', () => {
  it('short-circuits empty-deriving suggestions to UNKNOWN and never calls the provider', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...EMPTY_DERIVING), { minLength: 1, maxLength: 6 }), async (kws) => {
        const provider = new MockSerpProvider(true);
        const suggestions = kws.map((kw, i) => makeSuggestion(`s${i}`, kw, kw));
        const out = await enrichWithWhiteSpaceDetection(suggestions, testDeps({ provider }));
        expect(out).toHaveLength(suggestions.length);
        expect(out.every((s) => s.whiteSpaceStatus === 'UNKNOWN')).toBe(true);
        expect(provider.calls).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property 15: output length preserved; never throws', () => {
  it('resolves with same-length output even when every provider call fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 8 }), async (kws) => {
        const provider = new MockSerpProvider(true, () => new Error('boom'));
        const suggestions = kws.map((kw, i) => makeSuggestion(`s${i}`, `${kw} alpha`));
        const out = await enrichWithWhiteSpaceDetection(suggestions, testDeps({ provider }));
        expect(out).toHaveLength(suggestions.length);
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property 16: provider failure isolates to UNKNOWN and continues', () => {
  it('fails only the erroring keyword while classifying the rest', async () => {
    const provider = new MockSerpProvider(true, (kw) =>
      kw.includes('fail') ? new Error('provider down') : responseWithCompetitors(kw, ['a-research.com']),
    );
    const suggestions = [
      makeSuggestion('ok1', 'electric vehicle battery'),
      makeSuggestion('bad', 'fail keyword'),
      makeSuggestion('ok2', 'solar panel tech'),
    ];
    const out = await enrichWithWhiteSpaceDetection(suggestions, testDeps({ provider }));
    expect(out[0].whiteSpaceStatus).not.toBe('UNKNOWN');
    expect(out[1].whiteSpaceStatus).toBe('UNKNOWN');
    expect(out[2].whiteSpaceStatus).not.toBe('UNKNOWN');
  });
});

describe('Property 17: absent credential skips all lookups', () => {
  it('returns all UNKNOWN and never calls the provider when not configured', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 6 }), async (kws) => {
        const provider = new MockSerpProvider(false);
        const suggestions = kws.map((kw, i) => makeSuggestion(`s${i}`, `${kw} market segment`));
        const out = await enrichWithWhiteSpaceDetection(suggestions, testDeps({ provider }));
        expect(out.every((s) => s.whiteSpaceStatus === 'UNKNOWN')).toBe(true);
        expect(provider.calls).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });
});

describe('Unit (8.11): inter-call delay and billable-count logging', () => {
  it('applies the inter-call delay between billable calls and logs the count once', async () => {
    const provider = new MockSerpProvider(true, (kw) => responseWithCompetitors(kw, ['a-research.com']));
    const sleepArgs: number[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const suggestions = [
      makeSuggestion('s1', 'electric vehicle battery'),
      makeSuggestion('s2', 'solar panel technology'),
    ];

    await enrichWithWhiteSpaceDetection(
      suggestions,
      testDeps({
        provider,
        cache: new InMemoryCache(),
        runControl: { runBudget: 100, interCallDelayMs: 1200, refreshWindowMs: 7 * 24 * 60 * 60 * 1000 },
        sleep: async (ms) => { sleepArgs.push(ms); },
      }),
    );

    // Two distinct keywords → one delay between the two billable calls.
    expect(sleepArgs).toEqual([1200]);
    const billableLogs = info.mock.calls.filter((c) => String(c[0]).includes('billable SERP call'));
    expect(billableLogs).toHaveLength(1);
    expect(String(billableLogs[0][0])).toContain('2 billable');
  });
});
