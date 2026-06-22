/**
 * helpBudget.cacheIdempotence.property.test.ts (Task 5.4)
 *
 * Feature: in-app-help-search — property-based test for cache idempotence.
 * **Validates: Requirements 5.3**
 *
 * Property 7: Cache idempotence
 *   For all queries, resolving the same normalized query twice yields identical
 *   answers and the second resolution triggers no LLM call. Concretely, after a
 *   `resolve` for a query key, a subsequent `ask` for ANY query sharing that
 *   normalized `cacheKey` resolves from cache: `llmBudgetRemaining` and
 *   `llmCallsDispatched` are unchanged and the returned answer equals the first
 *   cached answer. Re-`resolve` of the same key is idempotent (first answer wins).
 *
 * Strategy: target the pure `budgetReducer` directly (no DOM, no React, no I/O).
 * Generate arbitrary query strings that normalize to a non-empty key, plus two
 * distinct HelpAnswers. Drive `resolve` then probe with `ask` and a second
 * `resolve`, asserting the cached answer and budget counters hold.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  budgetReducer,
  createInitialBudgetState,
  cacheKey,
} from './helpBudget';
import type { HelpAnswer } from './helpTypes';

/** Arbitrary, well-formed HelpAnswer. Fields are independent of the cache key. */
const helpAnswerArb: fc.Arbitrary<HelpAnswer> = fc.record({
  query: fc.string(),
  answer: fc.string(),
  sources: fc.array(
    fc.record({
      id: fc.string({ minLength: 1 }),
      title: fc.string({ minLength: 1 }),
      sourceDoc: fc.option(fc.string(), { nil: undefined }),
    }),
    { maxLength: 4 },
  ),
  mode: fc.constantFrom<'local' | 'llm'>('local', 'llm'),
  answeredAt: fc.integer({ min: 0 }),
});

/**
 * A query string whose normalized form is a non-empty key (so it is cacheable).
 * Plain non-empty strings can normalize to nothing (pure punctuation/stopwords),
 * so constrain to strings that survive normalization.
 */
const keyableQueryArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1 })
  .filter((q) => cacheKey(q).length > 0);

/**
 * A pair of distinct queries guaranteed to share the same normalized cacheKey.
 * Derived from one base query by toggling case and wrapping with boundary
 * punctuation/whitespace — both transforms are erased by `normalize`, so the
 * token list (and thus the key) is preserved while the raw strings differ.
 * (Constructing the pair avoids the precondition-rejection blow-up that a
 * filter on two independent random queries would cause.)
 */
const sameKeyPairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(
    keyableQueryArb,
    fc.boolean(),
    fc.constantFrom('', ' ', '  ', '?', '!!!', '...', ' - ', '  ?? '),
    fc.constantFrom('', ' ', '  ', '?', '!!!', '...', ' - ', '  ?? '),
  )
  .map(([base, upper, lead, trail]) => {
    const variant = `${lead}${upper ? base.toUpperCase() : base.toLowerCase()}${trail}`;
    return [base, variant] as [string, string];
  })
  // Keep only pairs that truly share the key (defensive: locale-casing edge
  // cases) and that are not the identical string (we want a different query).
  .filter(([a, b]) => cacheKey(a) === cacheKey(b));

describe('Property 7: Cache idempotence (Requirements 5.3)', () => {
  it('a subsequent ask with the same cacheKey resolves from cache without an LLM call', () => {
    fc.assert(
      fc.property(
        keyableQueryArb,
        helpAnswerArb,
        (query, answer) => {
          const initial = createInitialBudgetState();

          // First resolution records the answer in the cache.
          const resolved = budgetReducer(initial, {
            type: 'resolve',
            query,
            answer,
          });

          // A subsequent ask for the same key must hit the cache.
          const asked = budgetReducer(resolved, { type: 'ask', query });

          // No LLM call: budget and dispatch counter are unchanged.
          expect(asked.llmBudgetRemaining).toBe(resolved.llmBudgetRemaining);
          expect(asked.llmCallsDispatched).toBe(resolved.llmCallsDispatched);
          expect(asked.isAsking).toBe(false);
          // The surfaced answer is the cached one (reference-identical).
          expect(asked.answer).toBe(answer);
        },
      ),
    );
  });

  it('asking with any query sharing the normalized key resolves from the same cache entry', () => {
    fc.assert(
      fc.property(
        sameKeyPairArb,
        helpAnswerArb,
        ([queryA, queryB], answer) => {
          const initial = createInitialBudgetState();
          const resolved = budgetReducer(initial, {
            type: 'resolve',
            query: queryA,
            answer,
          });

          // Ask using the OTHER query that shares the normalized key.
          const asked = budgetReducer(resolved, { type: 'ask', query: queryB });

          expect(asked.llmBudgetRemaining).toBe(resolved.llmBudgetRemaining);
          expect(asked.llmCallsDispatched).toBe(resolved.llmCallsDispatched);
          expect(asked.answer).toBe(answer);
        },
      ),
    );
  });

  it('re-resolving the same key is idempotent: the first cached answer wins', () => {
    fc.assert(
      fc.property(
        keyableQueryArb,
        helpAnswerArb,
        helpAnswerArb,
        (query, first, second) => {
          const initial = createInitialBudgetState();

          const afterFirst = budgetReducer(initial, {
            type: 'resolve',
            query,
            answer: first,
          });
          const afterSecond = budgetReducer(afterFirst, {
            type: 'resolve',
            query,
            answer: second,
          });

          const key = cacheKey(query);
          // The cache entry and surfaced answer remain the first answer.
          expect(afterSecond.cache.get(key)).toBe(first);
          expect(afterSecond.answer).toBe(first);
          // Budget counters are untouched by resolution.
          expect(afterSecond.llmBudgetRemaining).toBe(initial.llmBudgetRemaining);
          expect(afterSecond.llmCallsDispatched).toBe(initial.llmCallsDispatched);
        },
      ),
    );
  });

  it('resolving the same query twice yields identical answers across resolutions', () => {
    fc.assert(
      fc.property(keyableQueryArb, helpAnswerArb, (query, answer) => {
        const initial = createInitialBudgetState();
        const r1 = budgetReducer(initial, { type: 'resolve', query, answer });
        const r2 = budgetReducer(r1, { type: 'resolve', query, answer });
        expect(r2.answer).toEqual(r1.answer);
      }),
    );
  });
});
