# Requirements Document

## Introduction

The In-App Help / Search feature adds a hybrid knowledge base to KAISO Intelligence OS so operators can ask what a section, metric, verdict, or pipeline rule means and receive an instant, accurate explanation. The system is local-first: a deterministic in-memory retrieval layer answers the majority of queries with zero LLM calls, and a grounded Gemini synthesis fallback is invoked only for conceptual questions the local index cannot satisfy with confidence, and only on explicit user request.

These requirements are derived from the approved design document and honor the project's hard constraints: the existing `geminiService.ts` is reused without model-setting changes, no new npm dependencies are added, and no existing `src/types.ts` interfaces are modified.

## Glossary

- **Help_Search_System**: The overall in-app help feature spanning client retrieval, the React UI, and the server fallback route.
- **Local_Retrieval**: The deterministic, client-side, pure search and routing module (`helpRetrieval.ts`) that scores knowledge base entries and selects a routing mode.
- **Knowledge_Base**: The static, typed array of help entries (`helpKnowledgeBase.ts`) used for both local retrieval and server-side grounding.
- **Help_Panel**: The React help/search modal UI component (`HelpPanel.tsx`).
- **Help_Search_Hook**: The React hook (`useHelpSearch.ts`) that manages debounced input, answer caching, session budget, and fallback invocation.
- **Answer_Cache**: The in-memory per-session map from normalized query to resolved answer.
- **Help_Explain_Route**: The authenticated Express endpoint `POST /api/help/explain` that builds a grounded prompt and calls Gemini.
- **Gemini_Help_Service**: The additive `askKnowledgeBase` export in `geminiService.ts` that reuses the existing key rotation, timeout, and model constant.
- **Confidence**: A normalized match score in the range 0 to 1 for the best-matching knowledge base entry.
- **LOCAL_CONFIDENCE**: The threshold (0.55) at or above which a query is answered locally.
- **SUGGEST_FLOOR**: The threshold (0.20) at or above which, but below LOCAL_CONFIDENCE, ranked suggestions are shown.
- **TOP_K**: The maximum number of ranked candidate entries surfaced and used as grounding context (4).
- **LLM_SESSION_BUDGET**: The maximum number of fallback LLM calls permitted per browser session (15).
- **DEBOUNCE_MS**: The input settle delay before local retrieval runs (250 ms).
- **Routing_Mode**: One of `local`, `suggestions`, or `needs-llm`, selected by Local_Retrieval from Confidence.

## Requirements

### Requirement 1: Local-First Retrieval

**User Story:** As a Kaiso operator, I want instant answers to help queries without any AI cost, so that I can understand metrics and sections without latency or quota consumption.

#### Acceptance Criteria

1. WHEN a user submits a help query, THE Local_Retrieval SHALL score every Knowledge_Base entry and return a result without invoking the Help_Explain_Route or Gemini_Help_Service.
2. WHEN the best-matching entry has a Confidence at or above LOCAL_CONFIDENCE, THE Local_Retrieval SHALL return Routing_Mode `local` with a non-null answer drawn from that entry.
3. WHEN the best-matching entry has a Confidence at or above SUGGEST_FLOOR and below LOCAL_CONFIDENCE, THE Local_Retrieval SHALL return Routing_Mode `suggestions` with a null answer and the ranked candidate entries.
4. WHEN no entry scores above SUGGEST_FLOOR or no entry matches, THE Local_Retrieval SHALL return Routing_Mode `needs-llm` with a null answer.
5. THE Local_Retrieval SHALL return at most TOP_K candidate entries in the result.
6. THE Local_Retrieval SHALL return exactly one Routing_Mode for any query.

### Requirement 2: Query Normalization

**User Story:** As a Kaiso operator, I want my phrasing to match the right concept regardless of casing or punctuation, so that I can ask questions naturally.

#### Acceptance Criteria

