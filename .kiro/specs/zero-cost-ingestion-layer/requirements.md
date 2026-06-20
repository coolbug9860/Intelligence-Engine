# Requirements Document

## Introduction

The Zero-Cost Ingestion Layer widens the existing external-signal funnel (RSS + EDGAR + SAM.gov) inside the single request-triggered pipeline in `server.ts` (the `POST /api/intelligence/run` handler). It adds native EU TED and UK FTS / Contracts Finder procurement feeds, a Federal Register connector (the origin of SAM watchlist notice IDs), a decoupled BLS macroeconomic reference layer, and a local zero-LLM keyword gate.

Every new source normalizes into ONE DTO (`IngestionRecord`), passes a local 42-keyword gate, is lazily enriched only on a match, then collapses through a single adapter back into the existing `EDGARSignal` seam so every downstream stage stays unchanged. The overriding constraint is **$0/month infrastructure cost**: only free-tier or official public APIs, no new npm packages (native `fetch`/`fs`/`path` only), and no background crons. The Gemini runtime stays locked at `gemini-2.5-flash` via `@google/genai` and `src/types.ts` is not modified.

These requirements are derived from and remain consistent with the approved `design.md`. Each requirement traces to the design's components and its seven correctness properties.

## Glossary

- **Zero_Cost_Ingestion_Layer**: The complete request-triggered ingestion subsystem inside `server.ts` plus the new connector, gate, and adapter modules under `src/services/`.
- **Orchestrator**: The fan-out logic in the `POST /api/intelligence/run` handler that fires all source connectors concurrently and merges their results.
- **IngestionRecord**: The single normalized DTO every source maps into. It has exactly 11 fields: `source_system`, `content_type`, `jurisdiction`, `headline`, `abstract`, `source_url`, `full_text_url`, `tracking_timestamp`, `external_id`, `vertical_hint`, `language`. Declared in `src/services/ingestion/ingestionTypes.ts` as a local module type, never in `src/types.ts`.
- **EDGARSignal seam**: The pre-existing `EDGARSignal` interface (defined in `src/types.ts`) that Stage 1 (`analyzeNews`) consumes. It is the single integration point ("seam") through which all new records re-enter the pipeline; `combinedSignals` remains typed `EDGARSignal[]`.
- **Ingestion_Adapter**: The single function `ingestionRecordToEdgarSignal` (and batch helper `adaptRecords`) that maps an `IngestionRecord` onto an `EDGARSignal`.
- **settledOr**: The typed helper that unwraps a `PromiseSettledResult`, returning the fulfilled value or a typed fallback (and a non-fatal warning) when the source rejected.
- **lazy fetching**: Deferring the heavy `full_text_url` HTTP fetch until AFTER a record passes the keyword gate, so only matched records incur enrichment cost.
- **Keyword_Gate**: The pure, synchronous, zero-LLM predicate (`matchRecord`) in `keywordGate.ts` that tests `headline + abstract` against 42 precompiled keywords.
- **OCDS**: Open Contracting Data Standard — the release-package JSON format exposed by both UK FTS (Find a Tender) and Contracts Finder, parsed by a single shared parser.
- **PPI reference table**: The daily-refreshed, `/tmp`-cached static `BlsReferenceTable` (`Record<vertical, BlsSectorReference>`) of Producer Price Index and wage-pressure weights, read read-only by `scoringEngine`.
- **SAM watchlist**: The set of SAM.gov `noticeId` values to fetch surgically via `fetchSamNoticeById`. These IDs are NOT obtained by keyword sweep; they are extracted dynamically from Federal Register (Module 1) full-text payloads.
- **Federal_Register_Connector**: The Module 1 connector that fetches U.S. regulatory notices via `api.data.gov` (using `DATA_GOV_API_KEY`), produces `IngestionRecord[]`, and is the origin of SAM watchlist notice IDs.
- **TED_Connector**: `tedService.ts` — native `fetch` to the EU TED API producing `IngestionRecord[]`.
- **UK_FTS_Connector**: `ukFtsService.ts` — native `fetch` to UK FTS + Contracts Finder OCDS endpoints producing `IngestionRecord[]`.
- **SAM_Connector**: The demoted `samGovService.ts` exposing only `fetchSamNoticeById(noticeId)`.
- **EPO_Connector**: `epoService.ts` — native `fetch` to the EPO OPS v3.2 API (OAuth2 client-credentials) producing `IngestionRecord[]` with `content_type: 'epo_patent'`.
- **SamSignal_to_EDGARSignal_adapter**: The existing server-side adapter that maps a `SamSignal` onto an `EDGARSignal`, preserving the SAM seam.

