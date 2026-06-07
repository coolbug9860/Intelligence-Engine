# KAISO Pipeline Map — Execution Flow

> The complete, ordered execution path of one research run. Built from `server.ts` + `intelligenceOrchestrator.ts` + the engines. Stage numbers match the orchestrator's `pipelineStages`.

## Entry points

- **Browser:** `App.loadSignals()` → `runIntelligencePipeline(...)`. Because `typeof window !== 'undefined'`, the orchestrator **proxies** to `POST /api/intelligence/run` and returns the server's JSON. (The client also calls `GET /api/rss` separately, only to populate the left-hand "Live Signal Feed" display.)
- **Server:** `POST /api/intelligence/run` (`server.ts`) is where the real work happens.

## Phase 0 — Ingestion (server.ts, before the pipeline)

Runs in parallel (`Promise.all`):
- `ingestStableRssFeeds()` — fetches 54 `STABLE_RSS_FEEDS` + NewsAPI (3 grouped queries). 30-min in-memory cache + in-flight lock. Per-item timestamp uses `isoDate || pubDate`; **drops undated and future-dated items** (48h window, +1h future tolerance). Output: `RSSArticle[]`.
- `fetchEdgarSignals()` (`edgarService`) — SEC EDGAR full-text search across 14 vertical keyword groups, last 90 days, forms 10-K/10-Q/8-K. 24-hour disk cache at `/tmp/edgar-cache.json`. Non-fatal. Output: `EDGARSignal[]` (~2,000+).

