# Implementation Plan: SERP Opportunity Detection

## Overview

This plan replaces the legacy fixed-publisher `competitorWhitespaceService.ts` with a
SERP-based `Detection_Service` in `src/services/serpOpportunityDetectionService.ts`,
exporting the same `enrichWithWhiteSpaceDetection(suggestions: ReportSuggestion[]):
Promise<ReportSuggestion[]>` entry point wired at `server.ts:720`.

The work is sequenced as: test tooling and shared types/config first, then the pure
functional core (normalize → match → classify → extract → count → rubric → field
mapping) bottom-up so each layer is testable before the next builds on it, then the
I/O shell (`SerpProvider`, `FileResultCache`, `Run_Budget`, delay), then the
orchestration entry point that wires everything together, and finally the legacy export
demotion and the single `server.ts` import repoint.

Each of the 21 correctness properties from the design is implemented as a single
fast-check property test (min 100 iterations, tagged
`Feature: serp-opportunity-detection, Property {n}`). Property and unit tests are
sub-tasks placed next to the implementation they validate.

## Tasks

- [x] 1. Set up test tooling, shared types, and the Scoring_Rubric configuration
  - [x] 1.1 Add Vitest + fast-check test tooling
    - Add `vitest` and `fast-check` as devDependencies and a `"test": "vitest run"` script to `package.json`
    - Add `vitest.config.ts` (node environment) so server-side `.test.ts` files run
    - Establish test-file convention: one `.test.ts` per core function (e.g. `serpOpportunityDetectionService.normalize.test.ts`) so independent property tests live in separate files
    - _Requirements: 6.4_

  - [x] 1.2 Add internal types and new optional `ReportSuggestion` fields
    - In `src/types.ts`, append optional fields to `ReportSuggestion`: `opportunityClass?: 'GREEN' | 'YELLOW' | 'RED'`, `whiteSpaceSignals?: SerpSignalType[]`, `whiteSpaceSerpCached?: boolean` — without removing or repurposing existing white-space fields
    - Define exported internal types: `SerpSignalType`, `OpportunityClass`, `SerpOrganicResult`, `SerpResponse`, `ResultClassification`, `SignalExtraction`, `Classification`, `CachedClassification`
    - _Requirements: 10.9_

  - [x]* 1.3 Write smoke/type test for the preserved output contract
    - Assert the legacy fields (`whiteSpaceStatus`, `whiteSpaceScore`, `whiteSpaceLabel`, `whiteSpaceCompetitors`, `whiteSpaceGapReason`) still exist with their original types on `ReportSuggestion`
    - _Requirements: 10.9_

  - [x] 1.4 Define the `SCORING_RUBRIC` and `RUN_CONTROL` configuration objects
    - Create `src/services/serpOpportunityDetectionService.ts` with the `SCORING_RUBRIC` (`thresholds`, `scoreBands`, `reportIndicators`, `blogPatterns`, `reportMarketplaces`, `ownDomains`) and `RUN_CONTROL` (`runBudget`, `interCallDelayMs`, `refreshWindowMs`, `cachePath`) `as const` objects
    - Read `runBudget` (≥ 1), delay, refresh window, and cache path from env with the documented defaults; no inline numeric literals in the classification path
    - _Requirements: 2.6, 9.1, 11.1, 11.3_

  - [x]* 1.5 Write unit test asserting thresholds/budget come from config
    - Verify the rubric exposes named threshold/band fields and `runBudget` defaults to ≥ 1, with no inline literals in the classification path
    - _Requirements: 2.6, 9.1, 11.3_

