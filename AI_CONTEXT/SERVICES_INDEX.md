# KAISO Services Index

> Every file in `src/services/` (30 total). Each entry: **purpose · inputs · outputs · dependencies · wired?**. "Wired?" = is it in the live execution path.
> Legend: 🟢 LIVE (in pipeline/server) · 🔵 LIVE (post-pipeline enrichment) · 🟠 LIVE (ingestion/export) · ⚫ ORPHANED (not imported by any live code).

---

## 🟢 Core AI engine

### geminiService.ts
- **Purpose:** The brain. `analyzeNews()` turns articles+EDGAR into scored `ReportSuggestion[]`; `generateFullBrief()` writes the commission document. Houses the prompt, multi-key rotation, JSON repair, and the floor-8 assertion.
- **Inputs:** `analyzeNews(articles: RSSArticle[], edgarSignals: EDGARSignal[], recentlySurfaced[])`; `generateFullBrief(suggestion: ReportSuggestion)`.
- **Outputs:** `ReportSuggestion[]` (mapped/defaulted from Gemini JSON); brief markdown string.
- **Key internals:** `GeminiKeyManager` (round-robin over `GEMINI_API_KEY`..`_5`, 60-min exhaustion recovery, rotates on 429/quota). Stratified sampling (≤5 articles/vertical, ≤3 EDGAR/vertical, 42 EDGAR cap). 4-layer novelty suppression block. Response schema with `required` fields incl. `thematicCluster` + commercial sub-scores. `analyzeNews` config: `gemini-2.5-flash`, temp 0.2, thinkingBudget 6144, maxOutputTokens 40000. Browser path proxies to `/api/intelligence/run` and `/api/intelligence/brief`.
- **Deps:** `@google/genai`, `../types`.
- **Gotcha:** `response.text` is a getter in current SDK; code uses a `response as any` guard.

---

## 🟢 Normalization & scoring (orchestrator Stage 2, run per-signal in order)

### sourceAuthorityEngine.ts — `normalizeSourceAuthority(s) → s`
- **Purpose:** Sets `credibilityScore` from source tier. Recognizes SEC/EDGAR filings as high authority (the fix that made commercial value drive ranking).
- **Logic:** Detects EDGAR via `sec.gov` URL or filing-type marker in anchor title → 10-K/10-Q/20-F = 92, else 8-K/EX-99/etc = 82. Otherwise matches `sourceName` against `SOURCE_AUTHORITY` map (Reuters 95 … Unknown 50). Blends with Gemini credibility (always 0, so effectively profile score), applies `SIGNAL_TYPE_MULTIPLIER` (Regulatory 1.15 … General 1.0).
- **Outputs:** `credibilityScore`, `sourceDomainMatch`, `veracityRationale`.

### validationEngine.ts — `validateSuggestion(s) → s`
- **Purpose:** Confidence-clipping safety rules.
- **Logic:** clips `confidenceScore` for high-confidence+weak-credibility, bullish-under-critical-regulation, >70% inference, broken causal path; sets `sourceDomainMatch`, `isLogicVerified`. **Rule 5 (temporal drift) is a no-op** (empty body).
- **Note:** Rules 3 & 4 read `inferenceRatio`/`causalPath` which the prompt never produces → effectively inert.

### taxonomyEngine.ts — `normalizeSuggestion(s) → s`
- **Purpose:** Canonicalizes free-text fields against small static maps (`MARKET_KEYWORD_MAP`, `THEMATIC_CLUSTER_MAP`, `VERTICAL_MAP`).

### scoringEngine.ts — `calculateOpportunityScore(s) → s` ⭐
- **Purpose:** Computes `opportunityScore` (0–100) — THE ranking number.
- **Model:** `commercialCore × evidenceGate × riskMultipliers`.
  - commercialCore = weighted sub-scores: buyerWillingness .30, quantifiability .20, seoSearchability .20, segmentability .15, cagrViability .10, competitiveDensity .05 (each ×10).
  - evidenceGate = `0.45 + 0.55×(0.6·confNorm + 0.4·credNorm)` (downward-only, 0.45–1.0).
  - riskMultipliers = executionRisk (High .75/Med .90) × regulatoryHurdle (Critical .70/Standard .85) × grounding.
