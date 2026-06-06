# KAISO Current Roadmap & State

> Snapshot of what's shipped, what's open, and known issues. Last updated: 2026-06-06.

## Recently shipped (verified in code + deployed)

**Scoring & verdict redesign (the big one):**
- `opportunityScore` now **commercial-first, evidence-gated** (`scoringEngine`): `commercialCore × evidenceGate × risk`. Commercial sub-scores drive ranking; evidence is a downward-only gate.
- Commercial sub-scores + `thematicCluster` are now **schema-`required`** in the Gemini response.
- **SEC/EDGAR recognized as high-authority** in `sourceAuthorityEngine` (10-K/Q=92, 8-K/EX-99=82). This broke the old "confidence halo" and let commercial value separate the field.
- **PUBLISH NOW threshold raised 62 → 68** (`PUBLISH_SCORE_THRESHOLD` in actionClassificationEngine) for selectivity. PASS floor = 45.
- Dead whitespace ±8 block removed from scoringEngine (it never fired pre-enrichment).

**Action / trend logic:**
- PUBLISH NOW no longer requires a positive trend; only a confirmed **DECLINING** trend blocks (it's already a PASS veto). Rationale: Google Trends fails most runs on Render, and demoting on `UNKNOWN` was hiding good gaps.

**Whitespace:**
- Match threshold 0.55 → **0.40**, and now matches competitor titles against **both** the report title and the cleaned market keyword.
- A publisher returning **0 parseable titles is treated as unreliable** (not a clean "no coverage" vote) — stops false CONFIRMED_GAP inflation.

**Prompt quality:**
- Dynamic forecast years (no more hardcoded "2025-2034").
- Mandatory **grounding / anti-fabrication** rule.
- Fixed the EDGAR-vs-convergence ranking contradiction; commercial viability declared the primary ranking axis.
- Quantity reframe: target 10, floor 8, **no padding with recycled themes** (was undermining novelty).
- **Scoring discipline** block: independent full-range 1–10 scoring + anti-halo + calibration example. Analysis `thinkingBudget` 2048 → 6144.

**RSS / data integrity:**
- Fixed the **"JUST NOW" bug**: future-dated/undated feed items were stamped fresh and pinned to top. Now prefer `isoDate`, drop undated, reject future-dated (+1h tolerance).
- **Feed list re-audited: 68 → 54**, all live-verified fresh. Removed 24 dead + 2 stale + 2 undated; added 14 Industry Dive + Electrek feeds. Restored Automotive/BFSI/Construction/Retail coverage.

**Infra / housekeeping:**
- EDGAR cache moved to `/tmp` (was `process.cwd()`, wiped on Render).
- Memory cycles capped at 60; lifetime counters fixed.
- CORS hardened to default to `RENDER_EXTERNAL_URL`.
- Node pinned `>=20`; package renamed `kaiso-intelligence-os`.
- Pre-existing `tsc` errors in briefExportServer (docx `PageNumber`/`Table`) and geminiService (`response.text` getter) fixed — `npm run lint` is green.

## Open / next (priority order)

1. **FBI + Allied Market Research scraper repair** — whitespace currently runs on only 2 of 4 publishers (FBI returns 0 titles = JS-rendered; AMR returns HTTP 500). Either fix scraping (needs headless render / different endpoint) or replace publishers. The 0-titles guard prevents false confidence, but coverage is degraded.
2. **Threshold re-validation** — 68 was set from one real run's distribution. Re-check after a few runs; nudge if PUBLISH NOW count drifts.
3. **Google Trends reliability** — blocked on Render datacenter IPs (~100% UNKNOWN). Pipeline is resilient, but if trend signal matters, swap `google-trends-api` for a paid endpoint (SerpApi / DataForSEO) in `trendsService`.
4. **Weekly digest email** — Nodemailer endpoint, top-3 PUBLISH NOW. Env already reserved: `SMTP_HOST/PORT/USER/PASS`, `DIGEST_RECIPIENT`.
5. **Frontend bundle splitting** — main JS bundle ~834 KB (Render warns). Lazy-load heavy views (GlobalHeatmap, NexusGraph, DocumentationView).
6. **Decision on the orphaned ontology cluster** — `schemaRegistry` + 7 engines (~8 files) are dead weight. Either wire them into a future RAG/agentic layer or remove. They add build size + confusion (naming collisions).

## Known issues / non-fatal quirks
- `validationEngine` Rule 5 (temporal drift) is a no-op; Rules 3/4 read fields the prompt never populates.
- `forecastEngine` momentum reads `nexusArticlesCount` (never populated).
- `diversityEngine` `targetPortfolioSize=20` → it does not trim to 8; output size = whatever survives dedup. `weakSignalReservedSlots`/`primarySlots` unused.
- Aviation Week feed is mostly forward-dated event content → contributes little after the future-date filter (kept, harmless).
- `generateFullBrief` returns markdown text, though `IntelligenceBrief` interface exists (unused for that return).

## Verification commands
- Type-check: `npm run lint` (= `tsc --noEmit`). **Must be green before any push.**
- Build: `npm run build` (vite + esbuild). Build does NOT type-check (esbuild strips types).
- Local run needs keys in `.env` (NOT `.env.local` — server uses `dotenv.config()` default).
