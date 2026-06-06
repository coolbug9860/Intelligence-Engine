# KAISO Intelligence OS — System Overview

> Long-term AI memory layer. Built from direct inspection of the codebase (not the marketing docs). Last verified: 2026-06-06.

## What this product is

Kaiso is a B2B syndicated market-research firm. This app is an **intelligence engine that automates the report-pipeline decision**: it ingests signals (SEC EDGAR filings + RSS/news), and decides which niche market topics have enough commercial demand, regulatory momentum, and buyer urgency to justify publishing a **$3,000–$5,000 syndicated research report**.

The output of one run is a ranked set of **~8–10 report-title opportunities**, each scored and stamped with a commissioning verdict: **PUBLISH NOW / MONITOR / PASS**.

Real commissioning happens **weekly** (commission 1–2 reports). Daily runs mainly keep the novelty-suppression memory fed so the same opportunities don't resurface.

## Tech stack (verified)

- **Frontend:** React 19 + TypeScript, Tailwind v4, Vite 6, Motion, lucide-react, d3. SPA with two pages routed by `?page=opportunity` query param (`src/main.tsx`).
- **Backend:** Node + Express (`server.ts`), bundled with esbuild to `dist/server.cjs`.
- **AI:** Google Gemini via `@google/genai`. `gemini-2.5-flash` for analysis, `gemini-2.5-pro` for brief generation. Multi-key rotation (up to 5 keys).
- **Ingestion:** SEC EDGAR full-text search + RSS (`rss-parser`) + optional NewsAPI.
- **Persistence:** `/tmp` JSON files on the server (memory + EDGAR cache); `localStorage` on the client (watchlist, display memory, selected opportunity).
- **Hosting:** Render (Web Service, persistent process). Auto-deploys on push to GitHub `main`. Repo: `coolbug9860/Intelligence-Engine`. Live URL: `https://intelligence-engine.onrender.com`.

> ⚠️ This app is **NOT** serverless-compatible (Vercel/Lambda). The pipeline runs for minutes (server timeout 10 min), relies on a persistent process for in-memory caches + key-rotation state, and uses `/tmp` persistence. It must run on a persistent-process host (Render/Railway/Fly).

## Two architectures live in this repo (critical)

1. **THE LIVE PIPELINE** — everything actually executed. Built on `src/types.ts` (`ReportSuggestion`). Orchestrated by `src/services/intelligenceOrchestrator.ts`, driven by `server.ts`. ~22 of the 30 service files.

2. **THE ORPHANED ONTOLOGY CLUSTER** — `src/services/schemaRegistry.ts` ("Canonical Ontology v2.0.0") plus 7 engines that import it: `evidenceEngine`, `evaluationEngine`, `benchmarkEngine`, `causalInferenceEngine`, `recommendationEngine`, `retrievalEngine`, `simulationEngine`. **None of these are imported by the orchestrator, server, App, or components.** They are scaffolding for a future RAG/agentic architecture and do **not** run. They use a different type system than the live pipeline (see TYPES_REFERENCE.md → naming collisions). Do not assume they affect output.

## High-level flow (see PIPELINE_MAP.md for detail)

```
Client "START RESEARCH"
  → POST /api/intelligence/run (server.ts)
    → ingest RSS (54 feeds) + NewsAPI  +  EDGAR (parallel)
    → runIntelligencePipeline (orchestrator, 12 stages)
        Gemini analyzeNews → normalize → score → dedup → diversity
        → reasoning → graph → propagation → forecast → evolution
        → priority → memory ingest
    → enrichWithTrends → enrichWithWhiteSpaceDetection → classifyPortfolio
  → returns IntelligenceState (curatedPortfolio is the headline output)
```

## The scoring model in one paragraph (current, post-redesign)

`opportunityScore = commercialCore × evidenceGate × riskMultipliers`. **Commercial viability drives the ranking** (buyer willingness, quantifiability, SEO/search demand, segmentability, CAGR, competitive density). **Evidence is a downward-only gate** (confidence + source credibility, range 0.45–1.0) — it cannot lift a commercially weak idea. The action verdict then layers whitespace + trend on top: **PUBLISH NOW** needs whitespace-green + `opportunityScore ≥ 68`; **PASS** is vetoed by COMMODITISED whitespace, DECLINING trend, score < 45, or High-risk+Critical-regulatory. See KAISO_RULES.md for exact constants.

## Auth & security posture

- Login: `POST /api/auth` with `KAISO_USERNAME`/`KAISO_PASSWORD` (env). Returns a single per-process shared token (not JWT, not per-user). Set `KAISO_AUTH_TOKEN` env to keep tokens stable across restarts.
- All `/api/*` routes (except `/api/auth`) require `Authorization: Bearer <token>`.
- CORS allowlist defaults to `RENDER_EXTERNAL_URL` (+ optional comma-separated `ALLOWED_ORIGIN`). Keys live server-side only; never in the client bundle.
- Rate limits: 60/min general, 10/min on `/api/intelligence/*`.
