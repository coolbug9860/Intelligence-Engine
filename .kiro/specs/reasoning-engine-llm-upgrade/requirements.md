# Requirements Document

## Introduction

This feature upgrades Stage 6 of the Kaiso intelligence pipeline (`reasoningEngine.ts`). The current implementation derives signal relationships and thematic clusters from deterministic string-overlap math. This upgrade replaces that core inference with a single batched Gemini 2.5 Flash structured-output call that reasons about convergence across the entire curated portfolio at once, surfacing causal links, supply-chain dependencies, regulatory spillover, and commercial implications that string matching cannot detect.

The Reasoning Engine emits only lightweight references from the model (cluster keys and edge tuples); deterministic TypeScript then rehydrates full cluster objects from the in-memory portfolio and computes all derived numeric fields locally. The model's public output contract (`ReasoningResult`) consumed by Stage 7 and Stage 8 is preserved unchanged. On any LLM failure, the engine falls back to the preserved deterministic implementation, guaranteeing a valid result every run.

These requirements are derived from the approved design document and honor project steering: no SDK change, no new npm packages, and no `types.ts` mutation.

## Glossary

- **Reasoning_Engine**: The Stage 6 module (`reasoningEngine.ts`) responsible for inferring signal relationships and thematic clusters. Exposes the public entry point `runReasoningEngine`.
- **Curated_Portfolio**: The in-memory array of `ReportSuggestion` records (~8–10 post-diversity signals) passed into Stage 6 as authoritative signal data.
- **Reasoning_Result**: The output contract (`relationships`, `clusters`, `strongestSignals`, `macroThemes`, `reasoningSummary`) consumed by Stage 7 and Stage 8. Defined in `reasoningEngine.ts` and unchanged by this feature.
- **LLM_Envelope**: The internal lightweight structured-output object (`LLMReasoningEnvelope`) returned by the model, containing `edges`, `clusters`, `macroThemes`, and `reasoningSummary` references only. Never crosses the engine boundary.
- **Signal_Relationship**: An edge in the output (`sourceId`, `targetId`, `relationshipType`, `strength`, `rationale`).
- **Reasoning_Cluster**: A thematic cluster in the output with locally rehydrated signals and locally computed numeric fields.
- **Confidence_Band**: A qualitative judgment from the model: `WEAK`, `MODERATE`, `STRONG`, or `CRITICAL`.
- **Relationship_Type**: One of eight allowed union members describing an edge's nature.
- **Deterministic_Fallback**: The preserved string-overlap implementation (`runDeterministicReasoning`) invoked on any LLM-path failure.
- **Cluster_Id_Generator**: The `deterministicClusterId` function producing a stable `cluster_<hex>` id via FNV-1a hashing.
- **Gemini_Key_Manager**: The existing key rotation, quota failover, and transient-retry component reused from `geminiService.ts`.
- **Orchestrator**: The Stage 6 caller in `intelligenceOrchestrator.ts`.
- **Stage_8_Gate**: The `MIN_PROPAGATION_STRENGTH` threshold of 40 used by `signalPropagationEngine` to decide cascade eligibility.

## Requirements

### Requirement 1: Preserved Output Contract

**User Story:** As a downstream pipeline stage (Stage 7/8), I want the reasoning output contract preserved exactly, so that graph assembly and signal propagation continue to operate without modification.

#### Acceptance Criteria