- [x] 2. Implement keyword normalization, title matching, and derivation core
  - [x] 2.1 Implement `normalizeKeyword`
    - Lowercase, trim, collapse internal whitespace runs to a single space, strip leading "global" and trailing "market"/"industry" qualifiers; idempotent
    - _Requirements: 5.1_

  - [x]* 2.2 Write property test for `normalizeKeyword`
    - **Property 3: Keyword normalization is canonical and idempotent**
    - **Validates: Requirements 5.1**

  - [x] 2.3 Implement `titleMatchesKeyword`
    - Token-set comparison that is order-insensitive and singular/plural-insensitive, using the shared stopword tokenizer
    - _Requirements: 5.2, 5.3_

  - [x]* 2.4 Write property test for `titleMatchesKeyword`
    - **Property 4: Title matching ignores token order and singular/plural form**
    - **Validates: Requirements 5.2, 5.3**

  - [x] 2.5 Implement `deriveSearchKeyword` from a `ReportSuggestion`
    - Use normalized `marketKeyword` when non-empty, otherwise fall back to `reportTitle`; result is empty when both are absent/blank
    - _Requirements: 1.1_

  - [x]* 2.6 Write property test for `deriveSearchKeyword`
    - **Property 5: Search keyword derivation source-of-truth**
    - **Validates: Requirements 1.1**

  - [x] 2.7 Implement `extractDomain` from a result link
    - Return the host component of a valid URL with scheme, port, path, and query removed
    - _Requirements: 1.4_

  - [x]* 2.8 Write property test for `extractDomain`
    - **Property 6: Publisher domain extraction**
    - **Validates: Requirements 1.4**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement single-result classification and signal extraction
  - [x] 4.1 Implement `classifyResult`
    - Mark a result as Competitor_Report iff it has ≥1 report indicator (report-style URL path, "Market Size/Share/Forecast" title pattern, schema.org Report/Product markup, or Report_Marketplace domain) AND its domain is not a Kaiso own-domain
    - Exclude blog/news/article results unconditionally — regardless of any report indicators they exhibit, the blog/news/article exclusion overrides those indicators; count paywalled results that carry a title pattern or schema markup only when the URL is not a blog/news/article pattern; detect PDF results
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.4, 4.5_

  - [x]* 4.2 Write property test for `classifyResult`
    - **Property 8: Competitor_Report classification is exactly the indicator biconditional**
    - **Validates: Requirements 3.4, 3.5, 3.7, 4.1, 4.2, 4.4, 4.5**

  - [x]* 4.3 Write edge-case unit tests for `classifyResult`
    - Cover PDF detection (R3.6) and paywalled-with-indicator results (R4.4) explicitly
    - _Requirements: 3.6, 4.4_

  - [x] 4.4 Implement `extractSignals` across organic, paid, and AI-Overview blocks
    - Classify organic and paid results and pull AI Overview cited domains into a `SignalExtraction`; record which `SerpSignalType`s are present
    - _Requirements: 3.1, 3.2, 3.3, 3.8_

  - [x]* 4.5 Write property test for `extractSignals` coverage sources
    - **Property 9: Coverage is detected across organic, paid, and AI-Overview sources**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 4.6 Implement `countCompetitors`
    - Count distinct competitor domains once each and return the de-duplicated domain list
    - _Requirements: 2.5, 4.3, 10.8_

  - [x]* 4.7 Write property test for `countCompetitors`
    - **Property 10: Competitor_Count is the distinct-domain count**
    - **Validates: Requirements 2.5, 4.3, 10.8**