1. WHEN a query is normalized, THE Local_Retrieval SHALL lowercase the text, strip punctuation, split into tokens, and remove stopwords.
2. IF a query normalizes to zero tokens, THEN THE Local_Retrieval SHALL return Routing_Mode `suggestions` with an empty candidate list and a Confidence of 0.
3. THE Local_Retrieval SHALL produce normalization output that depends only on the input text.

### Requirement 3: Entry Scoring

**User Story:** As a Kaiso operator, I want exact references to code symbols to reliably surface the matching explanation, so that precise questions get precise answers.

#### Acceptance Criteria

1. WHEN a query contains an exact symbol of an entry, THE Local_Retrieval SHALL assign that entry a score of 1.0.
2. WHEN a query contains an alias of an entry but no exact symbol of that entry, THE Local_Retrieval SHALL assign that entry a score of at least 0.85.
3. WHEN a query shares tokens with an entry but contains no symbol or alias of that entry, THE Local_Retrieval SHALL assign a score equal to the normalized token coverage of the query.
4. THE Local_Retrieval SHALL assign every entry a score within the inclusive range 0 to 1.
5. WHEN scoring an entry, THE Local_Retrieval SHALL leave the Knowledge_Base unmodified.

### Requirement 4: Debounced Input and Suggestion Browsing

**User Story:** As a Kaiso operator, I want the help panel to respond as I type without spamming work or AI calls, so that the experience is smooth and free.

#### Acceptance Criteria

1. WHEN a user types in the Help_Panel search box, THE Help_Search_Hook SHALL wait DEBOUNCE_MS after the last keystroke before running Local_Retrieval.
2. WHILE a user is typing, THE Help_Search_Hook SHALL NOT invoke the Help_Explain_Route or Gemini_Help_Service.
3. WHEN Routing_Mode is `suggestions`, THE Help_Panel SHALL display the ranked candidate entries as selectable items.
4. WHEN a user selects a ranked suggestion, THE Help_Panel SHALL display that entry's explanation without invoking the Help_Explain_Route.

### Requirement 5: Answer Caching

**User Story:** As a Kaiso operator, I want repeated questions to resolve instantly, so that re-asking never costs latency or quota.

#### Acceptance Criteria

1. WHEN an answer is resolved either locally or via the LLM fallback, THE Answer_Cache SHALL store the answer keyed by the normalized query for the session.
2. WHEN a query whose normalized form is present in the Answer_Cache is submitted again, THE Help_Search_Hook SHALL return the cached answer without invoking the Help_Explain_Route or Gemini_Help_Service.
3. WHEN the same normalized query is resolved more than once in a session, THE Help_Search_System SHALL return identical answers across resolutions.

### Requirement 6: Explicit LLM Fallback

**User Story:** As a Kaiso operator, I want to choose when to ask the AI for a conceptual explanation, so that AI cost is only incurred when I decide it is worthwhile.

#### Acceptance Criteria

1. WHILE Routing_Mode is `suggestions` or `needs-llm`, THE Help_Panel SHALL present an "Ask AI" control as the only way to trigger the LLM fallback.
2. WHEN a user activates the "Ask AI" control and LLM_SESSION_BUDGET remains, THE Help_Search_Hook SHALL send the query and the candidate entry identifiers to the Help_Explain_Route.
3. WHILE an LLM fallback request is in flight, THE Help_Search_Hook SHALL expose an in-progress state to the Help_Panel.
4. WHEN an LLM fallback response is received, THE Help_Search_Hook SHALL store the answer in the Answer_Cache and the Help_Panel SHALL render the explanation with its cited sources.

### Requirement 7: Session LLM Budget

**User Story:** As a system operator, I want a hard ceiling on AI fallback calls per session, so that the help feature cannot drain Gemini quota.

#### Acceptance Criteria

1. WHEN an LLM fallback call is initiated, THE Help_Search_Hook SHALL decrement the remaining session budget by one.
2. THE Help_Search_System SHALL permit at most LLM_SESSION_BUDGET LLM fallback calls per browser session.
3. IF the remaining session budget is zero, THEN THE Help_Panel SHALL disable the "Ask AI" control and display only local results.
4. WHEN a new browser session begins, THE Help_Search_Hook SHALL reset the remaining session budget to LLM_SESSION_BUDGET.