1. WHEN `runReasoningEngine` resolves, THE Reasoning_Engine SHALL return a non-null Reasoning_Result in which `relationships` is an array of Signal_Relationship objects, `clusters` is an array of Reasoning_Cluster objects, `strongestSignals` is an array of `ReportSuggestion` objects, `macroThemes` is an array of strings, and `reasoningSummary` is a non-empty string.
2. THE Reasoning_Engine SHALL return a Reasoning_Result with the same field names and field types on both the LLM path and the Deterministic_Fallback path, such that no field present on one path is absent or differently typed on the other.
3. THE Reasoning_Engine SHALL preserve the `SignalRelationship`, `ReasoningCluster`, and `ReasoningResult` interface definitions without changing their field names, field types, or field count.
4. THE Reasoning_Engine SHALL compute `strongestSignals` by sorting the Curated_Portfolio in descending order of `opportunityScore` and selecting at most the top 10 signals, treating a missing or non-numeric `opportunityScore` as 0.
5. WHEN the Curated_Portfolio contains 10 or fewer signals, THE Reasoning_Engine SHALL return all signals in `strongestSignals`, sorted in descending order of `opportunityScore`.
6. THE Reasoning_Engine SHALL compute `macroThemes` from the resulting cluster themes, merging any model-provided macro themes without introducing duplicate values.
7. WHEN the Curated_Portfolio is empty, THE Reasoning_Engine SHALL return a Reasoning_Result with empty `relationships`, `clusters`, `strongestSignals`, and `macroThemes` arrays and a non-empty `reasoningSummary`, without throwing.

### Requirement 2: Asynchronous Public Signature

**User Story:** As an orchestrator developer, I want the Stage 6 entry point to be asynchronous, so that the engine can await a network reasoning call while downstream stages still receive a resolved result.

#### Acceptance Criteria

1. THE Reasoning_Engine SHALL expose `runReasoningEngine` as an asynchronous function whose return value is a `Promise` that resolves to a `ReasoningResult` containing the fields `relationships`, `clusters`, `strongestSignals`, `macroThemes`, and `reasoningSummary`.
2. WHEN the Orchestrator invokes Stage 6, THE Orchestrator SHALL await the `Promise` returned by `runReasoningEngine` to completion before passing the resolved `ReasoningResult` to Stage 7.
3. WHILE the network reasoning call has been pending for 45000 milliseconds or less, THE Reasoning_Engine SHALL keep awaiting that call before resolving the `Promise`.
4. IF the network reasoning call fails or remains pending for more than 45000 milliseconds, THEN THE Reasoning_Engine SHALL resolve the `Promise` with a locally computed `ReasoningResult` containing all five required fields rather than rejecting, so that Stage 7 always receives a resolved result.
5. THE Reasoning_Engine SHALL retain the exported helpers `buildSignalRelationships` and `buildReasoningClusters` with their existing call signatures so that existing importers continue to resolve.

### Requirement 3: Batched LLM Convergence Reasoning

**User Story:** As an intelligence analyst, I want the engine to reason about convergence across the entire portfolio in one batched call, so that cross-opportunity relationships invisible to string matching are surfaced.

#### Acceptance Criteria

1. WHEN the Curated_Portfolio contains 2 or more signals, THE Reasoning_Engine SHALL dispatch exactly one batched structured-output call analyzing every signal in the Curated_Portfolio.
2. THE Reasoning_Engine SHALL serialize each signal into a compact projection of exactly 7 fields: `id`, `reportTitle`, `marketKeyword`, `vertical`, `strategicPillar`, `thematicCluster`, and `primaryStakeholder`.
3. WHERE a signal lacks a non-empty value for `strategicPillar` or `primaryStakeholder`, THE Reasoning_Engine SHALL substitute the literal value `"Unspecified"` for that field in the serialized projection.
4. THE Reasoning_Engine SHALL request the model output as JSON constrained by the reasoning response schema, with `relationshipType` and `confidence` each constrained to a predefined enumerated set, such that any returned value outside these sets is treated as a schema violation.
5. THE Reasoning_Engine SHALL dispatch the call through the existing Gemini_Key_Manager so that key rotation, quota failover, and transient retry are reused unchanged.
6. WHEN the Curated_Portfolio contains fewer than 2 signals, THE Reasoning_Engine SHALL bypass the LLM call and produce the result via the Deterministic_Fallback.
7. IF the batched call exceeds 45000 milliseconds, exhausts the Gemini_Key_Manager retry and quota failover, or returns output that does not conform to the reasoning response schema, THEN THE Reasoning_Engine SHALL produce the result via the Deterministic_Fallback.

