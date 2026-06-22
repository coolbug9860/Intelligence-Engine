# Implementation Plan: In-App Help / Search (Hybrid Knowledge Base)

## Overview

This plan implements the local-first hybrid help/search feature in incremental, testable steps. It builds from the foundational types and knowledge base, through the pure client retrieval layer, the React hook and panel, and finally the authenticated server fallback route and additive Gemini export. Each step builds on prior ones and ends wired into the application. Property-based tests (fast-check, an existing devDependency) encode the design's Correctness Properties; unit and integration tests cover edge cases. No new npm packages are added, `src/types.ts` is not modified, and `geminiService.ts` model settings are unchanged.

## Tasks

- [x] 1. Define help types module
  - Create `src/services/helpTypes.ts` with `HelpEntry`, `HelpCategory`, `ScoredEntry`, `HelpAnswer`, `HelpSource`, `HelpExplainRequest`, and `HelpExplainResponse` interfaces exactly as proposed in the design
  - Export tunable constants `DEBOUNCE_MS = 250`, `LOCAL_CONFIDENCE = 0.55`, `SUGGEST_FLOOR = 0.20`, `TOP_K = 4`, `LLM_SESSION_BUDGET = 15`
  - Do NOT modify `src/types.ts`
  - _Requirements: 1.5, 6.x, 7.2, 8.x_

- [x] 2. Author the knowledge base
  - [x] 2.1 Create `src/data/helpKnowledgeBase.ts`
    - Author a typed `HelpEntry[]` (KNOWLEDGE_BASE) of curated entries derived from `AI_CONTEXT/` docs, covering metrics, sections, verdicts, pillars, verticals, pipeline-stages, and concepts
    - Ensure each entry has a unique non-empty `id`, non-empty `title` and `body`, and at least one `symbol` or `alias`; keep `body` bounded (~600 chars)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x]* 2.2 Write unit tests for knowledge base integrity
    - Assert unique non-empty ids, non-empty titles/bodies, and non-empty symbols+aliases per entry
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 3. Implement local retrieval (pure)
  - [x] 3.1 Implement `normalize` in `src/services/helpRetrieval.ts`
    - Lowercase, strip punctuation, split into tokens, remove stopwords; output depends only on input text
    - Return empty token list for whitespace/empty input
    - _Requirements: 2.1, 2.3_

  - [x]* 3.2 Write unit tests for `normalize`
    - Cover punctuation stripping, casing, stopword removal, and empty input
    - _Requirements: 2.1, 2.3_

  - [x] 3.3 Implement `scoreEntry` in `src/services/helpRetrieval.ts`
    - Exact symbol in query → 1.0; alias in query → ≥ 0.85; otherwise normalized token coverage; clamp to [0,1]; no KB mutation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x]* 3.4 Write property test for score bounds
    - **Property 4: Score bounds**
    - **Validates: Requirements 3.4**

  - [x]* 3.5 Write property test for exact-symbol determinism
    - **Property 3: Exact-symbol determinism**
    - **Validates: Requirements 3.1**

  - [x] 3.6 Implement `searchKnowledgeBase` in `src/services/helpRetrieval.ts`
    - Normalize query; empty tokens → `suggestions` with empty matches and confidence 0; score all entries, sort descending, take TOP_K; route by `LOCAL_CONFIDENCE`/`SUGGEST_FLOOR`; return exactly one mode; `local` implies non-null answer
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.2_

  - [x]* 3.7 Write property test for local-confidence soundness
    - **Property 2: Local-confidence soundness**
    - **Validates: Requirements 1.2**

  - [x]* 3.8 Write property test for TopK bound
    - **Property 6: TopK bound**
    - **Validates: Requirements 1.5**

  - [x]* 3.9 Write property test for purity
    - **Property 5: Purity**
    - **Validates: Requirements 3.5**

  - [x]* 3.10 Write unit tests for routing boundaries
    - Test mode transitions exactly at `LOCAL_CONFIDENCE` and `SUGGEST_FLOOR`, and TOP_K truncation
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the budget reducer and help search hook
  - [x] 5.1 Implement the pure budget reducer in `src/services/helpBudget.ts`
    - Extract the per-session LLM budget logic and the answer-resolution / cache state transitions out of the hook into a pure module: no React, no DOM, no I/O
    - Export `budgetReducer(state, action)`, an initial-state factory (e.g. `createInitialBudgetState`), and the action types
    - Model state transitions: a typing/query-changed action never emits an LLM call and never decrements budget; an ask action decrements `llmBudgetRemaining` and blocks at zero; a resolve/cache action records answers in a `Map<normalizedQuery, HelpAnswer>` keyed state so re-resolving a cached query performs no LLM call; a new-session action resets to `LLM_SESSION_BUDGET`
    - Do NOT add new npm packages, do NOT modify `src/types.ts`, do NOT change `geminiService.ts` model settings
    - _Requirements: 5.1, 5.2, 5.3, 6.2, 6.3, 6.4, 7.1, 7.2, 7.4_

  - [x] 5.2 Refactor `useHelpSearch` in `src/hooks/useHelpSearch.ts` to a thin wrapper over the reducer
    - Rework of previously written code: drive budget/cache/answer-resolution state through `budgetReducer` (e.g. via `useReducer`), holding only React glue — debounce by `DEBOUNCE_MS`, the `fetch` to `/api/help/explain`, and wiring
    - Keep the hook's public contract unchanged (`query`, `setQuery`, `result`, `isAsking`, `askAi`, `llmBudgetRemaining`); run local retrieval on each settled keystroke and never call the fallback while typing
    - Move all budget/cache invariants into the reducer; the hook dispatches actions rather than owning that state
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 5.3, 6.2, 6.3, 6.4, 7.1, 7.2, 7.4_

  - [x]* 5.3 Write property test for no-LLM-on-typing against the pure reducer
    - Target `budgetReducer` in `src/services/helpBudget.ts` directly with fast-check (no jsdom/DOM): for all sequences of typing/query-changed actions, no LLM call is emitted and budget never decrements unless an ask action occurs
    - **Property 1: No-LLM-on-typing**
    - **Validates: Requirements 4.2**

  - [x]* 5.4 Write property test for cache idempotence against the pure reducer
    - Target `budgetReducer` in `src/services/helpBudget.ts` directly with fast-check (no DOM): for all queries, resolving the same normalized query twice yields identical answers and the second resolution triggers no LLM call
    - **Property 7: Cache idempotence**
    - **Validates: Requirements 5.3**

  - [x]* 5.5 Write property test for budget safety against the pure reducer
    - Target `budgetReducer` in `src/services/helpBudget.ts` directly with fast-check (no DOM): for all action sequences, total LLM fallback calls never exceed `LLM_SESSION_BUDGET` and the state degrades gracefully at zero
    - **Property 8: Budget safety**
    - **Validates: Requirements 7.2**

