// @vitest-environment jsdom
/**
 * End-to-end wiring integration tests (task 11.1).
 *
 * Feature: in-app-help-search — verifies the REAL `useHelpSearch` hook wired to
 * the REAL local retrieval + budget reducer, with only the network boundary
 * (`global.fetch` → /api/help/explain) mocked. This is the genuine integration
 * surface: nothing about the hook, reducer, or retrieval is stubbed.
 *
 * Covers:
 *  (a) a confident local-hit query resolves with NO fetch        (Req 4.2, 10.3)
 *  (b) the "Ask AI" fallback fires EXACTLY ONE fetch, caches the result
 *      (re-ask → no second fetch), and decrements the budget by one
 *                                                                 (Req 5.2, 7.1)
 *  (c) on a 502, local matches stay visible + the degradation notice shows
 *      (driven through hook STATE, not a thrown error)            (Req 10.2/10.3)
 *  (d) local retrieval keeps working when the fallback is unavailable
 *                                                                 (Req 10.3)
 *  (e) a successful fallback renders the LLM explanation WITH its cited
 *      sources and an `llm` provenance badge in the panel         (Req 6.4)
 *
 * Requirements (task 11.1): 4.2, 5.2, 7.1, 10.3
 * Requirements (task 11.2): 5.2, 6.4, 7.1, 10.2
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';

import { useHelpSearch } from './useHelpSearch';
import HelpPanel from '../components/HelpPanel';
import { LLM_SESSION_BUDGET } from '../services/helpTypes';

// A query whose exact symbol (`opportunityScore`) is in the KB → confident
// local hit (score 1.0 → mode 'local'), answered with zero network cost.
const LOCAL_HIT_QUERY = 'opportunityScore';

// A query that scores in the suggestions band (~0.25): one meaningful token
// ("evidence") overlaps KB entries while the rest are nonsense. No symbol/alias
// is a substring, so it never resolves locally → the "Ask AI" fallback applies.
const FALLBACK_QUERY = 'evidence pizza burger taco';

/** A successful grounded LLM response from the mocked route. */
function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      answer: 'A grounded AI explanation built from the closest KB entries.',
      sources: [{ id: 'metric-evidence-gate', title: 'evidenceGate' }],
      mode: 'llm',
    }),
  };
}

