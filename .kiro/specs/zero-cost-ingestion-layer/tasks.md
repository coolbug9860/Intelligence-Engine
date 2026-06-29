# Implementation Plan

## Overview

This plan implements the Zero-Cost Ingestion Layer as a low-blast-radius sequence: build new, fully isolated modules and their tests first (they touch nothing in the live pipeline), then wire the `server.ts` integration seam, then demote SAM last. The existing pipeline keeps working until the final coordinated wiring steps. No new npm packages, `src/types.ts` and Gemini settings untouched, all keys read by env-var name only.

## Task Dependency Graph

```
1 (DTO + adapter) ──┬─> 2 (keyword gate) ─────────────┐
                    ├─> 3 (TED connector) ─────────────┤
                    ├─> 4 (UK FTS connector) ──────────┤
                    └─> 5 (Federal Register connector) ┴─> 8 (server.ts seam) ─> 8.1 ─> 9 ─> 10
6 (BLS layer) ─> 6.1 (scoring read seam) ─> 6.2                                  ^
7 (SAM demotion) ───────────────────────────────────────────────────────────────┘
```

- Tasks 1, 6, 7 have no dependencies on each other and can start independently.
- Tasks 2–5 depend only on task 1 (the DTO/adapter foundation).
- Task 8 (integration) depends on 2, 3, 4, 5, and 7 (SAM demotion is coordinated within task 8 to avoid broken imports).
- Tasks 9 and 10 are final hygiene/verification and run after 8.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "6", "7"], "dependsOn": [] },
    { "wave": 2, "tasks": ["1.1", "2", "3", "4", "5", "5.2", "6.1"], "dependsOn": ["1", "6"] },
    { "wave": 3, "tasks": ["2.1", "3.1", "4.1", "5.1", "5.3", "6.2"], "dependsOn": ["2", "3", "4", "5", "5.2", "6.1"] },
    { "wave": 4, "tasks": ["8"], "dependsOn": ["2", "3", "4", "5", "5.2", "7"] },
    { "wave": 5, "tasks": ["8.1"], "dependsOn": ["8"] },
    { "wave": 6, "tasks": ["9", "10"], "dependsOn": ["8.1"] }
  ]
}
```

## Tasks

- [x] 1. Foundation: unified DTO and single adapter
  - Create `src/services/ingestion/ingestionTypes.ts` declaring `IngestionRecord` (exactly the 11 fields: `source_system`, `content_type`, `jurisdiction`, `headline`, `abstract`, `source_url`, `full_text_url`, `tracking_timestamp`, `external_id`, `vertical_hint`, `language`), plus `SourceSystem` (includes `'EU_EPO'`) and `ContentType` (includes `'epo_patent'`) unions, as local module types. Do not touch `src/types.ts`.
  - Create `src/services/ingestion/ingestionAdapter.ts` with `ingestionRecordToEdgarSignal(rec)` and batch `adaptRecords(records)` mapping into the existing `EDGARSignal` shape.
  - _Requirements: 6.1, 6.2, 6.3, 6.6, 13.3_

- [x] 1.1 Adapter unit + property tests
  - Add `src/services/ingestion/ingestionAdapter.test.ts` (vitest + fast-check, already present — no new deps).
  - Cover: every field maps to a structurally valid `EDGARSignal`; `vertical_hint` null/unrecognized → `'General'`; `abstract` > 700 chars → `excerpt` truncated to 700; missing required field → error naming the field, no partial signal emitted.
  - _Requirements: 6.3, 6.4, 6.7, 6.8_

- [x] 2. Local zero-LLM keyword gate
  - Create `src/services/ingestion/keywordGate.ts`: 42 precompiled, case-insensitive, word-boundary keywords; pure synchronous `matchRecord(rec)` over the space-joined `headline + abstract`; `enrichFullText(rec)` lazy fetch of `full_text_url` with a 10s timeout, non-fatal (keeps record un-enriched on failure); `runKeywordGateAndEnrich(records)` returning only matched records as an order-preserving subset.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 2.1 Keyword gate tests
  - Add `keywordGate.test.ts`: zero-LLM/no-network purity of `matchRecord`; output is a subset of input with preserved relative order, no added/duplicated records; non-matching record triggers no fetch; enrichment failure/timeout keeps the record un-enriched and continues; empty input → empty output, no throw.
  - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.7_

- [x] 3. EU TED connector
  - Create `src/services/tedService.ts`: native `fetch` against `api.ted.europa.eu` → `IngestionRecord[]` with `source_system: 'EU_TED'`; strict rolling 24h lookback; 24h `/tmp` cache (default path overridable via env); non-fatal on non-OK/network/timeout (warn, return `[]`, leave valid cache intact); skip notices missing required fields.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 9.2_

- [x] 3.1 TED connector tests
  - Add `tedService.test.ts` with mocked HTTP: record mapping shape; cache round-trip (write then read within TTL issues zero network requests); failure path returns `[]` without throwing; lookback window filters out-of-range notices.
  - _Requirements: 2.3, 2.4, 2.5, 9.2_

- [x] 4. UK FTS / Contracts Finder OCDS connector
  - Create `src/services/ukFtsService.ts`: native `fetch` against UK FTS and Contracts Finder OCDS endpoints; single shared OCDS parser; `source_system` set per origin endpoint (`'UK_FTS'` / `'UK_CONTRACTS_FINDER'`); merge both into one `IngestionRecord[]`; 30s per-endpoint timeout; one endpoint failing continues with the other, both failing → `[]`; 24h `/tmp` cache; strict 24h lookback.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 9.3_

- [x] 4.1 UK FTS connector tests
  - Add `ukFtsService.test.ts` with mocked HTTP: per-endpoint `source_system` assignment; merge of both endpoints; single-endpoint-failure continues; both-fail → `[]` no throw; cache miss on absent/invalid JSON; cache round-trip.
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7, 3.8_

- [x] 5. Federal Register connector (SAM watchlist source)
  - Create `src/services/federalRegisterService.ts`: native `fetch` via `api.data.gov` using `DATA_GOV_API_KEY` read by name only; strict 24h lookback; produce `IngestionRecord[]`; extract each distinct referenced federal solicitation/award ID from full-text payloads exactly once to form the SAM watchlist; absent/empty key → warn once, return `[]`, no throw; request failure/non-OK/30s timeout → warn, return `[]`, no throw.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 12.4_

- [x] 5.1 Federal Register connector tests
  - Add `federalRegisterService.test.ts`: record production; distinct-ID extraction (deduped, exactly once); absent-key path returns `[]`; failure/timeout path returns `[]` no throw; lookback filtering.
  - _Requirements: 8.1, 8.3, 8.4, 8.6, 9.1_

- [x] 5.2 EU EPO patent connector (parallel with Tasks 2–5)
  - Create `src/services/epoService.ts`: lean module using the EPO OPS v3.2 API with an OAuth2 client-credentials grant via `EPO_CONSUMER_KEY` / `EPO_CONSUMER_SECRET` (read by name only); strict rolling 24h UTC lookback; 86,400,000 ms `/tmp` cache; produce `IngestionRecord[]` with `source_system: 'EU_EPO'` and `content_type: 'epo_patent'`, carrying the patent `external_id`, `source_url`, and `full_text_url`; absent-credential and request-failure/timeout paths non-fatal (warn, return `[]`, never throw). Respect the OPS weekly free-tier quota as a guardrail.
  - _Requirements: 13.1, 13.2, 13.3, 9.x_

- [x] 5.3 EPO connector tests
  - Add `epoService.test.ts` with mocked HTTP: OAuth2 token acquisition + reuse; record mapping with `content_type: 'epo_patent'`; cache round-trip; absent-credential path returns `[]`; failure/timeout returns `[]` without throwing; lookback filtering.
  - _Requirements: 13.1, 13.2, 13.3_

- [x] 6. Decoupled BLS reference layer
  - Create `src/services/blsReferenceService.ts`: `getBlsReferenceTable()` with daily `/tmp` cache, 10s timeout, last-good (or empty-table) fallback on failure, never throws; `lookupSectorReference(table, vertical)` returns `undefined` when absent; seed `PCU334413334413` → `Semiconductor` and `PCU325412325412` → `Healthcare` with one-to-one keying; exclude invalid/unmapped entries without throwing. Not part of the ingestion fan-out.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 6.1 Scoring engine read seam → ACTIVE sector-dynamism nudge
  - Add an optional, trailing `blsReference?: BlsReferenceTable` argument to `scoringEngine.calculateOpportunityScore`. When a row matches the suggestion's vertical, apply a bounded, boost-only multiplier `1 + min(0.05, |ppiYoyPct| / 200)` (symmetric, capped at +5%) as the final scoring factor; neutral when the table is omitted/undefined or the vertical is absent. Thread the table through the orchestrator, server.ts (`getBlsReferenceTable`), and the search-demand grounding recompute.
  - _Requirements: 4.5, 4.6, 4.7_

- [x] 6.2 BLS + scoring activation tests
  - Add `blsReferenceService.test.ts`: cache TTL/refresh behavior, failure fallback, series→vertical resolution (canonical `Semiconductor` / `Healthcare`). Add `scoringEngine.blsActivation.test.ts` asserting the nudge is neutral when absent/omitted, raises the score on sharp PPI movement, is symmetric on `|ppiYoyPct|`, and is capped at +5%.
  - _Requirements: 4.3, 4.5, 4.6, 10.3_

- [x] 7. SAM.gov demotion (coordinated with server.ts to avoid broken imports)
  - In `src/services/samGovService.ts`: remove `VERTICAL_KEYWORDS`, `verticalForKeyword`, the query-list builder, and the per-cycle cap loop; add `fetchSamNoticeById(noticeId)` (single by-ID request, 10s timeout, empty/whitespace-id guard issuing zero requests, returns `null` on miss/failure/absent key, never throws); keep the `SamSignal` interface and its `SamSignal → EDGARSignal` adapter shape unchanged.
  - CRITICAL: `server.ts` currently imports `{ fetchSamGovSignals, SamSignal }`. Update the `samGovService.ts` export surface and the `server.ts` import in the SAME step (task 8) so the build never breaks between the two edits.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_

- [x] 8. Integration seam in server.ts (final wiring)
  - Replace `Promise.all` with `Promise.allSettled` and add a typed `settledOr<T>(result, fallback, label)` helper (one non-fatal warning on reject, fulfilled value passthrough).
  - Wire TED, UK FTS, Federal Register, and EU EPO into the fan-out; normalize all fulfilled payloads to `IngestionRecord[]`; run `runKeywordGateAndEnrich`; `adaptRecords(...)` and merge into `combinedSignals` (must remain `EDGARSignal[]`, existing EDGAR + SAM signals kept and not reordered).
  - Replace the legacy `fetchSamGovSignals` keyword call with watchlist-ID lookups via `fetchSamNoticeById`, sourced from the Federal Register extraction; update the import accordingly. Leave the `analyzeNews` input contract unchanged.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.6, 6.5, 8.4, 13.4_

- [x] 8.1 Seam integration tests
  - Add an integration test asserting: failure isolation (any subset of sources rejecting still yields the union of fulfilled records, all-reject → empty, no throw); `combinedSignals` stays `EDGARSignal[]` end-to-end; SAM outbound requests per cycle ≤ number of distinct watchlist IDs, and zero when the watchlist is empty.
  - _Requirements: 1.2, 1.6, 5.6, 5.7, 6.5, 6.6_

- [x] 9. Environment and dependency hygiene
  - Add `DATA_GOV_API_KEY`, `SAM_GOV_API_KEY`, `EPO_CONSUMER_KEY`, `EPO_CONSUMER_SECRET`, and any new cache-path/timeout env vars to `.env.example` by NAME only (placeholder values, never real keys). Confirm no new npm package was added and Gemini settings are untouched.
  - _Requirements: 11.2, 11.3, 12.1, 12.2, 12.3, 13.1_

- [x] 10. Final verification and pre-deploy checklist
  - Run `tsc` typecheck and the full `vitest` suite; confirm all new and existing tests pass.
  - Confirm `src/types.ts` and `geminiService.ts` model settings are byte-for-byte unchanged (zero diff) and `package.json` dependencies are unchanged.
  - Pre-Render checklist (verification only, not a deploy action): rotate and set `DATA_GOV_API_KEY` / `SAM_GOV_API_KEY` in the Render dashboard; confirm `/tmp` warm-instance cache assumptions hold; confirm request-triggered (no cron) and $0-cost posture.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2, 12.3_

## Notes

- Tests use the existing `vitest` + `fast-check` setup — no new test dependencies.
- Every connector is non-fatal by construction (warn + empty result, never throw), mirroring the existing `edgarService`/`samGovService` pattern.
- The integration seam (task 8) is the only step that modifies the live pipeline; all prior tasks are additive and isolated.
- Task 10's pre-Render items are verification checks, not automated deploy actions.
