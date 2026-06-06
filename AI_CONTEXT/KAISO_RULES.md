# KAISO_RULES.md — Operating Rules for Future AI Sessions

> READ THIS FIRST. Purpose: let an AI work on this repo with minimal scanning. The other AI_CONTEXT files are the map; this file is the operating manual. If something here conflicts with the code, the code wins — but update this file when you learn something durable.

## 0. Read order
1. This file. 2. `SYSTEM_OVERVIEW.md`. 3. `PIPELINE_MAP.md`. 4. `SERVICES_INDEX.md` / `TYPES_REFERENCE.md` as needed. 5. `CURRENT_ROADMAP.md` for what's in flight.
Don't re-scan the whole repo. Use these docs to jump straight to the right file (see FILE_TREE.md "Where to go for a given task").

## 1. The single most important fact: TWO architectures
- **LIVE pipeline** = `types.ts` (`ReportSuggestion`) + `intelligenceOrchestrator.ts` + `server.ts` + ~22 services.
- **ORPHANED cluster** = `schemaRegistry.ts` + `evidence/evaluation/benchmark/causalInference/recommendation/retrieval/simulation` engines. **NOT imported by anything live. Does not run.** Different type system. Before assuming an engine affects output, confirm it's imported by the orchestrator/server. Names collide across the two systems (see TYPES_REFERENCE.md) — always check import paths.

