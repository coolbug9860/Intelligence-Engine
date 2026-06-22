/**
 * helpBudget.budgetSafety.property.test.ts (Task 5.5)
 *
 * Feature: in-app-help-search — property-based test for budget safety.
 * **Validates: Requirements 7.2**
 *
 * Property 8: Budget safety
 *   For ANY arbitrary sequence of arbitrary actions applied to the pure
 *   `budgetReducer` from the initial state, the per-session LLM fallback
 *   ceiling is never breached and the machine degrades gracefully at zero:
 *     - `llmBudgetRemaining >= 0` at every step;
 *     - `llmBudgetRemaining + llmCallsDispatched === LLM_SESSION_BUDGET`
 *       (the invariant is preserved by every transition, including the
 *       `new-session` reset, because the initial budget is the full ceiling);
 *     - `llmCallsDispatched <= LLM_SESSION_BUDGET` at every step;
 *     - once the budget hits zero, further `ask` actions are no-ops — they
 *       neither drive the budget negative nor dispatch extra calls.
 *
 * Strategy: build a smart generator for `BudgetAction` (weighted toward the
 * common typing/ask/resolve transitions, with the occasional `new-session`
 * reset), reusing a small pool of query strings so cache hits and re-asks are
 * actually exercised. Apply each sequence step-by-step from the default
 * initial state, asserting the invariants after every transition and verifying
 * the zero-budget no-op behaviour at the moment an `ask` is applied.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  budgetReducer,
  createInitialBudgetState,
  type BudgetAction,
  type BudgetState,
} from './helpBudget';
import { LLM_SESSION_BUDGET, type HelpAnswer } from './helpTypes';

/** A small pool of queries so cache hits / re-asks collide on the same keys. */
const queryArb = fc.constantFrom(
  'opportunity score',
  'What is the verdict?',
  'pipeline stage',
  '   ', // whitespace-only → unkeyable (empty cache key)
  'diversity engine!!!',
  'score',
);

/** Arbitrary, well-formed resolved answer for `resolve` actions. */
const helpAnswerArb: fc.Arbitrary<HelpAnswer> = fc.record({
  query: fc.string(),
  answer: fc.string(),
  sources: fc.constant([]),
  mode: fc.constantFrom<HelpAnswer['mode']>('local', 'llm'),
  answeredAt: fc.nat(),
});

/**
 * Smart action generator. Weighted so the budget-spending `ask` path and the
 * cache-populating `resolve` path are common, while `new-session` (the reset
 * that must also preserve the invariant) fires occasionally.
 */
const actionArb: fc.Arbitrary<BudgetAction> = fc.oneof(
  { weight: 4, arbitrary: queryArb.map((query) => ({ type: 'query-changed', query }) as const) },
  { weight: 5, arbitrary: queryArb.map((query) => ({ type: 'ask', query }) as const) },
  {
    weight: 4,
    arbitrary: fc
      .tuple(queryArb, helpAnswerArb)
      .map(([query, answer]) => ({ type: 'resolve', query, answer }) as const),
  },
  { weight: 2, arbitrary: fc.constant({ type: 'ask-failed' } as const) },
  { weight: 1, arbitrary: fc.constant({ type: 'new-session' } as const) },
);

/** Arbitrary sequences long enough to drain the budget many times over. */
const actionSequenceArb = fc.array(actionArb, { minLength: 0, maxLength: 80 });

/** Assert every budget-safety invariant holds for a given state. */
function assertInvariants(state: BudgetState): void {
  expect(state.llmBudgetRemaining).toBeGreaterThanOrEqual(0);
  expect(state.llmCallsDispatched).toBeLessThanOrEqual(LLM_SESSION_BUDGET);
  expect(state.llmBudgetRemaining + state.llmCallsDispatched).toBe(LLM_SESSION_BUDGET);
}

describe('Property 8: Budget safety (Requirements 7.2)', () => {
  it('never breaches the session ceiling for any action sequence', () => {
    fc.assert(
      fc.property(actionSequenceArb, (actions) => {
        let state = createInitialBudgetState();
        assertInvariants(state);

        for (const action of actions) {
          const wasExhausted = state.llmBudgetRemaining === 0;
          const callsBefore = state.llmCallsDispatched;

          state = budgetReducer(state, action);
          assertInvariants(state);

          // Graceful degradation: an `ask` at zero budget is a no-op — it must
          // not drive the budget negative nor dispatch an extra fallback call.
          if (action.type === 'ask' && wasExhausted) {
            expect(state.llmBudgetRemaining).toBe(0);
            expect(state.llmCallsDispatched).toBe(callsBefore);
          }
        }
      }),
    );
  });

  it('total LLM calls dispatched across a session never exceed the budget', () => {
    fc.assert(
      fc.property(actionSequenceArb, (actions) => {
        let state = createInitialBudgetState();
        // Track the max calls observed since the last `new-session` reset.
        let maxCallsThisSession = 0;

        for (const action of actions) {
          state = budgetReducer(state, action);
          if (action.type === 'new-session') {
            maxCallsThisSession = 0;
          }
          maxCallsThisSession = Math.max(maxCallsThisSession, state.llmCallsDispatched);
          expect(maxCallsThisSession).toBeLessThanOrEqual(LLM_SESSION_BUDGET);
        }
      }),
    );
  });
});