- [x] 5. Implement the Scoring_Rubric and output-field mapping
  - [x] 5.1 Implement `applyRubric`
    - Map Competitor_Count to Opportunity_Class via the threshold partition (0→GREEN, 1–2→YELLOW, 3–6→RED "crowded", ≥7→RED "commoditised") and compute the deterministic in-band White_Space_Score (GREEN ≥75, YELLOW 40–74, RED <40)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3, 6.4_

  - [x]* 5.2 Write property test for the threshold partition and score bands
    - **Property 1: Threshold partition determines class and score band**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3**

  - [x]* 5.3 Write property test for deterministic scoring
    - **Property 2: Scoring is deterministic**
    - **Validates: Requirements 6.4**

  - [x] 5.4 Implement `buildGapReason` explanation generator
    - Produce a one-sentence string containing the numeric Competitor_Count and naming each contributing SERP_Signal type
    - _Requirements: 6.5_

  - [x]* 5.5 Write property test for the explanation string
    - **Property 12: Explanation names the count and contributing signals**
    - **Validates: Requirements 6.5**

  - [x] 5.6 Implement `toWhiteSpaceFields`
    - Map Opportunity_Class to exactly one `whiteSpaceStatus` (GREEN→CONFIRMED_GAP, YELLOW→PARTIAL_COVERAGE, RED→COMMODITISED, missing/unrecognized→UNKNOWN) and populate `whiteSpaceScore`, `whiteSpaceLabel`, `whiteSpaceCompetitors`, `whiteSpaceGapReason`, and `whiteSpaceSignals`
    - Populate every contract field it can derive on a best-effort basis and complete the classification even when one or more fields cannot be derived (no rejection/abort)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 3.8_

  - [x]* 5.7 Write property test for class-to-status mapping
    - **Property 13: Class-to-status mapping is total and single-valued**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**

  - [x]* 5.8 Write property test for the full output contract
    - **Property 14: Classified suggestions carry the full output contract via best-effort/partial field population**
    - **Validates: Requirements 10.7**

  - [x]* 5.9 Write property test for recorded signal types
    - **Property 11: Contributing signal types are recorded**
    - **Validates: Requirements 3.8**

  - [x]* 5.10 Write edge-case unit test for unrecognized class
    - Confirm a missing/unrecognized Opportunity_Class maps to `UNKNOWN`
    - _Requirements: 10.6_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the I/O shell: provider and result cache
  - [x] 7.1 Implement the `SerpProvider` interface and `GoogleCseProvider`
    - Define `SerpProvider` (`isConfigured()`, `search(keyword)`), implement `GoogleCseProvider` reading `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID` (Google Custom Search JSON API — free 100/day, commercial-OK), normalize the vendor payload into the internal `SerpResponse` (organic only; free CSE exposes no ads/AI-overview), and add `SerpProviderError extends Error` carrying `{ code, keyword }`
    - `isConfigured()` returns false when either credential is absent
    - _Requirements: 1.2, 1.3, 7.2_

  - [x]* 7.2 Write unit test for provider invocation and payload normalization
    - Verify `search` is called with the normalized keyword and the payload maps into `SerpResponse` (organic/ads/AI-overview)
    - _Requirements: 1.2, 1.3_

  - [x] 7.3 Implement `FileResultCache`
    - Load `SERP_CACHE_PATH` once per run, serve entries keyed by normalized Search_Keyword, return `null` for missing or stale (age > Refresh_Window) entries, write entries with the current timestamp, and `flush()` to disk once at run end; treat read/parse errors as an empty cache
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x]* 7.4 Write integration test for cache persistence
    - Verify `FileResultCache.flush()` writes JSON to `SERP_CACHE_PATH` and a fresh instance reloads it
    - _Requirements: 8.5_

- [ ] 8. Implement the `enrichWithWhiteSpaceDetection` orchestration entry point
  - [ ] 8.1 Wire the per-suggestion classification flow with injectable `DetectionDeps`
    - For each suggestion: derive keyword → short-circuit empty keyword to UNKNOWN without a provider call → check cache → enforce budget → call provider with inter-call delay → extract signals → count → apply rubric → map fields; default `deps` to real provider/cache/config/clock
    - De-duplicate provider calls per distinct normalized keyword within a run (reusing successes and failures), skip billable calls on fresh cache hits, cap billable calls at `Run_Budget` and mark remaining UNKNOWN, apply the configurable inter-call delay, and set `whiteSpaceSerpCached`
    - _Requirements: 1.2, 5.4, 5.5, 8.1, 8.2, 9.2, 9.3, 9.4_

  - [ ] 8.2 Add non-fatal error handling and run logging
    - Per-suggestion try/catch plus a top-level guard so the service never throws and always returns an array of the same length; provider failure isolates one keyword to UNKNOWN; absent credential skips all lookups; log errors with the `[WhiteSpace]` prefix and log the billable call count once per run
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.5_

  - [ ]* 8.3 Write property test for empty-keyword short-circuit
    - **Property 7: Empty keyword yields UNKNOWN without a provider call**
    - **Validates: Requirements 1.5**

  - [ ]* 8.4 Write property test for length preservation / never throws
    - **Property 15: Output length is preserved and the service never throws**
    - **Validates: Requirements 7.3, 7.4**

  - [ ]* 8.5 Write property test for provider-failure isolation
    - **Property 16: Provider failure isolates to UNKNOWN and processing continues**
    - **Validates: Requirements 7.1**

  - [ ]* 8.6 Write property test for absent credential
    - **Property 17: Absent credential skips all lookups**
    - **Validates: Requirements 7.2**

  - [ ]* 8.7 Write property test for per-keyword call de-duplication
    - **Property 18: Each distinct keyword is queried at most once per run**
    - **Validates: Requirements 5.4, 5.5**

  - [ ]* 8.8 Write property test for fresh-cache-hit call avoidance
    - **Property 19: Fresh cache hits avoid billable calls**
    - **Validates: Requirements 8.1, 8.2, 8.4, 9.4**

  - [ ]* 8.9 Write property test for caching successful classifications
    - **Property 20: Successful classifications are cached with a timestamp**
    - **Validates: Requirements 8.3**

  - [ ]* 8.10 Write property test for the Run_Budget cap
    - **Property 21: Billable calls never exceed the Run_Budget**
    - **Validates: Requirements 9.2**

  - [ ]* 8.11 Write unit tests for delay and billable-count logging
    - Use fake timers to assert the inter-call delay is applied and the billable call count is logged once per run
    - _Requirements: 9.3, 9.5_