### Requirement 8: Grounded LLM Explanation Endpoint

**User Story:** As a Kaiso operator, I want AI explanations grounded in the curated knowledge base, so that answers stay accurate and on-domain.

#### Acceptance Criteria

1. WHEN the Help_Explain_Route receives a request, THE Help_Explain_Route SHALL resolve the supplied context identifiers to Knowledge_Base entries on the server.
2. WHEN building the prompt, THE Help_Explain_Route SHALL instruct Gemini_Help_Service to answer only from the resolved Knowledge_Base entries.
3. WHEN the Help_Explain_Route returns a response, THE Help_Explain_Route SHALL include only sources that correspond to resolved Knowledge_Base entries.
4. THE Help_Explain_Route SHALL delegate model invocation to Gemini_Help_Service, which reuses the existing key rotation, timeout, and model constant without changing model settings.

### Requirement 9: Endpoint Security and Input Validation

**User Story:** As a system operator, I want the fallback endpoint protected and its input validated, so that it cannot be abused to drain quota or inject untrusted content.

#### Acceptance Criteria

1. WHERE a request targets the Help_Explain_Route, THE Help_Explain_Route SHALL require a valid Bearer token through the existing authentication middleware.
2. WHERE a request targets the Help_Explain_Route, THE Help_Explain_Route SHALL apply the existing `aiLimiter` rate limit.
3. IF the request query is empty or whitespace-only, THEN THE Help_Explain_Route SHALL return HTTP status 400.
4. WHEN the Help_Explain_Route processes a request, THE Help_Explain_Route SHALL enforce a server-side maximum query length.
5. WHEN the Help_Explain_Route resolves context identifiers, THE Help_Explain_Route SHALL ignore identifiers that are not present in the Knowledge_Base.
6. IF none of the supplied context identifiers resolve to a Knowledge_Base entry, THEN THE Help_Explain_Route SHALL return HTTP status 400.

### Requirement 10: Error Handling and Graceful Degradation

**User Story:** As a Kaiso operator, I want help to keep working when AI is unavailable, so that I am never blocked from finding answers.

#### Acceptance Criteria

1. IF Gemini_Help_Service fails during a fallback request, THEN THE Help_Explain_Route SHALL return HTTP status 502.
2. WHEN the Help_Panel receives a 502 from the Help_Explain_Route, THE Help_Panel SHALL render the closest local candidate entries and a notice that the AI explanation is unavailable.
3. WHILE Gemini_Help_Service is unavailable, THE Local_Retrieval SHALL continue to return local answers and suggestions.

### Requirement 11: Help Panel Display and Accessibility

**User Story:** As a Kaiso operator, I want an accessible help panel that clearly shows answers and their sources, so that I can trust and act on the information.

#### Acceptance Criteria

1. WHEN an answer is displayed, THE Help_Panel SHALL show the answer text together with its cited Knowledge_Base sources.
2. WHEN an answer is displayed, THE Help_Panel SHALL indicate whether the answer provenance is `local` or `llm`.
3. WHEN the user presses the Escape key, THE Help_Panel SHALL close.
4. WHILE an asynchronous answer is being resolved or updated, THE Help_Panel SHALL announce the update through an `aria-live` region.
5. THE Help_Panel SHALL provide keyboard-focusable controls with a visible focus indicator.

### Requirement 12: Knowledge Base Integrity

**User Story:** As a maintainer, I want the knowledge base entries to be well-formed, so that every entry is reachable by search and safe to use as grounding context.

#### Acceptance Criteria

1. THE Knowledge_Base SHALL assign each entry a unique, non-empty identifier.
2. THE Knowledge_Base SHALL ensure each entry has a non-empty title and non-empty body.
3. THE Knowledge_Base SHALL ensure each entry has at least one symbol or one alias.
4. THE Knowledge_Base SHALL serve as the single source of truth for both Local_Retrieval and Help_Explain_Route grounding.