### Requirement 4: Edge Referential Validation

**User Story:** As a graph consumer, I want every emitted edge to reference real portfolio signals, so that the signal propagation adjacency map never dangles on unknown nodes.

#### Acceptance Criteria

1. WHILE converting model edges to Signal_Relationships, THE Reasoning_Engine SHALL include in the output only those edges whose `sourceId` and `targetId` both exactly match ids present in the Curated_Portfolio, and SHALL exclude every edge that fails this match.
2. IF an edge's `sourceId` equals its `targetId`, THEN THE Reasoning_Engine SHALL exclude that edge from the Signal_Relationships output.
3. IF an edge is missing a `sourceId` value, is missing a `targetId` value, or has either value as an empty string, THEN THE Reasoning_Engine SHALL exclude that edge from the Signal_Relationships output.
4. IF two or more edges form the same undirected pair (the same unordered set of `sourceId` and `targetId`), THEN THE Reasoning_Engine SHALL retain only the single edge with the highest `strength` value and SHALL exclude the remaining duplicate edges.
5. THE Reasoning_Engine SHALL order the resulting Signal_Relationships by `strength`, an integer ranging from 0 to 100, in descending order.
6. IF two or more retained Signal_Relationships have an equal `strength` value, THEN THE Reasoning_Engine SHALL order those equal-strength relationships by their original input sequence.
7. WHEN no edges satisfy the retention conditions in criteria 1 through 4, THE Reasoning_Engine SHALL produce an empty Signal_Relationships output.

### Requirement 5: Confidence Band to Strength Mapping

**User Story:** As a Stage 8 propagation consumer, I want confidence bands mapped to a strict numeric scale, so that cascade gating behaves predictably.

#### Acceptance Criteria

1. THE Reasoning_Engine SHALL map Confidence_Band `WEAK` to strength 30, `MODERATE` to 55, `STRONG` to 75, and `CRITICAL` to 95.
2. WHEN a Confidence_Band of `MODERATE`, `STRONG`, or `CRITICAL` is mapped, THE Reasoning_Engine SHALL produce a `strength` value greater than or equal to the Stage_8_Gate threshold of 40, such that the band clears the Stage_8_Gate.
3. IF a Confidence_Band value is absent, null, empty, or not one of `WEAK`, `MODERATE`, `STRONG`, or `CRITICAL`, THEN THE Reasoning_Engine SHALL apply the `WEAK` floor value of 30.
4. THE Reasoning_Engine SHALL clamp every computed `strength` value to the inclusive range 0 to 100, mapping any value below 0 to 0 and any value above 100 to 100.
5. WHEN a mapped `strength` value is less than the Stage_8_Gate threshold of 40, THE Reasoning_Engine SHALL not clear the Stage_8_Gate for that Confidence_Band.

### Requirement 6: Relationship Type Integrity

**User Story:** As a graph consumer, I want every relationship type to be a known value, so that downstream type-dependent logic never encounters free-text drift.

#### Acceptance Criteria

1. WHEN the Reasoning_Engine produces a result, THE Reasoning_Engine SHALL validate that each `relationshipType` value is an exact, case-sensitive match to one of the eight allowed values: `Thematic Convergence`, `Supply Chain Dependency`, `Regulatory Spillover`, `Technology Enablement`, `Buyer Overlap`, `Geographic Reinforcement`, `Capital Flow Alignment`, or `Infrastructure Coupling`.
2. IF a `relationshipType` value does not exactly match one of the eight allowed values (including case mismatches, leading or trailing whitespace, or any free-text value), THEN THE Reasoning_Engine SHALL exclude that relationship from the result and record an error indication identifying the rejected value, while leaving all conforming relationships in the result unchanged.
3. IF a relationship in the result has a `relationshipType` that is missing, null, or an empty string, THEN THE Reasoning_Engine SHALL exclude that relationship from the result and record an error indication identifying the relationship with the absent type.
4. WHEN validation of all relationships in a result completes, THE Reasoning_Engine SHALL guarantee that the returned result contains zero relationships whose `relationshipType` falls outside the eight allowed values.

