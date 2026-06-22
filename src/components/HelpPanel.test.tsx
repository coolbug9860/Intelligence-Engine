// @vitest-environment jsdom
/**
 * Unit tests for HelpPanel behavior (task 6.2).
 *
 * These exercise the panel's rendering + interaction contract in isolation by
 * mocking the `useHelpSearch` hook, so each scenario drives a precise hook
 * state. The hook's own budget/cache/network logic is covered by its property
 * tests; here we assert the UI honors:
 *   (a) selecting a suggestion shows that entry's body with NO network call,
 *   (b) "Ask AI" is disabled when the session LLM budget is zero,
 *   (c) a failed fallback (502) shows the "AI explanation unavailable" notice
 *       while keeping the local matches on screen,
 *   (d) Esc closes the panel,
 *   (e) the provenance badge renders local vs llm.
 *
 * Requirements: 4.4, 7.3, 10.2, 11.2, 11.3
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import HelpPanel from './HelpPanel';
import type { UseHelpSearch } from '../hooks/useHelpSearch';
import type { HelpAnswer, HelpEntry, ScoredEntry } from '../services/helpTypes';
import type { HelpSearchResult } from '../services/helpRetrieval';

// ── Mock the hook so each test controls the panel's inputs deterministically ──
let hookState: UseHelpSearch;
vi.mock('../hooks/useHelpSearch', () => ({
  useHelpSearch: () => hookState,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────
const ENTRY_A: HelpEntry = {
  id: 'metric-opportunity-score',
  category: 'metric',
  title: 'opportunityScore',
  symbols: ['opportunityScore'],
  aliases: ['the ranking number'],
  body: 'opportunityScore (0–100) is THE ranking number.',
  sourceDoc: 'AI_CONTEXT/PIPELINE_MAP.md',
};

const ENTRY_B: HelpEntry = {
  id: 'metric-action-score',
  category: 'metric',
  title: 'actionScore',
  symbols: ['actionScore'],
  aliases: ['action score'],
  body: 'actionScore layers whitespace and trend on top of the ranking number.',
  sourceDoc: 'AI_CONTEXT/KAISO_RULES.md',
};

function scored(entry: HelpEntry, score: number): ScoredEntry {
  return { entry, score };
}

function suggestionsResult(): HelpSearchResult {
  return {
    mode: 'suggestions',
    answer: null,
    topMatches: [scored(ENTRY_A, 0.4), scored(ENTRY_B, 0.3)],
    confidence: 0.4,
  };
}

function makeHook(overrides: Partial<UseHelpSearch> = {}): UseHelpSearch {
  return {
    query: 'opportunity',
    setQuery: vi.fn(),
    result: suggestionsResult(),
    answer: null,
    isAsking: false,
    askFailed: false,
    askAi: vi.fn().mockResolvedValue(undefined),
    llmBudgetRemaining: 10,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('HelpPanel', () => {
  it('shows a selected suggestion body without any network call (Req 4.4)', () => {
    hookState = makeHook();
    render(<HelpPanel onClose={vi.fn()} />);

    // Suggestions render as selectable buttons.
    const suggestion = screen.getByRole('button', { name: /opportunityScore/ });
    fireEvent.click(suggestion);

    // The selected entry's body is now displayed...
    expect(screen.getByText(ENTRY_A.body)).toBeTruthy();
    // ...and neither the LLM fallback nor the network was touched.
    expect(hookState.askAi).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('disables "Ask AI" when the session LLM budget is zero (Req 7.3)', () => {
    hookState = makeHook({ llmBudgetRemaining: 0 });
    render(<HelpPanel onClose={vi.fn()} />);

    const askAiButton = screen.getByRole('button', { name: /Ask AI/i });
    expect((askAiButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/AI budget exhausted this session/i)).toBeTruthy();
  });

  it('shows the "AI explanation unavailable" notice on a 502 while keeping local matches (Req 10.2)', async () => {
    // The hook surfaces a failed fallback through STATE (askFailed), not a
    // thrown error — clicking Ask AI never rejects. The notice is driven by the
    // flag the hook exposes after dispatching `ask-failed` internally.
    const askAi = vi.fn().mockResolvedValue(undefined);
    hookState = makeHook({ askAi, askFailed: true });
    render(<HelpPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Ask AI/i }));

    await waitFor(() =>
      expect(screen.getByText(/AI explanation unavailable/i)).toBeTruthy(),
    );
    // The click invoked the (non-throwing) fallback...
    expect(askAi).toHaveBeenCalledTimes(1);
    // ...and local matches remain visible alongside the degradation notice.
    expect(screen.getByRole('button', { name: /opportunityScore/ })).toBeTruthy();
  });

  it('closes when Escape is pressed (Req 11.3)', () => {
    const onClose = vi.fn();
    hookState = makeHook();
    render(<HelpPanel onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the local provenance badge for a selected suggestion (Req 11.2)', () => {
    hookState = makeHook();
    render(<HelpPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /opportunityScore/ }));
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.queryByText('AI')).toBeNull();
  });

  it('renders the llm provenance badge for an LLM-resolved answer (Req 11.2)', () => {
    const llmAnswer: HelpAnswer = {
      query: 'opportunity',
      answer: 'A grounded AI explanation of the ranking number.',
      sources: [{ id: ENTRY_A.id, title: ENTRY_A.title, sourceDoc: ENTRY_A.sourceDoc }],
      mode: 'llm',
      answeredAt: Date.now(),
    };
    hookState = makeHook({ result: { ...suggestionsResult(), mode: 'needs-llm' }, answer: llmAnswer });
    render(<HelpPanel onClose={vi.fn()} />);

    expect(screen.getByText(llmAnswer.answer)).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.queryByText('Local')).toBeNull();
  });
});