/** A 502 from the mocked route (Gemini unavailable). */
function badGatewayResponse() {
  return {
    ok: false,
    status: 502,
    json: async () => ({ error: 'AI explanation unavailable. Showing local matches.' }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useHelpSearch end-to-end wiring (task 11.1)', () => {
  it('(a) resolves a confident local hit with NO fetch (Req 4.2, 10.3)', async () => {
    const { result } = renderHook(() => useHelpSearch());

    act(() => result.current.setQuery(LOCAL_HIT_QUERY));

    // Debounced local retrieval settles into a confident local answer.
    await waitFor(() => expect(result.current.result?.mode).toBe('local'));
    expect(result.current.answer?.mode).toBe('local');
    expect(result.current.answer?.answer).toBeTruthy();

    // The local path never touches the network or the session budget.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.llmBudgetRemaining).toBe(LLM_SESSION_BUDGET);
  });

  it('(b) fires exactly one fetch, caches the result, and decrements the budget (Req 5.2, 7.1)', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { result } = renderHook(() => useHelpSearch());

    act(() => result.current.setQuery(FALLBACK_QUERY));
    await waitFor(() => expect(result.current.result?.mode).toBe('suggestions'));

    // Explicit opt-in: the only path that reaches the network.
    await act(async () => {
      await result.current.askAi();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/help/explain', expect.objectContaining({ method: 'POST' }));
    expect(result.current.answer?.mode).toBe('llm');
    // Budget decremented by exactly one (Req 7.1).
    expect(result.current.llmBudgetRemaining).toBe(LLM_SESSION_BUDGET - 1);

    // Re-asking the same (now cached) query resolves from cache: no 2nd fetch
    // and no further budget spend (Req 5.2).
    await act(async () => {
      await result.current.askAi();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.llmBudgetRemaining).toBe(LLM_SESSION_BUDGET - 1);
  });

  it('(b/502) a failed fallback consumes the call, surfaces askFailed, and keeps local matches (Req 10.2/10.3)', async () => {
    fetchMock.mockResolvedValue(badGatewayResponse());
    const { result } = renderHook(() => useHelpSearch());

    act(() => result.current.setQuery(FALLBACK_QUERY));
    await waitFor(() => expect(result.current.result?.mode).toBe('suggestions'));
    const matchesBefore = result.current.result?.topMatches.length ?? 0;
    expect(matchesBefore).toBeGreaterThan(0);

    await act(async () => {
      await result.current.askAi();
    });

    // The failure is observable through STATE (not a thrown error): the hook's
    // promise resolves, askFailed flips true, and no answer is cached.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.askFailed).toBe(true);
    expect(result.current.isAsking).toBe(false);
    expect(result.current.answer).toBeNull();
    // Budget is consumed (not refunded) and local matches remain intact.
    expect(result.current.llmBudgetRemaining).toBe(LLM_SESSION_BUDGET - 1);
    expect(result.current.result?.topMatches.length).toBe(matchesBefore);
  });

  it('(d) local retrieval keeps working after the fallback is unavailable (Req 10.3)', async () => {
    fetchMock.mockResolvedValue(badGatewayResponse());
    const { result } = renderHook(() => useHelpSearch());

    // Trigger a failed fallback first.
    act(() => result.current.setQuery(FALLBACK_QUERY));
    await waitFor(() => expect(result.current.result?.mode).toBe('suggestions'));
    await act(async () => {
      await result.current.askAi();
    });
    expect(result.current.askFailed).toBe(true);

    // Now a confident local query still resolves locally, with no extra fetch.
    act(() => result.current.setQuery(LOCAL_HIT_QUERY));
    await waitFor(() => expect(result.current.result?.mode).toBe('local'));
    expect(result.current.answer?.mode).toBe('local');
    expect(result.current.askFailed).toBe(false); // cleared on query change
    expect(fetchMock).toHaveBeenCalledTimes(1); // still just the one failed call
  });
});

describe('HelpPanel end-to-end degradation (task 11.1, real hook)', () => {
  it('(c) shows the unavailable notice on a 502 while keeping local matches visible (Req 10.2)', async () => {
    fetchMock.mockResolvedValue(badGatewayResponse());
    render(<HelpPanel onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Search help'), {
      target: { value: FALLBACK_QUERY },
    });

    // Debounced local retrieval surfaces suggestions + the Ask AI control.
    // Wait for the suggestions list (debounce-settled state), not the Ask AI
    // button alone — that renders immediately on the initial empty result.
    await screen.findByText('Suggestions');
    const askAiButton = screen.getByRole('button', { name: /Ask AI/i });

    fireEvent.click(askAiButton);

    // The degradation notice appears (driven by hook state, not a thrown error).
    await waitFor(() =>
      expect(screen.getByText(/AI explanation unavailable/i)).toBeTruthy(),
    );
    // Local matches remain visible alongside the notice (Req 10.2/10.3).
    expect(screen.getByText('Suggestions')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('(e) renders the LLM explanation with its cited sources on a successful fallback (Req 6.4)', async () => {
    fetchMock.mockResolvedValue(okResponse());
    render(<HelpPanel onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Search help'), {
      target: { value: FALLBACK_QUERY },
    });

    // Debounced local retrieval surfaces suggestions + the Ask AI control.
    await screen.findByText('Suggestions');
    fireEvent.click(screen.getByRole('button', { name: /Ask AI/i }));

    // The grounded answer text renders (Req 6.4 — explanation rendered).
    await screen.findByText(/A grounded AI explanation built from the closest KB entries\./i);
    // Its cited source is shown under a Sources list (Req 6.4 — cited sources).
    expect(screen.getByText('Sources')).toBeTruthy();
    expect(screen.getByText('evidenceGate')).toBeTruthy();
    // Provenance badge marks the answer as AI-sourced (llm).
    expect(screen.getByText('AI')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
