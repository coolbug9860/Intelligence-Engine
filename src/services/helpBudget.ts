/**
 * Pure state machine for the In-App Help / Search feature's per-session LLM
 * budget and answer cache. Extracted from `useHelpSearch.ts` so the budget,
 * cache, and answer-resolution invariants can be reasoned about and
 * property-tested with fast-check WITHOUT a DOM or React.
 *
 * This module is strictly pure: no React, no DOM, no I/O, no module-level
 * mutable state. `budgetReducer` returns a new state for each (state, action)
 * pair and never mutates its inputs (the cache Map is copied on write). The
 * actual network `fetch` to `/api/help/explain` lives in the hook (task 5.2);
 * here we only model the *decision* of whether a fallback LLM call is dispatched.
 *
 * The invariants this design makes provable:
 *  - `llmBudgetRemaining` never drops below 0.                         (Prop 8)
 *  - Per session, `llmCallsDispatched <= LLM_SESSION_BUDGET`.          (Prop 8)
 *  - A `query-changed` (typing) action never dispatches an LLM call and
 *    never decrements the budget.                                      (Prop 1)
 *  - Re-resolving an already-cached normalized query yields the identical
 *    cached `HelpAnswer` and dispatches no LLM call.                   (Prop 7)
 */

import { normalize } from './helpRetrieval';
import { LLM_SESSION_BUDGET, type HelpAnswer } from './helpTypes';

/**
 * Per-session budget + cache state. Treated as immutable: every reducer return
 * is a fresh object, and `cache` is replaced (never mutated) on writes.
 */
export interface BudgetState {
  /** Remaining LLM fallback calls for this session. Invariant: `>= 0`. */
  llmBudgetRemaining: number;
  /** Answer cache keyed by normalized query (see `cacheKey`). */
  cache: ReadonlyMap<string, HelpAnswer>;
  /** Currently resolved answer (cached local or LLM), or null when none. */
  answer: HelpAnswer | null;
  /** True while an LLM fallback call has been dispatched and is in flight. */
  isAsking: boolean;
  /**
   * True when the most recent in-flight fallback failed (e.g. a 502). Observable
   * by the panel to render the "AI explanation unavailable" degradation notice
   * (Req 10.2). Cleared by a fresh `ask`, a `query-changed`, a successful
   * `resolve`, or a `new-session`. The hook surfaces this instead of throwing,
   * so the notice is driven by state rather than a caught error.
   */
  askFailed: boolean;
  /**
   * Monotonic count of LLM fallback calls dispatched this session. Reset by
   * `new-session`. Drives the budget-safety property: it can never exceed the
   * session budget because each dispatch requires (and consumes) budget.
   */
  llmCallsDispatched: number;
}

/**
 * The transitions the reducer models.
 *  - `query-changed`: the user typed; refresh the active answer from cache only.
 *                     Never decrements budget, never dispatches an LLM call.
 *  - `ask`:           explicit "Ask AI" opt-in. Resolves from cache for free if
 *                     present; otherwise dispatches a fallback (decrementing the
 *                     budget) when budget remains; blocks (no-op) at zero.
 *  - `resolve`:       record a resolved answer (local or LLM) in the cache and
 *                     surface it. Idempotent per normalized query.
 *  - `ask-failed`:    an in-flight fallback failed; clear `isAsking` (no refund).
 *  - `new-session`:   reset budget, cache, and counters for a fresh session.
 */
export type BudgetAction =
  | { type: 'query-changed'; query: string }
  | { type: 'ask'; query: string }
  | { type: 'resolve'; query: string; answer: HelpAnswer }
  | { type: 'ask-failed' }
  | { type: 'new-session' };

/**
 * Cache key for a query: its normalized tokens joined into a stable string.
 * Equal-meaning queries (case/punctuation/stopword variants) collapse to the
 * same key, so they share one cache entry and never re-spend quota.
 */
export function cacheKey(query: string): string {
  return normalize(query).join(' ');
}

/**
 * Build the initial per-session state. Budget defaults to `LLM_SESSION_BUDGET`.
 *
 * @param budget - Optional starting budget (defaults to `LLM_SESSION_BUDGET`).
 */
export function createInitialBudgetState(
  budget: number = LLM_SESSION_BUDGET,
): BudgetState {
  return {
    llmBudgetRemaining: budget,
    cache: new Map(),
    answer: null,
    isAsking: false,
    askFailed: false,
    llmCallsDispatched: 0,
  };
}

/**
 * Pure reducer for the budget + cache state machine.
 *
 * Determinism: equal `(state, action)` inputs always produce an equal new
 * state. The input `state` and its `cache` are never mutated.
 */
export function budgetReducer(
  state: BudgetState,
  action: BudgetAction,
): BudgetState {
  switch (action.type) {
    case 'query-changed': {
      // Typing is free: surface a cached answer if the query was answered
      // before, otherwise clear the active answer. No budget change, no call.
      // A new query also clears any stale failure notice.
      const key = cacheKey(action.query);
      const cached = key.length > 0 ? state.cache.get(key) : undefined;
      return { ...state, answer: cached ?? null, askFailed: false };
    }

    case 'ask': {
      // Guard against a double-fire while a fallback is already in flight.
      if (state.isAsking) return state;

      const key = cacheKey(action.query);

      // Cache hit: resolve for free — no budget spend and no LLM call.
      const cached = key.length > 0 ? state.cache.get(key) : undefined;
      if (cached) {
        return { ...state, answer: cached, isAsking: false, askFailed: false };
      }

      // Budget exhausted: block. The panel degrades to local matches (Scenario
      // 3); the budget is not driven below zero.
      if (state.llmBudgetRemaining <= 0) {
        return state;
      }

      // Dispatch a fallback: decrement the budget at initiation so an in-flight
      // call still counts against the ceiling, and record the dispatch. A new
      // attempt clears any prior failure notice.
      return {
        ...state,
        llmBudgetRemaining: state.llmBudgetRemaining - 1,
        isAsking: true,
        askFailed: false,
        llmCallsDispatched: state.llmCallsDispatched + 1,
      };
    }

    case 'resolve': {
      const key = cacheKey(action.query);

      // Unkeyable (empty/whitespace) query: surface the answer but don't cache.
      if (key.length === 0) {
        return { ...state, answer: action.answer, isAsking: false, askFailed: false };
      }

      // Idempotence: the first cached answer for a key wins. Re-resolving the
      // same normalized query yields the identical stored answer (Prop 7).
      const existing = state.cache.get(key);
      if (existing) {
        return { ...state, answer: existing, isAsking: false, askFailed: false };
      }

      // First resolution for this key: record it (copy, never mutate input).
      const cache = new Map(state.cache);
      cache.set(key, action.answer);
      return { ...state, cache, answer: action.answer, isAsking: false, askFailed: false };
    }

    case 'ask-failed':
      // In-flight fallback failed; clear the flag and mark the failure so the
      // panel can render the degradation notice (Req 10.2). Budget not refunded.
      return { ...state, isAsking: false, askFailed: true };

    case 'new-session':
      // Fresh session: budget back to full, cache and counters cleared.
      return createInitialBudgetState();
  }
}