- [ ] 9. Demote the legacy service to a fallback and wire the fallback path
  - [ ] 9.1 Export the legacy publisher-check helpers
    - In `competitorWhitespaceService.ts`, additively export `checkPublisher` / `deriveWhiteSpaceResult` (no behavior change) for reuse as the fallback
    - _Requirements: 1.6_

  - [ ] 9.2 Invoke the legacy fallback when the provider is unavailable for the run
    - When the provider is unavailable, derive a best-effort classification via the legacy fixed-publisher check before defaulting to UNKNOWN
    - _Requirements: 1.6_

  - [ ]* 9.3 Write unit test for the legacy fallback path
    - Verify the legacy check is invoked when the provider is unavailable and its result drives classification (else UNKNOWN)
    - _Requirements: 1.6_

- [ ] 10. Wire the Detection_Service into the pipeline
  - [ ] 10.1 Repoint the `server.ts` import
    - Change the line 17 import source from `competitorWhitespaceService` to `serpOpportunityDetectionService`; leave the call site at line 720 unchanged
    - _Requirements: 10.7, 10.9_

  - [ ]* 10.2 Verify the build/typecheck passes end-to-end
    - Run `npm run lint` (tsc --noEmit) to confirm the repoint and new fields compile against the existing call site and the Action_Engine consumer
    - _Requirements: 10.7, 10.9_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but they encode the 21 correctness properties and the example/edge/integration coverage from the design's Testing Strategy.
- Each correctness property is implemented by exactly one fast-check property test, run with a minimum of 100 iterations (`fc.assert(..., { numRuns: 100 })`) and tagged `Feature: serp-opportunity-detection, Property {n}: {property_text}`.
- Property tests target the pure core and the orchestration invariants via an injected `MockSerpProvider`, an in-memory `ResultCache`, and an injectable clock; property tests are not hand-rolled.
- Each task references specific requirement clauses (and properties where applicable) for traceability.
- Checkpoints provide incremental validation at natural layer boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "9.1"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.3", "2.2"] },
    { "id": 5, "tasks": ["2.5", "2.4"] },
    { "id": 6, "tasks": ["2.7", "2.6"] },
    { "id": 7, "tasks": ["4.1", "2.8"] },
    { "id": 8, "tasks": ["4.4", "4.2", "4.3"] },
    { "id": 9, "tasks": ["4.6", "4.5"] },
    { "id": 10, "tasks": ["5.1", "4.7"] },
    { "id": 11, "tasks": ["5.4", "5.2", "5.3"] },
    { "id": 12, "tasks": ["5.6", "5.5"] },
    { "id": 13, "tasks": ["7.1", "5.7", "5.8", "5.9", "5.10"] },
    { "id": 14, "tasks": ["7.3", "7.2"] },
    { "id": 15, "tasks": ["8.1", "7.4"] },
    { "id": 16, "tasks": ["8.2"] },
    { "id": 17, "tasks": ["9.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11"] },
    { "id": 18, "tasks": ["10.1", "9.3"] },
    { "id": 19, "tasks": ["10.2"] }
  ]
}
```