### Requirement 7: Deterministic Cluster Identifiers

**User Story:** As a developer, I want cluster ids to be reproducible, so that identical inputs yield identical graphs that can be unit-tested for stability.

#### Acceptance Criteria

1. THE Cluster_Id_Generator SHALL produce a cluster id consisting of the literal prefix `cluster_` followed by an 8-character lowercase zero-padded hexadecimal FNV-1a 32-bit hash of the normalized theme label, for a total length of 16 characters.
2. THE Cluster_Id_Generator SHALL normalize a theme label by lowercasing it, trimming leading and trailing whitespace, and collapsing every internal run of whitespace to a single space (U+0020), in that order, before hashing.
3. WHEN two theme labels produce identical normalized values, THE Cluster_Id_Generator SHALL produce byte-identical cluster ids.
4. IF a theme label is null, empty, or normalizes to an empty string, THEN THE Cluster_Id_Generator SHALL substitute the literal value `uncategorized` before hashing.
5. THE Reasoning_Engine SHALL generate all cluster ids through the Cluster_Id_Generator without using random number generation, such that identical inputs yield identical cluster id sets across executions.

### Requirement 8: Cluster Rehydration Integrity

**User Story:** As a Stage 7 graph builder, I want clusters rehydrated from authoritative portfolio data, so that cluster nodes and membership edges receive byte-compatible input.

#### Acceptance Criteria

1. WHEN rehydrating a cluster, THE Reasoning_Engine SHALL populate `signals` with the `ReportSuggestion` objects whose ids exactly match the cluster's member ids in the Curated_Portfolio, preserving the order of the member ids.
2. IF a cluster's member ids contain duplicates, THEN THE Reasoning_Engine SHALL resolve each id once and discard duplicate occurrences.
3. IF a member signal id does not resolve to a Curated_Portfolio signal, THEN THE Reasoning_Engine SHALL drop that id while retaining the resolved members.
4. IF a rehydrated cluster contains zero resolved signals, THEN THE Reasoning_Engine SHALL discard that cluster and exclude it from the output.
5. THE Reasoning_Engine SHALL compute `averageOpportunityScore` as the arithmetic mean of `opportunityScore` over the cluster's resolved signals, treating a missing or non-numeric `opportunityScore` as 0, rounded to 1 decimal place.
6. THE Reasoning_Engine SHALL compute `dominantVerticals` and `dominantPillars` as the de-duplicated values drawn from the cluster's resolved signals, preserving first-occurrence order, and SHALL exclude empty or falsy `strategicPillar` values from `dominantPillars`.
7. THE Reasoning_Engine SHALL compute `relationshipDensity` as the count of internal relationships divided by the maximum possible directed relationships (`n × (n − 1)`, where `n` is the number of resolved signals), expressed as an integer percentage in the inclusive range 0 to 100 by multiplying the ratio by 100 and rounding to the nearest integer.
8. IF a cluster contains fewer than 2 resolved signals, THEN THE Reasoning_Engine SHALL set `relationshipDensity` to 0.
9. THE Reasoning_Engine SHALL order rehydrated clusters by `averageOpportunityScore` in descending order, preserving the relative input order of clusters that have equal `averageOpportunityScore` values.

### Requirement 9: Fallback Totality

**User Story:** As a pipeline operator, I want the engine to always return a valid result, so that downstream stages never receive a degraded or partial contract.

#### Acceptance Criteria