## Requirements

### Requirement 1: In-Process Orchestration with Failure Isolation

**User Story:** As a platform operator, I want every ingestion source to run concurrently with per-source failure isolation, so that one failing feed can never abort an entire intelligence run.

#### Acceptance Criteria

1. WHEN the `POST /api/intelligence/run` handler triggers ingestion, THE Orchestrator SHALL start every source connector (RSS, EDGAR, TED, and UK-FTS) within a single `Promise.allSettled` fan-out before awaiting any connector result, so that all connectors execute concurrently.
2. IF one or more source connectors reject, THEN THE Orchestrator SHALL return the union of the records produced by every fulfilled connector and SHALL exclude the records of every rejected connector.
3. WHEN a settled result has status `rejected`, THE settledOr helper SHALL return the supplied typed fallback value (an empty collection of that connector's record type) and SHALL emit exactly one non-fatal warning that identifies the rejected source by its label, without re-throwing.
4. WHEN a settled result has status `fulfilled`, THE settledOr helper SHALL return the fulfilled value unchanged and SHALL NOT emit a warning.
5. THE Orchestrator SHALL complete the ingestion batch without throwing for any subset of rejected sources.
6. WHEN every source connector rejects, THE Orchestrator SHALL return an empty record union (zero records) and SHALL continue the ingestion run without throwing.

### Requirement 2: Native EU TED Procurement Connector

**User Story:** As an intelligence analyst, I want EU TED contract notices ingested directly from the official API, so that European procurement signals enter the pipeline at zero cost without Apify.

#### Acceptance Criteria

1. THE TED_Connector SHALL retrieve EU TED notices using the native `fetch` API against `api.ted.europa.eu` and SHALL NOT invoke Apify or any third-party scraping service.
2. WHEN TED notices are retrieved, THE TED_Connector SHALL map each notice into an `IngestionRecord` with `source_system` set to `'EU_TED'`.
3. IF a retrieved TED notice is missing the fields required to construct a complete `IngestionRecord`, THEN THE TED_Connector SHALL skip that notice, emit a warning identifying the skipped notice, and continue mapping the remaining notices.
4. IF a TED request returns a non-OK HTTP response, or a network or timeout error occurs, THEN THE TED_Connector SHALL emit a warning indicating the failure, return an empty array, refrain from throwing, and leave any existing valid cache file unmodified.
5. WHEN a cache file exists at the configured TED `/tmp` cache path (default path, overridable via the TED cache-path environment variable), is readable and parseable, and its stored ISO timestamp is less than 24 hours (86,400,000 milliseconds) old as measured from the current time, THE TED_Connector SHALL return the cached records and SHALL issue zero network requests.
6. WHEN fresh TED records are successfully fetched, THE TED_Connector SHALL write those records to the configured `/tmp` cache path together with the current time as an ISO timestamp.
7. IF writing the TED cache file fails, THEN THE TED_Connector SHALL emit a warning, return the freshly fetched records, and refrain from throwing.

### Requirement 3: Native UK FTS / Contracts Finder OCDS Connector

**User Story:** As an intelligence analyst, I want UK Find a Tender and Contracts Finder notices ingested via their OCDS feeds, so that UK procurement signals enter the pipeline at zero cost without Apify.

#### Acceptance Criteria

1. THE UK_FTS_Connector SHALL fetch OCDS release packages using the native `fetch` API against the UK FTS and Contracts Finder endpoints and SHALL NOT invoke Apify or any third-party scraping service.
2. WHEN OCDS release packages are retrieved, THE UK_FTS_Connector SHALL parse each release with a single shared OCDS parser and map it into an `IngestionRecord`, setting `source_system` to `'UK_FTS'` for Find a Tender releases and `'UK_CONTRACTS_FINDER'` for Contracts Finder releases according to the origin endpoint.
3. WHEN both UK endpoints return data, THE UK_FTS_Connector SHALL return the merged set of all successfully mapped `IngestionRecord` values from both endpoints.
4. IF one UK endpoint request returns a non-OK response, a network error occurs, or the request does not complete within 10 seconds (configurable via the UK FTS request-timeout environment variable), THEN THE UK_FTS_Connector SHALL emit a warning identifying the failed endpoint and continue with the remaining endpoint.
5. IF both UK endpoint requests fail, THEN THE UK_FTS_Connector SHALL return an empty array and SHALL NOT throw.
6. WHEN a cache file exists at the configured UK FTS `/tmp` cache path (default `/tmp/ukfts-cache.json`, overridable via the UK FTS cache-path environment variable), is readable and parseable, and its stored ISO timestamp is less than 24 hours (86,400,000 milliseconds) old, THE UK_FTS_Connector SHALL return the cached records and SHALL issue zero network requests.
7. IF the UK FTS cache file is absent, unreadable, or contains invalid JSON, THEN THE UK_FTS_Connector SHALL treat it as a cache miss and fetch fresh records.
8. WHEN fresh UK records are successfully fetched, THE UK_FTS_Connector SHALL write them to the configured `/tmp` cache path together with the current time as an ISO timestamp; IF the cache write fails, THEN THE UK_FTS_Connector SHALL emit a warning, return the freshly fetched records, and refrain from throwing.

### Requirement 4: Decoupled BLS Reference Layer

**User Story:** As a scoring maintainer, I want BLS macroeconomic data held as a daily static reference table read read-only by the scoring engine, so that macro context is available later without altering current scoring behavior or joining the ingestion race.

#### Acceptance Criteria

1. THE BLS_Reference_Service SHALL expose `getBlsReferenceTable` returning a `BlsReferenceTable`, and SHALL NOT be included in the `Promise.allSettled` ingestion fan-out.
2. WHEN the cached BLS reference table is older than 24 hours measured from its last successful write timestamp, THE BLS_Reference_Service SHALL request a refresh from `api.bls.gov` using a network timeout of 10 seconds and, on a successful response, SHALL overwrite the `/tmp` cache with the retrieved table.
3. WHILE the cached BLS reference table is 24 hours old or younger measured from its last successful write timestamp, THE BLS_Reference_Service SHALL return the cached table without issuing a network request.
4. IF a BLS refresh request fails or exceeds the 10-second timeout, THEN THE BLS_Reference_Service SHALL return the last successfully cached table, or a `BlsReferenceTable` containing zero entries when no cache exists, and SHALL NOT throw or propagate an error to the caller.
5. WHEN `lookupSectorReference` is called with a vertical that is absent from the table, THE BLS_Reference_Service SHALL return `undefined`.
6. WHERE the optional `blsReference` argument to `calculateOpportunityScore` is `undefined` or the requested vertical is absent from the table, THE scoringEngine SHALL return a `ReportSuggestion` deep-equal to the one it returns for identical `suggestion` and `calibration` inputs when the `blsReference` argument is omitted.
7. THE scoringEngine SHALL retain the existing `calculateOpportunityScore(suggestion, calibration?)` signature and scoring math, accepting `blsReference` only as an optional trailing argument that is never read by the scoring computation, so all existing call sites remain unchanged.

### Requirement 5: Precision SAM.gov Demotion

**User Story:** As a platform operator, I want SAM.gov reduced to surgical single-notice lookups, so that the ~10 requests/day public limit is protected while the existing SAM adapter seam is preserved.

#### Acceptance Criteria

1. THE SAM_Connector SHALL remove the `VERTICAL_KEYWORDS` mass-query loop, the `verticalForKeyword` reverse lookup, the query-list builder, and the per-cycle cap loop.
2. WHEN `fetchSamNoticeById(noticeId)` is called with a non-empty notice ID, THE SAM_Connector SHALL issue at most one request to the SAM.gov by-ID endpoint for that notice ID.
3. IF `fetchSamNoticeById` is called with a null, empty, or whitespace-only notice ID, THEN THE SAM_Connector SHALL issue zero requests and return `null`.
4. IF the requested notice is not found, the request returns a non-OK response, the request does not complete within 10 seconds, or `SAM_GOV_API_KEY` is absent, THEN THE SAM_Connector SHALL emit a non-fatal warning, return `null`, and SHALL NOT throw.
5. WHEN a notice is successfully fetched, THE SAM_Connector SHALL return a `SamSignal` populated with its 8 fields (`title`, `noticeType`, `agency`, `postedDate`, `excerpt`, `url`, `vertical`, `matchedKeyword`), with `excerpt` bounded to at most 700 characters and no undefined fields.
6. THE SamSignal_to_EDGARSignal_adapter SHALL remain unchanged in shape so SAM signals continue entering the `EDGARSignal` seam.
7. THE Zero_Cost_Ingestion_Layer SHALL issue at most one SAM.gov request per distinct watchlist notice ID per ingestion cycle, and SHALL issue zero SAM.gov requests when the watchlist is empty.

### Requirement 6: Unified IngestionRecord DTO and Single Adapter

**User Story:** As a system architect, I want every source normalized into one DTO that collapses through a single adapter into the existing seam, so that the downstream pipeline contract requires zero changes.

#### Acceptance Criteria

1. THE Zero_Cost_Ingestion_Layer SHALL define `IngestionRecord` with exactly these 11 fields and no others: `source_system`, `content_type`, `jurisdiction`, `headline`, `abstract`, `source_url`, `full_text_url`, `tracking_timestamp`, `external_id`, `vertical_hint`, `language`; `vertical_hint` MAY be `null` and the other 10 fields SHALL be non-null with string fields non-empty.
2. THE Zero_Cost_Ingestion_Layer SHALL declare `IngestionRecord`, `SourceSystem`, and `ContentType` in `src/services/ingestion/ingestionTypes.ts` as local module types and SHALL NOT add, remove, or alter any declaration in `src/types.ts`.
3. WHEN `ingestionRecordToEdgarSignal` receives a complete `IngestionRecord`, THE Ingestion_Adapter SHALL return a structurally valid `EDGARSignal` with every field populated non-null and non-empty.
4. WHEN an `IngestionRecord` has a `vertical_hint` of `null` or a value not recognized as a Kaiso vertical, THE Ingestion_Adapter SHALL set the resulting `EDGARSignal.vertical` to `'General'`; otherwise it SHALL use the matched vertical.
5. THE Orchestrator SHALL keep `combinedSignals` typed as `EDGARSignal[]` and SHALL merge adapted records alongside the existing EDGAR and adapted SAM signals without removing or reordering them.
6. THE Zero_Cost_Ingestion_Layer SHALL preserve the `EDGARSignal` seam and `ReportSuggestion` currency such that the observed field set of each signal is identical to the existing `EDGARSignal` interface and no downstream stage observes any new field.
7. IF an `IngestionRecord` is missing a required field, THEN THE Ingestion_Adapter SHALL raise an error indicating the missing field name, SHALL NOT emit a partial `EDGARSignal`, and SHALL leave `combinedSignals` unchanged.
8. WHEN an `IngestionRecord.abstract` exceeds 700 characters, THE Ingestion_Adapter SHALL truncate the resulting `EDGARSignal.excerpt` to 700 characters.

### Requirement 7: Local Zero-LLM Keyword Gate with Lazy Enrichment

**User Story:** As a cost owner, I want a local 42-keyword regex gate placed between normalization and the adapter that triggers heavy fetches only on matches, so that no LLM calls or wasted full-text fetches occur during filtering.

#### Acceptance Criteria

1. THE Keyword_Gate SHALL evaluate `matchRecord` as a pure synchronous function of the space-joined concatenation of `headline` and `abstract` against exactly 42 precompiled, case-insensitive, word-boundary keywords, performing no network or model call.
2. THE Keyword_Gate SHALL run between normalization to `IngestionRecord[]` and the `ingestionRecordToEdgarSignal` adapter.
3. WHEN a record satisfies `matchRecord`, THE Keyword_Gate SHALL invoke `enrichFullText` exactly once to lazily fetch that record's `full_text_url`.
4. IF a record does not satisfy `matchRecord`, THEN THE Keyword_Gate SHALL NOT trigger any `full_text_url` fetch for that record.
5. WHEN `runKeywordGateAndEnrich` returns, THE Keyword_Gate SHALL return only records that satisfy `matchRecord`, introducing no added, duplicated, or synthesized records, with each returned record field-equal to its input and the relative input order preserved.
6. WHEN the input set is empty or no record matches, THE Keyword_Gate SHALL return an empty collection, perform no enrichment, and SHALL NOT throw.
7. IF `enrichFullText` receives a non-OK response, fails, or does not complete within 10 seconds, THEN THE Keyword_Gate SHALL keep the record un-enriched (headline and abstract only), record a not-completed indication, continue processing the remaining records, and SHALL NOT throw.

### Requirement 8: Federal Register Connector and Dynamic SAM Watchlist Source

**User Story:** As an intelligence analyst, I want SAM notice IDs extracted dynamically from Federal Register full-text payloads rather than from keyword sweeps, so that surgical SAM lookups target only solicitations actually referenced by U.S. regulatory notices.

#### Acceptance Criteria

1. WHEN the Federal_Register_Connector runs an ingestion cycle, THE Federal_Register_Connector SHALL fetch U.S. regulatory notices via `api.data.gov` and produce one `IngestionRecord` per retrieved notice as an `IngestionRecord[]` feeding Module 1.
2. WHEN reading the `DATA_GOV_API_KEY` credential, THE Federal_Register_Connector SHALL read it from the environment variable by name only and SHALL NOT hardcode its value.
3. IF the `DATA_GOV_API_KEY` environment variable is absent or empty when an ingestion cycle starts, THEN THE Federal_Register_Connector SHALL emit a warning log entry, skip the fetch, and return an empty `IngestionRecord[]` without throwing an exception.
4. WHEN a fetched U.S. regulatory notice's full-text payload contains one or more references to an active or proposed federal solicitation or award ID, THE Federal_Register_Connector SHALL extract each distinct referenced ID exactly once and pass each extracted ID to `fetchSamNoticeById`.
5. THE Zero_Cost_Ingestion_Layer SHALL derive SAM watchlist notice IDs exclusively from Federal Register full-text payload extraction as defined in criterion 4, and SHALL NOT obtain SAM watchlist notice IDs by keyword sweep or any other source.
6. IF a Federal Register request fails, returns a non-OK response, or does not complete within 30 seconds, THEN THE Federal_Register_Connector SHALL emit a warning log entry, return an empty `IngestionRecord[]`, and SHALL NOT throw an exception.

### Requirement 9: Strict Rolling 24-Hour Lookback Window

**User Story:** As a platform operator, I want Federal Register, EU TED, and UK FTS queries scoped to a strict rolling 24-hour window, so that payloads stay lightweight and aligned with the daily processing cycle.

#### Acceptance Criteria

1. WHEN the Federal_Register_Connector builds a query, THE Federal_Register_Connector SHALL restrict results to notices whose publication timestamp falls within the rolling window [T − 24 hours, T], where T is the query build time expressed in UTC, with the lower bound inclusive and the upper bound inclusive.
2. WHEN the TED_Connector builds a query, THE TED_Connector SHALL restrict results to notices whose publication timestamp falls within the rolling window [T − 24 hours, T], where T is the query build time expressed in UTC, with the lower bound inclusive and the upper bound inclusive.
3. WHEN the UK_FTS_Connector builds a query, THE UK_FTS_Connector SHALL restrict results to notices whose publication timestamp falls within the rolling window [T − 24 hours, T], where T is the query build time expressed in UTC, with the lower bound inclusive and the upper bound inclusive.
4. IF a connector receives a notice whose publication timestamp falls outside the rolling window [T − 24 hours, T], THEN THE connector SHALL exclude that notice from the ingested result set.
5. WHEN the Zero_Cost_Ingestion_Layer starts a daily processing cycle, THE Zero_Cost_Ingestion_Layer SHALL set the lookback window so that its lower bound equals the upper bound of the immediately preceding cycle's window, producing zero gap and zero overlap between consecutive cycles.
6. THE Zero_Cost_Ingestion_Layer SHALL execute exactly one ingestion cycle per 24-hour period, such that each cycle ingests exactly one 24-hour span of new notices.

### Requirement 10: BLS Series Keying to Kaiso Verticals

**User Story:** As a scoring maintainer, I want the BLS reference table keyed by specific PPI commodity series mapped to Kaiso verticals, so that the initial macro weight vectors resolve to the correct verticals.

#### Acceptance Criteria

1. THE BLS_Reference_Service SHALL include exactly one reference row for PPI commodity series `PCU334413334413`, keyed by case-sensitive exact match to the Kaiso vertical `Technology/Semiconductors`.
2. THE BLS_Reference_Service SHALL include exactly one reference row for PPI commodity series `PCU325412325412`, keyed by case-sensitive exact match to the Kaiso vertical `Pharmaceutical Manufacturing`.
3. WHEN `lookupSectorReference` is called with a vertical that a configured PPI series is keyed to, THE BLS_Reference_Service SHALL return exactly one reference row whose vertical matches the argument and whose macro weight vector derives from that series.
4. THE BLS_Reference_Service SHALL maintain a one-to-one mapping between configured PPI series and Kaiso verticals, with no duplicate or conflicting series-to-vertical entries.
5. IF a configured series maps to a vertical that is unmapped or invalid, THEN THE BLS_Reference_Service SHALL exclude that entry without throwing, leaving the remaining series resolvable.

### Requirement 11: Zero-Cost Infrastructure Invariance

**User Story:** As a budget owner, I want the ingestion layer to introduce no recurring cost, so that infrastructure spend remains exactly $0/month.

#### Acceptance Criteria

1. THE Zero_Cost_Ingestion_Layer SHALL invoke only APIs that return data without requiring payment, billing credentials, or a paid subscription tier, and the recurring monetary cost attributable to all invoked APIs SHALL equal $0.00 per calendar month.
2. IF a connector invocation requires a paid API, billing credentials, or a payment-gated tier, THEN THE Zero_Cost_Ingestion_Layer SHALL NOT issue the invocation and SHALL return an error result indicating the cost-gating condition, leaving prior cached data unchanged.
3. THE Zero_Cost_Ingestion_Layer SHALL implement every connector using only the native `fetch`, `fs`, and `path` capabilities of the existing runtime, such that the dependency list in `package.json` contains zero entries added beyond those present before this requirement.
4. THE Zero_Cost_Ingestion_Layer SHALL execute ingestion only when synchronously triggered within the `POST /api/intelligence/run` request handler, and SHALL register zero scheduled jobs, timers, or background cron processes.
5. WHERE a connector caches data, THE connector SHALL read and write cache entries exclusively as `/tmp/*.json` files, and SHALL treat any cache entry whose age exceeds 86400 seconds (24 hours) as expired.
6. IF a connector reads a cache entry whose age exceeds 86400 seconds, THEN THE connector SHALL discard the expired entry and re-fetch from the source rather than returning expired data.
7. WHEN a connector writes a set of N records to its `/tmp` cache and subsequently reads that cache within the same warm instance lifecycle and within 86400 seconds of the write, THE connector SHALL return exactly the same N records with field values byte-identical to those written.

### Requirement 12: Preserved Runtime, Types, and Credential Handling

**User Story:** As a maintainer, I want the Gemini runtime, the type definitions, and credential handling kept intact, so that no protected boundary of the system is disturbed.

#### Acceptance Criteria

1. THE Zero_Cost_Ingestion_Layer SHALL keep the Gemini runtime model identifier fixed at `gemini-2.5-flash` and invoked exclusively through the `@google/genai` SDK, with no other AI SDK introduced.
2. THE Zero_Cost_Ingestion_Layer SHALL leave the model-selection settings in `geminiService.ts` byte-for-byte unchanged, producing zero diff lines in that file's model configuration.
3. THE Zero_Cost_Ingestion_Layer SHALL leave `src/types.ts` byte-for-byte unchanged, preserving the existing `EDGARSignal` and `ReportSuggestion` interface definitions exactly as currently declared.
4. WHEN a connector requires the `DATA_GOV_API_KEY` or `SAM_GOV_API_KEY` credential, THE affected connector SHALL obtain its value solely by reading the environment variable of that exact name at runtime, with no credential value committed in source.
5. IF a required API key environment variable is absent or resolves to an empty string when a connector attempts to use it, THEN THE affected connector SHALL emit exactly one log entry for that key per ingestion cycle, return a neutral result (an empty signal collection rather than fabricated or partial data), and complete the cycle without throwing.

### Requirement 13: EU EPO Patent Connector

**User Story:** As an intelligence analyst, I want EU EPO patent publications ingested as a fifth zero-cost stream, so that patent-filing signals enter the pipeline alongside news, filings, and procurement.

#### Acceptance Criteria

1. WHEN reading the EPO credentials, THE EPO_Connector SHALL read `EPO_CONSUMER_KEY` and `EPO_CONSUMER_SECRET` from environment variables by name only and SHALL NOT hardcode their values; IF either is absent or empty, THEN THE EPO_Connector SHALL emit one warning, return an empty `IngestionRecord[]`, and SHALL NOT throw.
2. THE EPO_Connector SHALL authenticate to the EPO OPS v3.2 API using an OAuth2 client-credentials grant via the native `fetch` API, and SHALL apply the same strict rolling 24-hour UTC lookback window and 86,400,000 ms `/tmp` cache strategy as the other new connectors; IF a request fails, returns a non-OK response, or times out, THEN THE EPO_Connector SHALL emit a warning, return an empty `IngestionRecord[]`, and SHALL NOT throw.
3. WHEN EPO patent records are retrieved, THE EPO_Connector SHALL map each into an `IngestionRecord` with `source_system` set to `'EU_EPO'`, `content_type` set to `'epo_patent'`, and the patent's unique `external_id`, `source_url`, and `full_text_url` populated.
4. THE Orchestrator SHALL include the EPO_Connector in the `Promise.allSettled` fan-out so its records pass the keyword gate and lazy full-text fetch identically to the other sources, with no change to the `EDGARSignal` seam or downstream contract.