- **Whitespace is NOT applied here** (it's post-pipeline; lives in actionScore).

### freshnessEngine.ts — `applyFreshnessScoring(s) → s`
- **Purpose:** Time-decay multiplier on `opportunityScore` by article age; sets `freshnessLabel` (Real-Time…Archival).

### temporalIntelligenceEngine.ts — `runTemporalIntelligence(signals[]) → signals[]`
- **Purpose:** Per-signal time-bucketed `signalLedger` (last 30), `forecastValidation` entries (for score>75), `intelligenceProfile.temporalDrift` (decays over 45d).

---

## 🟢 Curation

### deduplicationEngine.ts — `deduplicateSuggestions(s[]) → s[]`
- **Purpose:** Remove near-duplicate opportunities, keep the stronger.
- **Logic:** similar if (sameCluster && samePillar && titleOverlap≥0.55) OR (sameVertical && keywordOverlap≥0.75). `FALLBACK_CLUSTER` ("Emerging Markets") never matches itself. `chooseStrongerSignal` by opportunityScore → credibility → nexusArticlesCount.

### diversityEngine.ts — `applyDiversityProtection(candidates, config?) → DiversityResult`
- **Purpose:** Build the final `curatedPortfolio` with vertical/pillar/cluster/domain spread.
- **Logic:** soft-threshold saturation penalties; Phase 2 weak-signal rescue for uncovered verticals; diversity score (HHI-based). `DEFAULT_CONFIG.targetPortfolioSize=20` → does not trim to 8.
- **Outputs:** `{ portfolio, bench, report }`. `weakSignalReservedSlots`/`primarySlots` are computed but effectively unused.

---

## 🟢 Analytics layers (feed dashboards/analytics, not the verdict)

### reasoningEngine.ts — `runReasoningEngine(s[]) → ReasoningResult`
- Builds `SignalRelationship[]` (strength ≥40 from cluster/pillar/vertical/keyword/buyer overlap), `ReasoningCluster[]`, macro themes. **Consumed by:** intelligenceGraphEngine + orchestrator.

### intelligenceGraphEngine.ts — `buildIntelligenceGraph(reasoning, s[]) → IntelligenceGraph`
- Converts reasoning into nodes (Signal/Cluster/Vertical/Pillar) + edges. **Consumed by:** signalPropagationEngine + orchestrator. Exports `IntelligenceNode`, `IntelligenceEdge`.

### signalPropagationEngine.ts — `runSignalPropagation(graph) → PropagationResult`
- DFS propagation paths (depth ≤4, strength ≥40) + influence ranking. Depends on `intelligenceGraphEngine` types.

### forecastEngine.ts — `runForecastEngine(s[]) → ForecastResult`
- Momentum/persistence/convergence → classification (Transient/Emerging/Structural/Supercycle) + `ForecastCluster[]`. Exports `ForecastCluster`, `ForecastClassification`. **Consumed by:** evolutionEngine, priorityEngine, memoryEngine, orchestrator. (NOTE: uses `nexusArticlesCount` which is never populated.)

### evolutionEngine.ts — `evolveIntelligence({currentForecasts, historicalMemory}) → EvolutionReport`
- Compares forecast clusters vs memory snapshots → recurrence/persistence/forecast-accuracy → trajectory (Accelerating/Stable/Weakening/Collapsing) + `intelligenceWeight`. Depends on forecastEngine + memoryEngine types. Exports `EvolvedClusterAssessment`.

### priorityEngine.ts — `prioritizeIntelligence({forecasts, evolutionAssessments}) → PriorityReport`
- Escalation tiers (Background→Critical), urgency, regime-shift, asymmetry, executive exposure. Depends on forecastEngine + evolutionEngine types.

---

## 🟢 Memory

### memoryEngine.ts — `ingestIntelligenceCycle(memory, signals) → memory`, `createEmptyMemory()`, queries
- **Purpose:** Longitudinal memory: cycles, themes, recurrences, forecastEvolution. Drives novelty suppression (orchestrator reads last 15 cycles).
- **Cap:** retains last 60 cycles; lifetime `totalCycles`/`totalSignals` incremented (not array length). `structuredClone` per ingest. Depends on forecastEngine type only.

---

## 🟠 Ingestion & export

### edgarService.ts — `fetchEdgarSignals() → EDGARSignal[]`
- SEC EDGAR full-text search, 14 vertical keyword groups, 90-day lookback, forms 10-K/10-Q/8-K. 24h cache at `/tmp/edgar-cache.json` (env `EDGAR_CACHE_PATH`). Server-only (`fs`/`path`). Non-fatal. **Vertical labels here are non-canonical** (e.g. "Semiconductor & Electronics").

### rssService.ts — `fetchAllFeeds(_hours?) → RSSArticle[]`
- **Client-side only.** Calls `GET /api/rss` (the real ingestion lives in `server.ts`). `_hours` param is ignored. Has `FALLBACK_ARTICLES` for graceful degradation.

### briefExportServer.ts — `generateBriefDocxBuffer(briefText, suggestion) → Buffer`
- Server-side DOCX generation (`docx` lib). Parses the brief markdown into styled paragraphs + a scorecard table. Server-only.

---

## ⚫ ORPHANED — Canonical Ontology cluster (NOT in live path)

> These 8 files form a parallel "v2.0.0" architecture. None are imported by `intelligenceOrchestrator`, `server.ts`, `App.tsx`, components, or pages. They use `schemaRegistry` types (`Signal`/`Forecast`/`Evidence`/etc.), **not** `ReportSuggestion`. Treat as future scaffolding. Do not assume they affect runtime output.

### schemaRegistry.ts
- Shared ontology: enums (`SignalType`, `ConfidenceBand`, `ForecastClassification`=emerging/growing/stable/declining/disruptive, `CausalType`, etc.), base interfaces (`BaseIntelligenceObject`, `ConfidenceScore`, `Evidence`, `Signal`, `Forecast`, `Recommendation`, `CausalNode`/`CausalEdge`/`CausalPath`, …), normalization helpers (`clamp`, `normalizeConfidence`, `createConfidenceScore`, `calculateWeightedConfidence`). `SEMANTIC_VERSION = "2.0.0"`. ⚠️ Redefines names that also exist in `types.ts` and live engines (see TYPES_REFERENCE.md).

### evidenceEngine.ts — evidence chains, corroboration/contradiction, provenance. Exports `EvidenceChain`, `EvidenceAnalysisResult`.
### evaluationEngine.ts — `class EvaluationEngine`; system health/integrity metrics (recommendation quality, ranking integrity, forecast stability, calibration).
### benchmarkEngine.ts — `class BenchmarkEngine`; longitudinal calibration/health snapshots, degradation detection.
### causalInferenceEngine.ts — deterministic causal graph inference: nodes/edges/paths, propagation, root-cause, intervention. Largest of the orphans.
### recommendationEngine.ts — converts Forecast+Priority+Signal into ranked `Recommendation[]` (diversity-protected). Self-described as the layer after Priority Engine — but the LIVE pipeline never calls it.
### retrievalEngine.ts — semantic/temporal/entity retrieval + pattern recall + relevance ranking.
### simulationEngine.ts — `class SimulationEngine`; scenario/counterfactual/stress/sensitivity simulation with perturbations.

---

## Dependency quick-map (live only)

```
geminiService ─┐
               ├→ orchestrator ──(per signal)→ sourceAuthority → validation → taxonomy → scoring → freshness
edgarService ──┘                  └→ temporal → dedup → diversity → reasoning → graph → propagation
server.ts ingests RSS                                                              → forecast → evolution → priority → memory
server.ts post: trendsService → serpOpportunityDetectionService → actionClassificationEngine
```
