/**
 * helpBudget.noLlmOnTyping.property.test.ts (Task 5.3)
 *
 * Feature: in-app-help-search — property-based test for no-LLM-on-typing.
 * **Validates: Requirements 4.2**
 *
 * Property 1: No-LLM-on-typing
 *   For all sequences of typing/query-changed actions (and `resolve` of local
 *   answers), the pure `budgetReducer` never dispatches an LLM call and never
 *   decrements the session budget. Budget is only ever consumed (and the call
 *   counter incremented) by an `ask` action that misses the cache while budget
 *   remains.
 *
 * Strategy: drive `budgetReducer` (no DOM/React) with arbitrary sequences of
 * non-`ask` actions (`query-changed` + local `resolve`) and assert the budget
 * and `llmCallsDispatched` are invariant from the initial state. A second
 * generator interleaves `ask` actions to assert the converse: any change to the
 * budget / call counter is attributable solely to a cache-missing `ask` issued
 * while budget remained.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  budgetReducer,
  createInitialBudgetState,
  cacheKey,
  type BudgetAction,
  type BudgetState,
} from './helpBudget';
import { LLM_SESSION_BUDGET, type HelpAnswer } from './helpTypes';

/** Build a minimal, well-formed local answer for a query. */
function localAnswer(query: string): HelpAnswer {
  return {
    query,
    answer: `local explanation for ${query}`,
    sources: [],
    mode: 'local',
    answeredAt: 0,
  };
}

/** Arbitrary query strings, biased to collide so cache hits actually occur. */
const queryArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('score', 'opportunity score', 'the ranking number', '', '   '),
  fc.string(),
);

/** Non-LLM actions: typing and local answer resolution only. */
const nonAskActionArb: fc.Arbitrary<BudgetAction> = fc.oneof(
  queryArb.map((query) => ({ type: 'query-changed', query }) as BudgetAction),
  queryArb.map(
    (query) =>
      ({ type: 'resolve', query, answer: localAnswer(query) }) as BudgetAction,
  ),
);

/** Full action mix including `ask` (and the failure path) for the converse. */
const anyActionArb: fc.Arbitrary<BudgetAction> = fc.oneof(
  nonAskActionArb,
  queryArb.map((query) => ({ type: 'ask', query }) as BudgetAction),
  fc.constant({ type: 'ask-failed' } as BudgetAction),
);

describe('Property 1: No-LLM-on-typing (Requirements 4.2)', () => {
  it('never decrements budget or increments call count across typing/resolve sequences', () => {
    fc.assert(
      fc.property(
        fc.array(nonAskActionArb, { maxLength: 50 }),
        (actions) => {
          const initial = createInitialBudgetState();
          const final = actions.reduce(budgetReducer, initial);
          // Typing and local resolution leave the budget and the LLM call
          // counter exactly at their initial values.
          expect(final.llmBudgetRemaining).toBe(initial.llmBudgetRemaining);
          expect(final.llmCallsDispatched).toBe(0);
          // And a fallback is never marked in-flight by a non-ask action.
          expect(final.isAsking).toBe(false);
        },
      ),
    );
  });

  it('only a cache-missing ask issued with budget remaining consumes budget', () => {
    fc.assert(
      fc.property(fc.array(anyActionArb, { maxLength: 60 }), (actions) => {
        let state: BudgetState = createInitialBudgetState();

        for (const action of actions) {
          const before = state;
          const after = budgetReducer(before, action);

          const budgetDropped =
            after.llmBudgetRemaining < before.llmBudgetRemaining;
          const callsIncreased =
            after.llmCallsDispatched > before.llmCallsDispatched;

          if (budgetDropped || callsIncreased) {
            // Attribution: the only step that may spend budget is a cache-miss
            // `ask` while not already in flight and with budget remaining.
            expect(action.type).toBe('ask');
            expect(before.isAsking).toBe(false);
            expect(before.llmBudgetRemaining).toBeGreaterThan(0);
            const key =
              action.type === 'ask' ? cacheKey(action.query) : '';
            const wasCached = key.length > 0 && before.cache.has(key);
            expect(wasCached).toBe(false);
            // Each such step moves both counters by exactly one.
            expect(after.llmBudgetRemaining).toBe(
              before.llmBudgetRemaining - 1,
            );
            expect(after.llmCallsDispatched).toBe(
              before.llmCallsDispatched + 1,
            );
          }

          state = after;
        }

        // Global ceiling: dispatched calls never exceed the session budget.
        expect(state.llmCallsDispatched).toBeLessThanOrEqual(
          LLM_SESSION_BUDGET,
        );
        expect(state.llmBudgetRemaining).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