`pipelineArticles = rssArticles.length > 0 ? rssArticles : bodyArticles`. Persisted memory is loaded from `/tmp/kaiso-memory.json` (the client's `previousMemory` body field is **ignored** server-side).

## Phase 1 — `runIntelligencePipeline` (orchestrator, 12 stages)

| Stage | Engine / fn | Input → Output | Notes |
|---|---|---|---|
| 1. AI Signal Extraction | `geminiService.analyzeNews(articles, edgarSignals, recentlySurfaced)` | articles+EDGAR → `ReportSuggestion[]` (8–10) | Stratifies articles (≤5/vertical) + EDGAR (≤3/vertical, 42 cap). Builds prompt w/ 4-layer novelty suppression from memory. `gemini-2.5-flash`, temp 0.2, thinkingBudget 6144. Floor-8 assertion; returns `[]` on failure. |
| 2. Source Authority | `sourceAuthorityEngine.normalizeSourceAuthority` | per signal | Sets `credibilityScore`. **Recognizes SEC/EDGAR as high authority** (10-K/Q=92, 8-K/EX-99=82). |
| 2. Validation | `validationEngine.validateSuggestion` | per signal | Confidence-clipping rules; sets `sourceDomainMatch`, `isLogicVerified`. |
| 2. Taxonomy | `taxonomyEngine.normalizeSuggestion` | per signal | Canonicalizes `marketKeyword`/`thematicCluster`/`vertical`. |
| 2. Scoring | `scoringEngine.calculateOpportunityScore` | per signal | **Sets `opportunityScore`** = commercialCore × evidenceGate × risk. THE ranking number. |
| 2. Freshness | `freshnessEngine.applyFreshnessScoring` | per signal | Time-decays `opportunityScore`, sets `freshnessLabel`. |
| 2.5 Temporal | `temporalIntelligenceEngine.runTemporalIntelligence` | signals[] | Adds `signalLedger`, `forecastValidation`, `intelligenceProfile.temporalDrift`. |
| 3. Deduplication | `deduplicationEngine.deduplicateSuggestions` | signals[] → fewer | Merges near-duplicates (cluster+pillar+title overlap, or vertical+keyword overlap). "Emerging Markets" fallback never matches itself. Warns if < 8 (DEDUP_COLLAPSE). |
| 4. Ranking | sort by `opportunityScore` desc | — | |
| 5. Diversity | `diversityEngine.applyDiversityProtection` | ranked → `curatedPortfolio` | Soft-threshold saturation penalties (max 3/vertical, 3/pillar, 2/cluster, 4/domain), weak-signal rescue for uncovered verticals. `targetPortfolioSize=20` (so it does NOT trim to 8 — output is whatever survived dedup). |
| 6. Reasoning | `reasoningEngine.runReasoningEngine` | portfolio | Signal relationships + thematic clusters + macro themes. |
| 7. Graph | `intelligenceGraphEngine.buildIntelligenceGraph` | reasoning+portfolio | Nodes (signal/cluster/vertical/pillar) + edges. |
| 8. Propagation | `signalPropagationEngine.runSignalPropagation` | graph | DFS influence paths (depth ≤4) + influence ranking. |
| 9. Forecast | `forecastEngine.runForecastEngine` | portfolio | Momentum/persistence/convergence → Transient/Emerging/Structural/Supercycle clusters. |
| 10. Evolution | `evolutionEngine.evolveIntelligence` | forecast clusters + memory snapshots | Recurrence/persistence/accuracy → trajectory + `intelligenceWeight`. |
| 11. Priority | `priorityEngine.prioritizeIntelligence` | forecast + evolution | Escalation tiers (Background→Critical), urgency, regime-shift, asymmetry. |
| 12. Memory Ingest | `memoryEngine.ingestIntelligenceCycle(memory, curatedPortfolio)` | → new memory | Appends cycle (cap 60), updates themes/recurrences/forecastEvolution. Lifetime counters incremented. |

Returns `IntelligenceState` (see TYPES_REFERENCE.md). `curatedPortfolio` is the headline output.

## Phase 2 — Post-pipeline enrichment (server.ts, after pipeline returns)

All three are **non-fatal** (try/catch), run sequentially on `state.curatedPortfolio`:

1. **`enrichWithTrends`** (`trendsService`) — Google Trends per `marketKeyword`. Sets `trendScore`, `trendDirection`. **Frequently fails on Render** (Google blocks datacenter IPs → returns HTML → `UNKNOWN`). The pipeline is resilient to this.
2. **`enrichWithWhiteSpaceDetection`** (`serpOpportunityDetectionService`) — validates each opportunity keyword against real search results via the **Tavily** SERP provider (`TAVILY_API_KEY`), classifies competing report coverage across organic/title/URL/marketplace/PDF signals, counts distinct competitor domains, and maps to `whiteSpaceStatus`/`Score`/`Label`/`Competitors`/`GapReason` (+ `opportunityClass`/`whiteSpaceSignals`/`whiteSpaceSerpCached`). Thresholds: 0→GREEN(CONFIRMED_GAP), 1–2→YELLOW(PARTIAL_COVERAGE), 3–6→RED crowded, ≥7→RED commoditised. Per-run budget (`SERP_RUN_BUDGET`, default 12) + 7-day file cache (`SERP_CACHE_PATH`) + per-keyword dedup. **Non-fatal**: missing credential / provider failure / budget exhausted → UNKNOWN. Replaced the legacy 4-publisher scraper (deleted). Pure core is fully property-tested (fast-check).
3. **`classifyPortfolio`** (`actionClassificationEngine`) — computes `actionScore` (oppScore + whitespace±30/−20 + trend±20 + window), assigns **PUBLISH NOW / MONITOR / PASS** + reason + urgency, and **sorts** so PUBLISH NOW surfaces first.

Memory is saved to `/tmp` **before** enrichment (memory stores pre-enrichment portfolio — fine, suppression only needs title/vertical/anchor).

## Where key decisions happen (quick index)

- **The ranking number** (`opportunityScore`): `scoringEngine` (Stage 2). Commercial-first, evidence-gated.
- **The verdict** (PUBLISH/MONITOR/PASS): `actionClassificationEngine.computeVerdict` (Phase 2). PUBLISH gate = whitespace-green + `oppScore ≥ 68`.
- **Novelty suppression**: built in `geminiService` from server-disk memory (`recentlySurfaced` = last 15 cycles).
- **Whitespace / trend** influence the verdict via `actionScore`, NOT `opportunityScore`.

## Brief generation (separate endpoint)

`POST /api/intelligence/brief` → `geminiService.generateFullBrief(suggestion)` (`gemini-2.5-pro`, thinkingBudget 8000). Returns a long markdown "Report Commission Document." `POST /api/brief/export-docx` → `briefExportServer.generateBriefDocxBuffer` streams a .docx.
