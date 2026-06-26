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

1. **Google Trends reliability** — **ON HOLD (2026-06-27).** Parked pending a from-scratch rethink of the trend-signal approach or a better data source. Currently ~100% UNKNOWN on Render datacenter IPs. The pipeline is already resilient to this (UNKNOWN never blocks PUBLISH NOW; only a confirmed DECLINING trend vetoes), so there's no urgency. Options to weigh later: paid endpoint (SerpApi / DataForSEO), a different signal entirely, or dropping trend input. Do NOT start until a direction is chosen.

## Action needed from operator (config, not code)
- **Set `TAVILY_API_KEY`** (Render env + local `.env`). Without it, competitor white-space detection returns UNKNOWN for every opportunity. Free tier: 1,000 searches/month, no card. This — not any scraper — is why whitespace coverage looks degraded.
- **(Optional) re-tune `PUBLISH_SCORE_THRESHOLD`** — now env-overridable (default 68). After a few production runs, if the PUBLISH NOW count drifts from the intended ~4–5 top slate, nudge the env var instead of editing code.

> **Done:** Orphaned ontology cluster REMOVED (2026-06-27). Deleted `schemaRegistry` + the 7 engines (`evidence`/`evaluation`/`benchmark`/`causalInference`/`recommendation`/`retrieval`/`simulation`) and the dead `NexusGraph`/`GlobalHeatmap`/`MapChart` components — 11 files, all unreferenced by the live path. AI_CONTEXT docs + the `concept-two-architectures` KB entry updated. `tsc` green. (`d3` is now an unused dependency — safe to drop from package.json in a future pass.)

> **Done:** "FBI/AMR scraper repair" was STALE (2026-06-27). The legacy four-publisher scrape was already replaced by `serpOpportunityDetectionService` (Tavily SERP). No scraper code exists to repair — the real fix is configuring `TAVILY_API_KEY` (see Action needed above). Documented the key + `SERP_*` tunables in `.env.example`.

> **Done:** Threshold made env-overridable (2026-06-27). `PUBLISH_SCORE_THRESHOLD` in `actionClassificationEngine` now reads from env (default 68). Value re-validation still needs production score distributions — see Action needed above.

> **Done:** Frontend bundle splitting (2026-06-27). Added `manualChunks` vendor split (react-vendor / motion / icons / vendor) + lazy-loaded the DocumentationView and HelpPanel modals. Main app chunk 877 KB → 200 KB; Render's >500 KB warning cleared.

> **Dropped:** Weekly digest email (Nodemailer / SMTP) — descoped 2026-06-26. SMTP_*/DIGEST_RECIPIENT env reservations retired.

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
