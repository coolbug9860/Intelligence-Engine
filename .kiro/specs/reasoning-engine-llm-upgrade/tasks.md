# Implementation Plan: Reasoning Engine LLM Upgrade

## Overview

This plan converts the design into a series of surgical, incremental coding steps that upgrade Stage 6 (`reasoningEngine.ts`) to a batched Gemini structured-output reasoning call with a total deterministic fallback. Each step builds on the previous one and ends by wiring the async entry into the orchestrator. The work is confined to three files — `reasoningEngine.ts` (the bulk), a one-line `await` in `intelligenceOrchestrator.ts`, and minimal `export` additions in `geminiService.ts` — honoring steering: no SDK change, no new npm packages, no `types.ts` mutation. Language is TypeScript (from the design); tests use the existing Vitest + fast-check toolchain.

## Tasks

- [x] 1. Expose reusable Gemini plumbing from `geminiService.ts`
  - In `src/services/geminiService.ts`, add the `export` keyword to the existing `GeminiKeyManager` instance/class, `safeJsonParse`, and the timeout helper so `reasoningEngine.ts` can import them
  - Make NO change to any signature, body, model identifier, or generation config — `export` keyword only
  - If any of these helpers is already exported, leave it unchanged
  - _Requirements: 3.5, 12.5_

- [x] 2. Add internal LLM envelope types, response schema, and band mapping in `reasoningEngine.ts`
  - [x] 2.1 Declare internal LLM types and the Gemini response schema
    - Declare `ConfidenceBand`, `LLMEdge`, `LLMClusterRef`, `LLMReasoningEnvelope`, and `LLMSignalProjection` inside `reasoningEngine.ts` (never in `types.ts`, never exported to other engines)
    - Add the `REASONING_SCHEMA` constant using `Type.*` from `@google/genai`, constraining `relationshipType` and `confidence` with `enum` to the eight allowed types and four bands
    - Confirm the preserved public `RelationshipType`, `SignalRelationship`, `ReasoningCluster`, and `ReasoningResult` interfaces are left unchanged
    - _Requirements: 1.3, 3.2, 3.4, 11.3, 12.4_

  - [x] 2.2 Implement `bandToStrength` confidence-band mapping
    - Add `BAND_TO_STRENGTH` (`WEAK:30, MODERATE:55, STRONG:75, CRITICAL:95`) and `bandToStrength`
    - Apply the `WEAK` floor (30) for absent/null/empty/unknown bands and defensively clamp the result to the inclusive range 0–100
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 2.3 Write property test for `bandToStrength`
    - **Property 3: Strength bounds**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 3. Implement deterministic cluster id generation in `reasoningEngine.ts`
  - [x] 3.1 Implement `fnv1a` and `deterministicClusterId`
    - Add the FNV-1a 32-bit hash (`Math.imul`, unsigned, 8-char zero-padded lowercase hex) and `deterministicClusterId` producing `cluster_<hex>` (16 chars total)
    - Normalize the theme label by lowercase → trim → collapse internal whitespace to a single space, in that order, before hashing; substitute `uncategorized` for null/empty/whitespace-only labels
    - Ensure no `Math.random()` remains in any cluster id path
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 3.2 Write property test for `deterministicClusterId`
    - **Property 5: Deterministic ids**
    - **Validates: Requirements 7.2, 7.3**

  - [ ]* 3.3 Write unit tests for `deterministicClusterId`
    - Same theme → identical id; case/whitespace invariance; distinct themes → distinct ids (collision smoke test); `uncategorized` substitution; 16-char `cluster_` format
    - _Requirements: 7.1, 7.4_

- [ ] 4. Implement edge referential validation in `reasoningEngine.ts`
  - [x] 4.1 Implement `validateEdges`
    - Convert `LLMEdge[]` to `SignalRelationship[]`: drop edges whose `sourceId`/`targetId` are missing, empty, equal, or not present in the valid-id set; collapse duplicate undirected pairs keeping the highest `strength`; map bands via `bandToStrength`
    - Sort surviving relationships by `strength` descending, breaking ties by original input sequence; return an empty array when none survive
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 11.1, 11.2_

  - [ ]* 4.2 Write property test for `validateEdges`
    - **Property 2: No orphan edges**
    - **Validates: Requirements 4.1, 4.2, 4.3, 11.1, 11.2**

  - [ ]* 4.3 Write unit tests for relationship-type integrity and ordering
    - Verify non-enum / missing / whitespace `relationshipType` values are excluded (schema enum plus validation), strength-descending order, and stable tie-break by input order
    - **Property 4: Enum integrity**
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 4.5, 4.6_

- [ ] 5. Implement cluster rehydration in `reasoningEngine.ts`
  - [x] 5.1 Implement `rehydrateClusters` and the `unique` helper
    - Resolve `memberSignalIds` against the `byId` map preserving member order, de-duplicate ids, drop unknown ids, and discard clusters with zero resolved signals
    - Compute `averageOpportunityScore` (mean, 2-decimal rounding, missing score as 0), `dominantVerticals`/`dominantPillars` (de-duplicated, ordered by descending count then alphabetical), and `relationshipDensity` (internal/max possible, bounded 0–1, 2-decimal; 0 when fewer than 2 signals)
    - Order clusters by `averageOpportunityScore` descending, breaking ties by ascending `clusterId`; assign ids via `deterministicClusterId`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 11.1, 11.2_

  - [ ]* 5.2 Write property test for `rehydrateClusters`
    - **Property 6: Cluster integrity**
    - **Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.7**

  - [ ]* 5.3 Write unit tests for cluster computations
    - Duplicate-id resolution, unknown-id drop, empty-cluster discard, density edge cases, and dominant ordering tie-breaks
    - _Requirements: 8.2, 8.6, 8.8, 8.9_