## 2. Hard facts — do NOT re-derive these
- **Ranking number** = `opportunityScore` (0–100), set in `scoringEngine.calculateOpportunityScore`. Model: `commercialCore × evidenceGate × riskMultipliers`. Commercial-first, evidence is a downward-only gate (0.45–1.0). Whitespace/trend are NOT in it.
- **Verdict** in `actionClassificationEngine`: PUBLISH NOW needs whitespace∈{CONFIRMED_GAP,PARTIAL_COVERAGE} AND `opportunityScore ≥ PUBLISH_SCORE_THRESHOLD (68)`. PASS vetoes: COMMODITISED whitespace, DECLINING trend, score < 45 (PASS_SCORE_FLOOR), or High-risk+Critical-regulatory. Else MONITOR. Trend `UNKNOWN` does NOT block PUBLISH.
- **`actionScore`** = opportunityScore + whitespace(±30/−20) + trend(±20/+5) + window(+10/+5). Used for sort + verdict gating layering, not as the PUBLISH threshold itself.
- **Gemini models:** `gemini-2.5-flash` (analyze), `gemini-2.5-pro` (brief). Analysis thinkingBudget 6144, brief 8000.
- **Gemini returns 8–10**; floor-8 assertion in `analyzeNews` throws (→ returns `[]`) if < 8. Don't assert exactly 10.
- **Feeds:** 54 in `server.ts STABLE_RSS_FEEDS`, all verified fresh as of 2026-06-06. Real ingestion is in `server.ts`, not `rssService.ts` (that's a thin client→/api/rss wrapper).
- **EDGAR** cache: `/tmp/edgar-cache.json` (NOT cwd). Memory: `/tmp/kaiso-memory.json`. Both `/tmp` because Render wipes cwd.
- **Trends** fail ~always on Render (Google blocks datacenter IPs). Expected. Non-fatal. Don't "fix" by retrying — needs a paid endpoint.
- **Whitespace** runs on 2 working publishers (MnM, Mordor); FBI returns 0 titles (treated unreliable), AMR 500s.

## 3. Environment / platform
- OS for dev: **Windows, cmd/PowerShell**. Use `;` not `&&`. Use `node node_modules/...` if a global binary is missing.
- **Must run on a persistent-process host (Render).** NOT Vercel/serverless — pipeline runs minutes, needs persistent process + `/tmp`.
- Local server run reads env from **`.env`** (server's `dotenv.config()` default), NOT `.env.local`. Vite uses `.env.local` for the client, but the client uses no keys.
- `crypto.randomUUID()` is used as a global → needs Node ≥ 19 (pinned `>=20`).

## 4. Build / verify / ship workflow (follow exactly)
1. Make change.
2. `npm run lint` (= `tsc --noEmit`). **Must be exit 0.** This is the only type-check; `npm run build` does NOT type-check.
3. `npm run build` to confirm it bundles (vite + esbuild → `dist/`).
4. Commit with a clear message, then push. Render auto-deploys `main`.
- If `node_modules` is missing, run `npm install` first.
- The 834 KB bundle warning is known/expected (roadmap item), not an error.

## 5. Git rules (this repo)
- Remote: `origin` → `https://github.com/coolbug9860/Intelligence-Engine`. Branch: `main`. Credentials are cached in this environment (pushes work).
- **Do all edits locally and push.** Do NOT edit files on GitHub directly — it splits history (happened once; required `git pull --rebase`). If history ever diverges, `git pull --rebase origin main`, resolve, push.
- Default branch `main` deploys to production on Render. There is no staging. Small, verified commits.
- `.gitignore` already excludes `node_modules`, `dist`, `.env*`, `kaiso-memory.json`, `edgar-cache.json`. Never commit secrets or temp `.mjs` diagnostic scripts (delete them when done).

## 6. Render env vars (must be set in dashboard, not code)
`GEMINI_API_KEY` (req) + `GEMINI_API_KEY_2.._5` (opt), `KAISO_USERNAME`, `KAISO_PASSWORD` (req for login), `ALLOWED_ORIGIN` (optional now — CORS defaults to `RENDER_EXTERNAL_URL`), `NEWS_API_KEY` (opt), `KAISO_AUTH_TOKEN` (opt, keeps logins alive across restarts). Do NOT set `PORT` (Render injects it). SMTP_* reserved for the unbuilt digest feature.

## 7. Editing conventions
- Engines are pure functions `(suggestion|signals) → same` and chained in `intelligenceOrchestrator`. To add a stage, add it there in the right order (normalization before scoring; enrichment is post-pipeline in `server.ts`).
- When you change a threshold/weight, make it a **named const** and update the reason strings that reference the number (e.g. the MONITOR reason text references the publish threshold).
- Post-pipeline order is fixed: trends → whitespace → action classification. `opportunityScore` is final before these; if you want whitespace/trend to affect ranking, do it via `actionScore` or recompute deliberately (and watch for double-counting + freshness loss).
- Keep changes small and isolated; prefer one knob at a time, then validate with a real run (the user runs sessions and pastes logs).

## 8. Common traps (already discovered — don't repeat)
- Don't read `item.pubDate` alone for feed dates → use `isoDate || pubDate`, drop undated/future (the "JUST NOW" bug).
- Don't treat a publisher's 0-titles as "no coverage" → it's a broken scraper (unreliable).
- Don't make PUBLISH require a positive trend → trends are unreliable; only DECLINING should block.
- Don't reintroduce the whitespace ±8 in `scoringEngine` → it runs before enrichment (always undefined there).
- `validationEngine` rules 3/4/5 and `forecastEngine` momentum read fields the prompt never populates — they're inert; don't rely on them without first populating the inputs.
- `response.text` from `@google/genai` is a getter; keep the `response as any` guard or `tsc` breaks.

## 9. How to validate a change without guessing
Ask the user to run a session and paste: the opportunities list (titles + score + confidence + verdict + whitespace/trend badges) and the server log lines (`[Gemini] Parsed N`, `[WhiteSpace] …`, `[Action] Classification complete — X PUBLISH NOW…`). Calibrate thresholds/weights against that real distribution, not assumptions.

## 10. Keep this layer current
After any structural change (new stage, new feed set, threshold change, wiring an orphan engine, new endpoint), update the relevant AI_CONTEXT file in the same commit. This folder is only valuable if it stays true to the code.

## 11. Generic steering files — precedence (react/frontend/typescript/security/performance)
The workspace has `inclusion: fileMatch` steering files (`react-best-practices`, `frontend-standards`, `typescript-guidelines`, `security-headers`, `performance-optimization`). They load on `.ts/.tsx` (etc.) edits and prescribe a DIFFERENT stack than Kaiso uses (Next.js/RSC, Zustand, React Hook Form+Zod, TanStack Query, CSS Modules, Storybook, Python/Go/Redis/SQL) and a stricter `tsconfig` than this repo runs.
- Treat them as **optional references, not mandates**. On any conflict, **Kaiso's actual stack + `tsconfig` + this file win.**
- Do NOT "upgrade" Kaiso to satisfy them: no Next.js migration, no enabling `strict`/`noUnusedLocals` (would flag existing code), no Zustand/RHF/TanStack/CSS-Modules additions, unless explicitly requested for a real feature.
- The only genuinely stack-relevant ideas worth adopting as real tasks: `helmet` + CSP on `server.ts`, and frontend bundle splitting (already in CURRENT_ROADMAP.md). `karpathy-coding` steering DOES apply always.