- [x] 6. Implement the help panel UI
  - [x] 6.1 Create `src/components/HelpPanel.tsx`
    - Reuse `DocumentationView` modal styling; render search box, instant local answer with cited sources, ranked suggestions as selectable items, and a `local`/`llm` provenance badge
    - Selecting a suggestion shows that entry's explanation without calling the fallback
    - Show an "Ask AI" control as the only fallback trigger while mode is `suggestions`/`needs-llm`; disable it when budget is zero
    - On a 502, render closest local candidates plus an "AI explanation unavailable" notice
    - Accessibility: Esc closes, keyboard-focusable controls with visible focus, `aria-live` region for async answer updates
    - _Requirements: 4.3, 4.4, 6.1, 7.3, 10.2, 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x]* 6.2 Write unit tests for HelpPanel behavior
    - Test suggestion selection (no fetch), Ask-AI disabled at zero budget, 502 degradation notice, Esc-to-close, and provenance badge rendering
    - _Requirements: 4.4, 7.3, 10.2, 11.2, 11.3_

- [x] 7. Wire the help panel into the app
  - Mount `HelpPanel` in `src/App.tsx` with an open/close trigger consistent with existing modal conventions
  - _Requirements: 11.3_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add the grounded Gemini export
  - Add additive `askKnowledgeBase(query, context)` export to `src/services/geminiService.ts` that builds a grounded prompt instructing the model to answer only from the supplied KB context and reuses the existing `keyManager`, `withTimeout`, and model constant
  - Do NOT change any existing function or model setting
  - _Requirements: 8.2, 8.4_

- [x] 10. Implement the fallback route
  - [x] 10.1 Add `POST /api/help/explain` to `server.ts`
    - Place below existing auth middleware (requires Bearer token) and apply the existing `aiLimiter`
    - Return 400 on empty/whitespace query; enforce a server-side max query length; resolve `contextIds` against KNOWLEDGE_BASE ignoring unknown ids; return 400 if none resolve
    - Build the grounded prompt, call `askKnowledgeBase`, and respond with `{ answer, sources, mode: 'llm' }` where sources reflect only resolved entries; return 502 on Gemini failure
    - _Requirements: 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1_

  - [x]* 10.2 Write property test for grounding integrity
    - **Property 9: Grounding integrity**
    - **Validates: Requirements 8.3**

  - [x]* 10.3 Write unit tests for the route
    - Test 400 on empty query, 400 when no contextIds resolve, 502 on Gemini failure, and happy-path response shape
    - _Requirements: 9.3, 9.6, 10.1_

- [x] 11. Integration and graceful degradation
  - [x] 11.1 Verify end-to-end wiring through automated tests
    - With a mocked `/api/help/explain`: assert local-hit path makes no fetch, fallback path fires exactly once, caches the result, and decrements the budget; assert local retrieval keeps working when the fallback is unavailable
    - _Requirements: 4.2, 5.2, 7.1, 10.3_

  - [x]* 11.2 Write integration tests for hook + mocked route
    - Cover local-hit (no fetch), single fallback fire, cache reuse, budget decrement, and 502 degradation to local matches
    - _Requirements: 5.2, 6.4, 7.1, 10.2_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific granular requirements for traceability.
- Property tests use fast-check (existing devDependency) and validate the design's Correctness Properties.
- Unit and integration tests validate specific examples, edge cases, and wiring.
- Hard constraints honored: no new npm packages, no `src/types.ts` edits, no `geminiService.ts` model-setting changes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "3.5", "3.6"] },
    { "id": 4, "tasks": ["3.7", "3.8", "3.9", "3.10"] },
    { "id": 5, "tasks": ["5.1", "9"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4", "5.5", "6.1", "10.1"] },
    { "id": 7, "tasks": ["6.2", "7", "10.2", "10.3"] },
    { "id": 8, "tasks": ["11.1"] },
    { "id": 9, "tasks": ["11.2"] }
  ]
}
```
