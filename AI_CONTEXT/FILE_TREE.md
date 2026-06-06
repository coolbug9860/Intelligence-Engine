# KAISO File Tree (Architecture View)

> Annotated, architecture-focused. Not every file — the ones that matter and what they do. ✅ = hot path you'll touch often. ⚫ = orphaned (not in live execution).

```
Kaiso-Intelligence-OS/
├── server.ts ✅                  Express backend. THE backend entry point.
│                                 - STABLE_RSS_FEEDS (54) + SOURCE_NAME_OVERRIDES
│                                 - RSS/NewsAPI ingestion (+ future-date/undated filter)
│                                 - /api/auth, /api/rss, /api/intelligence/run, /api/intelligence/brief,
│                                   /api/brief/export-docx, static dist serving
│                                 - CORS allowlist, rate limits, /tmp memory persistence
│                                 - Post-pipeline: trends → whitespace → action classification
│
├── package.json                  scripts: dev (tsx server.ts), build (vite + esbuild server),
│                                 start (node dist/server.cjs), lint (tsc --noEmit). engines: node >=20.
├── vite.config.ts                React + Tailwind. NO define block (keys stay server-side).
├── tsconfig.json                 noEmit, bundler resolution, allowJs.
├── .env.example                  GEMINI_API_KEY(_2.._5), NEWS_API_KEY, KAISO_USERNAME/PASSWORD, SMTP_*
├── index.html                    SPA shell.
│
├── AI_CONTEXT/                   ← THIS folder. Long-term AI memory layer.
│   ├── SYSTEM_OVERVIEW.md         what/why/stack/two-architectures
│   ├── PIPELINE_MAP.md            full execution flow (read this first for "how a run works")
│   ├── SERVICES_INDEX.md          every service: purpose/inputs/outputs/deps/wired
│   ├── TYPES_REFERENCE.md         ReportSuggestion lifecycle + ontology collisions
│   ├── CURRENT_ROADMAP.md         shipped / open / known issues
│   ├── FILE_TREE.md               this file
│   └── KAISO_RULES.md             rules for future AI sessions (READ FIRST)
│
└── src/
    ├── main.tsx                  Routes: ?page=opportunity → OpportunityDetail, else App.
    ├── App.tsx ✅                 Main dashboard. Auth, loadSignals(), localStorage memory/watchlist,
    │                             signal feed (left), opportunity grid (right), filters, formatRelativeTime.
    ├── types.ts ✅                LIVE type system. ReportSuggestion is the central object. (TYPES_REFERENCE.md)
    ├── index.css                 Tailwind + brand tokens (navy/brand-red/etc).
    │
    ├── pages/
    │   └── OpportunityDetail.tsx  Detail view (opened in new tab). Reads 'kaiso_opportunity' from
    │                             localStorage. Brief generation + DOCX/image export. Zone-0 verdict banner.
    │
    ├── components/               Presentational (dashboard + detail). Heavy ones flagged for lazy-load.
    │   ├── ExecutiveIntelligenceView.tsx   "EXECUTIVE" grid mode
    │   ├── StrategicTelemetryFeed.tsx      loading/telemetry animation
    │   ├── IntelligenceGraphAssembly.tsx   analysis loading animation
    │   ├── CausalPathTrace.tsx             detail: causal chain viz
    │   ├── MarketStressTest.tsx            detail: stress scenarios
    │   ├── EvidenceDossier.tsx             detail: evidence sources
    │   ├── IntelligenceEvolution.tsx       detail: 30d trajectory
    │   ├── IntelligenceProfile.tsx         detail: confidence model
    │   ├── ExportDossier.tsx               detail: image/canvas export
    │   ├── LoginScreen.tsx                 auth gate
    │   ├── DocumentationView.tsx ⬚         in-app docs (lazy-load candidate, large)
    │   ├── GlobalHeatmap.tsx ⬚             (lazy-load candidate, large)
    │   ├── NexusGraph.tsx ⬚                (lazy-load candidate, large)
    │   └── MapChart.tsx                    geo viz
    │
    └── services/                 ALL business logic. 30 files. Full detail in SERVICES_INDEX.md.
        │
        │  ── LIVE PIPELINE (orchestrated) ──
        ├── intelligenceOrchestrator.ts ✅   runIntelligencePipeline — the 12-stage conductor
        ├── geminiService.ts ✅              analyzeNews + generateFullBrief + prompt + key rotation
        ├── sourceAuthorityEngine.ts ✅      credibilityScore (EDGAR-aware)
        ├── validationEngine.ts             confidence clipping
        ├── taxonomyEngine.ts               canonical field mapping
        ├── scoringEngine.ts ✅              opportunityScore (commercial-first) — THE ranking number
        ├── freshnessEngine.ts              time-decay
        ├── temporalIntelligenceEngine.ts   signal ledger / drift
        ├── deduplicationEngine.ts          dedup
        ├── diversityEngine.ts              portfolio diversity
        ├── reasoningEngine.ts              relationships/clusters
        ├── intelligenceGraphEngine.ts      graph nodes/edges
        ├── signalPropagationEngine.ts      influence propagation
        ├── forecastEngine.ts               trajectory classification
        ├── evolutionEngine.ts              historical calibration
        ├── priorityEngine.ts               escalation tiers
        ├── memoryEngine.ts ✅               longitudinal memory + novelty source
        │
        │  ── LIVE: ingestion / post-pipeline / export ──
        ├── edgarService.ts 🟠               SEC EDGAR fetch (+ /tmp cache)
        ├── rssService.ts 🟠                 client → /api/rss
        ├── trendsService.ts 🔵              Google Trends enrichment (often UNKNOWN on Render)
        ├── competitorWhitespaceService.ts 🔵 publisher gap scan (2 of 4 working)
        ├── actionClassificationEngine.ts ✅  PUBLISH/MONITOR/PASS verdict (threshold 68)
        ├── briefExportServer.ts 🟠          DOCX export
        │
        │  ── ⚫ ORPHANED ONTOLOGY CLUSTER (not wired) ──
        ├── schemaRegistry.ts ⚫             canonical ontology v2.0.0 (separate type system)
        ├── evidenceEngine.ts ⚫
        ├── evaluationEngine.ts ⚫
        ├── benchmarkEngine.ts ⚫
        ├── causalInferenceEngine.ts ⚫
        ├── recommendationEngine.ts ⚫
        ├── retrievalEngine.ts ⚫
        └── simulationEngine.ts ⚫
```

## Where to go for a given task
- **Change what ranks / the score** → `scoringEngine.ts` (+ `sourceAuthorityEngine.ts` for the gate).
- **Change the verdict / thresholds** → `actionClassificationEngine.ts`.
- **Change the prompt / Gemini behavior** → `geminiService.ts`.
- **Add/fix a data feed** → `server.ts` (`STABLE_RSS_FEEDS`) or `edgarService.ts`.
- **Change pipeline order / add a stage** → `intelligenceOrchestrator.ts`.
- **Whitespace / trends** → `competitorWhitespaceService.ts` / `trendsService.ts`.
- **Frontend dashboard** → `App.tsx`; **detail page** → `pages/OpportunityDetail.tsx`.
- **API routes / auth / CORS / caching** → `server.ts`.