- [ ] 6. Implement portfolio serialization and the Gemini transport in `reasoningEngine.ts`
  - [x] 6.1 Implement `serializeForLLM` and the reasoning prompt builder
    - Project each signal to exactly the 7 fields (`id`, `reportTitle`, `marketKeyword`, `vertical`, `strategicPillar`, `thematicCluster`, `primaryStakeholder`), substituting `"Unspecified"` for empty `strategicPillar`/`primaryStakeholder`
    - Build the batched whole-portfolio prompt instructing references-only ids and the eight relationship types
    - _Requirements: 3.2, 3.3, 11.3, 11.4_

  - [x] 6.2 Implement `callGeminiReasoning` with bounded timeout
    - Add `REASONING_TIMEOUT_MS = 45000` and a `withTimeout` race using `AbortController`; dispatch one batched structured-output call (`temperature 0.2`, `thinkingBudget 4096`, `responseMimeType application/json`, `responseSchema REASONING_SCHEMA`) through the reused `GeminiKeyManager`, parsing via `safeJsonParse` and returning `LLMReasoningEnvelope | null`
    - _Requirements: 3.1, 3.5, 3.7, 10.1, 10.4, 12.1, 12.5_

  - [ ]* 6.3 Write unit tests for `serializeForLLM`
    - Exactly 7 fields per signal; `"Unspecified"` substitution; references-only (no full `ReportSuggestion` content)
    - _Requirements: 3.2, 3.3, 11.3_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the deterministic fallback core and result assembly in `reasoningEngine.ts`
  - [x] 8.1 Refactor existing string-overlap logic into `runDeterministicReasoning`
    - Preserve the current `buildSignalRelationships` and `buildReasoningClusters` exports and signatures; route the existing logic through `runDeterministicReasoning`, swapping the `Math.random()` cluster id for `deterministicClusterId`
    - Ensure identical input signals produce identical fallback output across executions
    - _Requirements: 2.5, 9.7, 7.5_

  - [x] 8.2 Implement `assembleResult`
    - Compute `strongestSignals` (sort portfolio by `opportunityScore` descending, missing/non-numeric as 0, top 10) and `macroThemes` (unique cluster themes merged with model macro themes, no duplicates); return the full five-field `ReasoningResult`
    - Handle the empty-portfolio case: empty arrays plus a non-empty `reasoningSummary`, without throwing
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 8.3 Write unit tests for `assembleResult` and fallback parity
    - strongestSignals sorting/top-10/missing-score handling, macroThemes de-duplication, empty-portfolio shape, and fallback shape parity with the LLM path
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 1.7_

- [x] 9. Implement the async `runReasoningEngine` entry with total fallback in `reasoningEngine.ts`
  - [x] 9.1 Implement async `runReasoningEngine`
    - Make `runReasoningEngine` `async` returning `Promise<ReasoningResult>`; short-circuit portfolios with fewer than 2 signals to `runDeterministicReasoning`
    - On the LLM path, call `callGeminiReasoning`, run `validateEdges` + `rehydrateClusters`, treat zero-usable-edges-and-clusters as a failure, then `assembleResult`; wrap everything so any error/timeout/parse/empty/key-exhaustion logs a categorized warning and resolves via `runDeterministicReasoning` (never rejects)
    - _Requirements: 2.1, 2.3, 2.4, 3.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8, 10.2, 10.3, 11.4_

  - [ ]* 9.2 Write property test for fallback totality and contract preservation
    - **Property 7: Fallback totality** and **Property 1: Contract preservation**
    - **Validates: Requirements 2.4, 9.6, 1.1, 1.2**

  - [ ]* 9.3 Write unit tests for failure-mode routing and bounded latency
    - Mock Gemini for success path and each failure mode (throw, null parse, empty envelope, all-orphan edges, timeout > 45s) routing to deterministic fallback
    - **Property 8: Bounded latency**
    - _Requirements: 2.3, 3.6, 3.7, 9.1, 9.3, 9.4, 10.1, 10.2_

- [x] 10. Wire the async entry into the orchestrator
  - [x] 10.1 Add `await` at Stage 6 in `intelligenceOrchestrator.ts`
    - Change the Stage 6 call to `const reasoningResult = await runReasoningEngine(curatedPortfolio);` so the resolved result is passed to Stage 7
    - _Requirements: 2.2_

  - [ ]* 10.2 Write integration test for the Stage 6 → 7 → 8 flow
    - With a mocked Gemini response, confirm `reasoningResult` is resolved before Stage 7 consumes it and that propagation cascades only on `strength >= 40` edges with no dangling references
    - _Requirements: 2.2, 1.1, 5.2_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific requirement clauses for traceability.
- Property tests use the existing `fast-check` + `vitest` toolchain — no new dependencies (steering-compliant).
- All implementation is confined to `reasoningEngine.ts`, a one-line `await` in `intelligenceOrchestrator.ts`, and `export`-only additions in `geminiService.ts`; `types.ts` is left byte-for-byte identical.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["3.1", "2.3"] },
    { "id": 4, "tasks": ["4.1", "3.2", "3.3"] },
    { "id": 5, "tasks": ["5.1", "4.2", "4.3"] },
    { "id": 6, "tasks": ["6.1", "5.2", "5.3"] },
    { "id": 7, "tasks": ["6.2", "6.3"] },
    { "id": 8, "tasks": ["8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3"] },
    { "id": 10, "tasks": ["9.1"] },
    { "id": 11, "tasks": ["10.1", "9.2", "9.3"] },
    { "id": 12, "tasks": ["10.2"] }
  ]
}
```