1. IF the LLM call throws an API or network error, THEN THE Reasoning_Engine SHALL produce the result via the Deterministic_Fallback.
2. IF the Gemini_Key_Manager exhausts all keys, THEN THE Reasoning_Engine SHALL produce the result via the Deterministic_Fallback.
3. IF the model response is empty or cannot be parsed as valid JSON, THEN THE Reasoning_Engine SHALL produce the result via the Deterministic_Fallback.
4. IF edge and cluster validation yields zero usable relationships and zero usable clusters, THEN THE Reasoning_Engine SHALL produce the result via the Deterministic_Fallback.
5. IF the LLM call remains pending for more than 45000 milliseconds, THEN THE Reasoning_Engine SHALL abort the call and produce the result via the Deterministic_Fallback.
6. WHEN any failure routes to the Deterministic_Fallback, THE Reasoning_Engine SHALL resolve to a Reasoning_Result in which all five fields are present and non-null, with `relationships`, `clusters`, `strongestSignals`, and `macroThemes` defaulting to empty arrays where no data exists and `reasoningSummary` set to a non-empty value, without throwing.
7. WHEN the Deterministic_Fallback produces a result for identical input signals, THE Reasoning_Engine SHALL produce identical fallback output across executions.
8. WHEN a failure occurs, THE Reasoning_Engine SHALL log a warning identifying the failure category (LLM error, key exhaustion, parse failure, empty validation, or timeout) before routing to the Deterministic_Fallback.

### Requirement 10: Bounded Reasoning Latency

**User Story:** As a pipeline operator, I want the reasoning call time-bounded, so that a hung model call cannot consume the whole request budget.

#### Acceptance Criteria

1. IF a single reasoning call's elapsed execution time exceeds 45000 milliseconds, THEN THE Reasoning_Engine SHALL abort the in-progress reasoning call.
2. WHEN the Reasoning_Engine aborts a reasoning call because it exceeded the 45000 millisecond limit, THE Reasoning_Engine SHALL produce the result via the Deterministic_Fallback.
3. WHEN a reasoning call is aborted at the 45000 millisecond limit, THE Reasoning_Engine SHALL execute the Deterministic_Fallback using only the in-memory Curated_Portfolio without issuing any further network or model call, and SHALL preserve the original input signals without modification.
4. WHEN the Reasoning_Engine aborts a reasoning call because it exceeded the 45000 millisecond limit, THE Reasoning_Engine SHALL record a timeout indication accessible to the pipeline operator.

### Requirement 11: Untrusted Output Handling

**User Story:** As a security-conscious developer, I want model output treated as untrusted, so that fabricated nodes cannot be injected into the graph.

#### Acceptance Criteria

1. WHEN the model returns an id to be used in a relationship or cluster, THE Reasoning_Engine SHALL validate that id against the in-memory Curated_Portfolio before using it.
2. IF a model-provided id does not match any entry in the in-memory Curated_Portfolio, THEN THE Reasoning_Engine SHALL discard the associated relationship or cluster, exclude it from the graph, and record an indication that an unvalidated id was rejected.
3. THE Reasoning_Engine SHALL request only references and qualitative judgments from the model and SHALL NOT request full `ReportSuggestion` content.
4. IF the model returns content other than references and qualitative judgments (including full `ReportSuggestion` content), THEN THE Reasoning_Engine SHALL ignore the non-reference content and SHALL NOT inject it into the graph.

### Requirement 12: Steering-Compliant Footprint

**User Story:** As the project maintainer, I want the upgrade to respect project steering constraints, so that the runtime, dependency set, and shared types remain stable.

#### Acceptance Criteria

1. THE Reasoning_Engine SHALL use the existing `@google/genai` SDK with its `package.json` version specifier, model identifier strings, and generation configuration keys unchanged.
2. THE Reasoning_Engine SHALL introduce zero new entries in the `dependencies` and `devDependencies` sections of `package.json`.
3. IF the implementation would require a new npm package, THEN THE Reasoning_Engine SHALL halt with a build-time error and leave `package.json` unmodified.
4. THE Reasoning_Engine SHALL leave `types.ts` byte-for-byte identical and SHALL declare all new internal LLM types within `reasoningEngine.ts`.
5. THE Reasoning_Engine SHALL reuse the `GeminiKeyManager`, `safeJsonParse`, and `withTimeout` helpers from `geminiService.ts`, where the only permitted change to `geminiService.ts` is adding `export` keywords, leaving signatures and bodies unchanged.
