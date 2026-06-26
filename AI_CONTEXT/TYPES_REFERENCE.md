# KAISO Types Reference

> Source of truth for the LIVE pipeline is `src/types.ts`. (A former orphaned `schemaRegistry.ts` ontology with an incompatible parallel type system was removed 2026-06-27, eliminating the naming collisions this file used to flag.)

## The central type: `ReportSuggestion` (types.ts)

This is THE object that flows through the entire live pipeline. It accretes fields stage by stage. Knowing *where* each field is set is the key to the system.

### Field lifecycle — who sets what

| Field group | Fields | Set by |
|---|---|---|
| Identity | `id`, `reportTitle`, `marketKeyword`, `vertical`, `strategicPillar`, `thematicCluster` | **geminiService.analyzeNews** (mapped from Gemini JSON, with defaults) |
| Source | `sourceArticleTitle/Url/Date/Timestamp`, `sourceName` | geminiService (timestamp = `Date.now()` at parse) |
| Narrative | `rationale`, `b2bCommercialRationale`, `competitorWhiteSpace`, `trigger`, `trendingKeywords`, `primaryStakeholder` | geminiService |
| Commercial sub-scores (1–10) | `commercialViabilityScore`, `quantifiabilityScore`, `cagrViabilityScore`, `competitiveDensityScore`, `segmentabilityScore`, `buyerWillingnessScore`, `seoSearchabilityScore` | geminiService (schema-`required`) → **consumed by scoringEngine** |
| Other Gemini fields | `confidenceScore`(1–10), `salesPotential`, `sentimentPolarity`, `marketExecutionWindow`, `signalCount`, `contributingSignals`, `signalType`, `suggestedSegmentationAxes`, `estimatedCAGRRange`, `signalOriginGeography`, `recommendedReportGeography`, `executionRisk`, `regulatoryHurdle` | geminiService |
| Authority | `credibilityScore`, `sourceDomainMatch`, `veracityRationale` | sourceAuthorityEngine |
| Validation | `isLogicVerified`, (`inferenceRatio` — declared but never populated) | validationEngine |
| **Score** | **`opportunityScore`** (0–100) | scoringEngine (then decayed by freshnessEngine) |
| Freshness | `freshnessLabel` | freshnessEngine |
| Temporal | `signalLedger`, `forecastValidation`, `intelligenceProfile` | temporalIntelligenceEngine |
| Trends (post) | `trendScore`, `trendDirection`, `trendDirectionLabel` | trendsService (server, post-pipeline) |
| Whitespace (post) | `whiteSpaceStatus`, `whiteSpaceScore`, `whiteSpaceLabel`, `whiteSpaceCompetitors`, `whiteSpaceGapReason`, `opportunityClass`, `whiteSpaceSignals`, `whiteSpaceSerpCached` | serpOpportunityDetectionService (server, post-pipeline, Tavily) |
| Verdict (post) | `actionVerdict`, `actionReason`, `actionScore`, `actionUrgency` | actionClassificationEngine (server, post-pipeline) |

### Fields that are DECLARED but effectively dead
- `inferenceRatio`, `causalPath`, `stressTests`, `evidenceSources`, `nexusArticlesCount` — declared on `ReportSuggestion` and read by some engines (validationEngine rules 3/4, scoringEngine dedup tiebreaker, forecastEngine momentum) but **never populated by the prompt**, so those code paths are inert. `evolutionData` likewise.

### Enums
- `Vertical` (14): Healthcare, Electronics, Semiconductor, Automotive, Chemicals, Energy, Fintech, Aerospace, BFSI, Food & Beverage, Construction, Agriculture, Retail & E-Commerce, IT & Telecom. Exported as `VERTICALS`.
- `StrategicPillar` (13): Regulatory Trigger, M&A / Corporate Activity, Technology Disruption, Supply Chain Decoupling, Geographic Demand Shift, Patent / IP Filing, Clinical / Scientific Breakthrough, Competitor White Space, Emerging Application, ESG / Sustainability Mandate, Investment Surge, Consumer Behavior Shift, Cross-Vertical Convergence.
- `actionVerdict`: `'PUBLISH NOW' | 'MONITOR' | 'PASS'`.
- `whiteSpaceStatus`: `'CONFIRMED_GAP' | 'PARTIAL_COVERAGE' | 'COMMODITISED' | 'UNKNOWN'`.
- `trendDirection`: `'RISING' | 'STABLE' | 'DECLINING' | 'UNKNOWN'`.

## Other live types (types.ts)

- **`RSSArticle`** — `{ title, link, pubDate, description, sourceName, timestamp }`. Ingestion output (server.ts + rssService).
- **`EDGARSignal`** — `{ title, filingType, companyName, filingDate, excerpt, url, vertical, matchedKeyword }`. From edgarService.
- **`IntelligenceProfile`** — `{ evidenceWeight, systemicResilience, calibrationIntegrity, groundingDelta, overallConfidence, temporalDrift, forecastAccuracy }`. Attached by temporal engine.
- **`SignalLedgerEntry`**, **`ForecastValidationEntry`** — temporal tracking.
- **`EvidenceSource`**, **`StressTestScenario`**, **`CausalNode`** — used by the OpportunityDetail UI components; mostly unpopulated by the live prompt.
- **`IntelligenceBrief`** — structured brief shape (`executiveSummary`, `chapterOutline[]`, `targetPersonas[]`, `competitivePositioning`, `seoTitleVariants[]`). Note: `generateFullBrief` actually returns **markdown text**, not this object.

## `IntelligenceState` (intelligenceOrchestrator.ts) — the run result

```
{
  rawSignals, normalizedSignals, curatedPortfolio: ReportSuggestion[],  // curatedPortfolio = headline output
  diversity: DiversityResult,
  reasoningClusters, intelligenceGraph, propagationAnalysis,
  forecastAnalysis, evolutionAnalysis: EvolutionReport, priorityAnalysis: PriorityReport,
  memoryState: IntelligenceMemory,
  diagnostics: PipelineDiagnostics,  // rawSignals/deduplicated/curated counts, warnings, pipelineStages, timing
  metadata: { pipelineVersion, generatedAt, articleCount }
}
```

## Memory types (memoryEngine.ts)
`IntelligenceMemory { state, cycles[], themes[], recurrences[], forecastEvolution[] }`. `IntelligenceCycleMemory { cycleId, generatedAt, signals }`. `MemorySnapshot`/`ClusterMemoryRecord` feed evolutionEngine.

## Naming collisions — resolved (2026-06-27)

The former orphaned `schemaRegistry.ts` ontology redefined several names that also exist in the live pipeline (`ForecastClassification`, `CausalNode`, `RelationshipType`, `PropagationResult`, `SignalType`, `ConfidenceScore`). That cluster has been deleted, so each name now has a **single** meaning — the live one in `types.ts` / the live engines. Always-check-the-import-path is no longer a hazard.
