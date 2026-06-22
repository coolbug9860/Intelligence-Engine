/**
 * React glue for the In-App Help / Search feature.
 *
 * Responsibilities (design "Component 3: useHelpSearch.ts"):
 *  - Debounce input by DEBOUNCE_MS and run pure local retrieval on each settled
 *    keystroke. Typing NEVER reaches the network or the LLM (Req 4.1, 4.2).
 *  - Drive all budget / cache / answer-resolution state through the pure
 *    `budgetReducer` (src/services/helpBudget.ts). The hook owns no budget or
 *    cache invariants; it only dispatches actions (Req 5.1, 5.2, 5.3, 7.x).
 *  - Expose `isAsking` in-flight state and an explicit `askAi()` opt-in that
 *    POSTs the query + grounding context ids to /api/help/explain and resolves
 *    the answer into the reducer's cache (Req 6.2, 6.3, 6.4).
 *
 * The hook holds no server or budget logic; the LLM fallback is reachable only
 * via the explicit `askAi()` action, never as a side effect of typing.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { KNOWLEDGE_BASE } from '../data/helpKnowledgeBase';
import {
  budgetReducer,
  createInitialBudgetState,
} from '../services/helpBudget';
import {
  searchKnowledgeBase,
  type HelpSearchResult,
} from '../services/helpRetrieval';
import {
  DEBOUNCE_MS,
  type HelpAnswer,
  type HelpExplainRequest,
  type HelpExplainResponse,
  type HelpSource,
} from '../services/helpTypes';

/** Public contract returned by the hook (design "interface UseHelpSearch"). */
export interface UseHelpSearch {
  query: string;
  setQuery: (q: string) => void;
  result: HelpSearchResult | null;
  /** A resolved answer (cached local or LLM), or null when none is active. */
  answer: HelpAnswer | null;
  /** True while an LLM fallback request is in flight (Req 6.3). */
  isAsking: boolean;
  /**
   * True when the most recent LLM fallback failed (e.g. a 502). The panel
   * derives the "AI explanation unavailable" notice from this state rather than
   * a thrown error, so degradation works when wired to the real hook (Req 10.2).
   */
  askFailed: boolean;
  /** Explicit opt-in to the grounded LLM fallback (Req 6.2). */
  askAi: () => Promise<void>;
  /** Remaining LLM fallback calls for this session (Req 7.x). */
  llmBudgetRemaining: number;
}

/** Bearer token used by the rest of the app's authenticated /api calls. */
function authToken(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('kaiso_auth_token') ?? '';
}

export function useHelpSearch(): UseHelpSearch {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<HelpSearchResult | null>(null);

  // All budget / cache / answer-resolution state lives in the pure reducer.
  const [budget, dispatch] = useReducer(
    budgetReducer,
    undefined,
    createInitialBudgetState,
  );

  // Debounced local retrieval: run only after the user stops typing for
  // DEBOUNCE_MS. Typing performs purely local, zero-cost work (Req 4.1, 4.2).
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = searchKnowledgeBase(query, KNOWLEDGE_BASE);
      setResult(next);

      // Surface a cached answer for this query or clear the active one. This
      // never decrements budget and never calls the LLM (Req 4.2, 5.2).
      dispatch({ type: 'query-changed', query });

      // A confident local hit resolves to an answer immediately and is cached
      // so re-asking is free (Req 5.1). `resolve` is idempotent per query.
      if (next.mode === 'local' && next.answer !== null) {
        const localAnswer: HelpAnswer = {
          query,
          answer: next.answer,
          // A local answer is the best entry's body, so it cites that one entry.
          sources: toSources(next.topMatches.slice(0, 1)),
          mode: 'local',
          answeredAt: Date.now(),
        };
        dispatch({ type: 'resolve', query, answer: localAnswer });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query]);

  /**
   * Explicit LLM fallback. Sends the query and the current top-match ids as
   * grounding context to /api/help/explain, then resolves the answer into the
   * reducer's cache. The reducer owns the budget/cache decision (Req 6.2, 7.2):
   * we dispatch `ask`, and only perform the network call when that transitions
   * the state into the in-flight (`isAsking`) phase — i.e. budget remained and
   * the query was not already cached.
   */
  const askAi = useCallback(async () => {
    const current = result;
    if (!current) return;

    const action = { type: 'ask' as const, query };
    // The reducer is pure: compute the prospective next state to learn whether
    // this `ask` dispatches a fallback (cache miss + budget remaining) versus a
    // free cache hit, a block at zero budget, or a no-op while already asking.
    const next = budgetReducer(budget, action);
    dispatch(action);

    // Only a transition into the in-flight phase warrants a network call.
    if (!(next.isAsking && !budget.isAsking)) return;

    const contextIds = current.topMatches.map((m) => m.entry.id);
    const payload: HelpExplainRequest = { query, contextIds };

    try {
      const response = await fetch('/api/help/explain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken()}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Surface the failure; the panel degrades to local matches on a 502
        // (Req 10.2). The budget is not refunded (handled by the reducer).
        throw new Error(`help/explain failed: ${response.status}`);
      }

      const data = (await response.json()) as HelpExplainResponse;
      const resolved: HelpAnswer = {
        query,
        answer: data.answer,
        sources: data.sources,
        mode: 'llm',
        answeredAt: Date.now(),
      };
      dispatch({ type: 'resolve', query, answer: resolved });
    } catch {
      dispatch({ type: 'ask-failed' });
    }
  }, [budget, query, result]);

  return useMemo(
    () => ({
      query,
      setQuery,
      result,
      answer: budget.answer,
      isAsking: budget.isAsking,
      askFailed: budget.askFailed,
      askAi,
      llmBudgetRemaining: budget.llmBudgetRemaining,
    }),
    [query, result, budget.answer, budget.isAsking, budget.askFailed, budget.llmBudgetRemaining, askAi],
  );
}

/** Map ranked entries into lightweight citation sources. */
function toSources(matches: HelpSearchResult['topMatches']): HelpSource[] {
  return matches.map(({ entry }) => ({
    id: entry.id,
    title: entry.title,
    sourceDoc: entry.sourceDoc,
  }));
}
