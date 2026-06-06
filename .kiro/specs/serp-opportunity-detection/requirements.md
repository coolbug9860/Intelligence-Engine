# Requirements Document

## Introduction

Kaiso Intelligence OS is a B2B syndicated-market-research engine. After the AI pipeline produces 8–10 report-title opportunities, a post-pipeline enrichment step decides whether each opportunity's market keyword is genuine white space or already commoditised, and that decision drives the downstream PUBLISH NOW / MONITOR / PASS verdict.

The current implementation (`competitorWhitespaceService.ts`) scrapes a fixed set of four competitor publisher sites and token-matches their search-result titles. This produces false opportunities: two of the four scrapers are effectively broken (Fortune Business Insights returns JS-rendered pages with zero parseable titles; Allied Market Research returns HTTP 500), so coverage is checked against only two sources. Even when the four-site check reports a CONFIRMED_GAP, manual review of Google organic results and AI Overviews frequently reveals other publishers already covering the keyword. The narrow source list both over-reports gaps (false positives) and cannot see the broader competitive field.

This feature replaces the fixed-publisher scraper with a SERP-based opportunity-detection framework. It validates each keyword against real search-engine results (via a paid SERP API to work around datacenter-IP blocking on Render), counts and classifies competing syndicated-report coverage across a defined set of signals (organic results, paid ads, AI Overviews, schema.org markup, report marketplaces, PDF results, and "Market Size/Share/Forecast" title patterns), applies explicit competitor-count thresholds to classify each keyword green / yellow / red, and reduces false positives through alias/variant handling and report-vs-blog discrimination. The step must remain non-fatal, stay within a per-run cost budget through caching and rate control, and preserve the existing output contract on `ReportSuggestion` so the downstream `actionClassificationEngine` continues to work without modification.

Scope is limited to detection and classification of opportunity vs. commoditised coverage. This feature is not a full SEO suite, keyword-research tool, or rank-tracking system.

## Glossary

- **Detection_Service**: The new server-side module that replaces `competitorWhitespaceService.ts`. It accepts scored `ReportSuggestion` objects and enriches each with white-space classification fields.
- **SERP_Provider**: The paid search-engine-results API (e.g., SerpApi, DataForSEO, Serper) used to retrieve search results for a keyword. Treated as a single fallible external dependency.
- **SERP_Response**: The structured data returned by the SERP_Provider for one keyword query, containing organic results, paid ads, AI Overview content, and related metadata.
- **Search_Keyword**: The normalized query string derived from a suggestion's `marketKeyword` (and/or `reportTitle`) that is submitted to the SERP_Provider.
- **Keyword_Variant**: An alternate phrasing of a Search_Keyword (alias, word-order change, singular/plural, or whitespace/punctuation variant) that refers to the same underlying market.
- **Competitor_Report**: A search result judged to be a genuine syndicated market-research report page covering the Search_Keyword, as opposed to a blog post, news article, or generic page.
- **Competitor_Count**: The number of distinct publisher domains for which at least one Competitor_Report was detected for a given Search_Keyword.
- **SERP_Signal**: An individual evidence type extracted from a SERP_Response: organic result, paid ad, AI Overview mention, schema.org Report/Product markup, report-marketplace listing, PDF result, or "Market Size/Share/Forecast" title pattern.
- **Report_Marketplace**: An aggregator domain that resells syndicated reports from many publishers (e.g., ResearchAndMarkets, ReportLinker).
- **Opportunity_Class**: The classification of a Search_Keyword into one of three bands — Green (strong gap), Yellow (partial coverage), or Red (crowded/commoditised) — based on Competitor_Count and supporting signals.
- **White_Space_Status**: The existing contract value consumed by the downstream engine — `CONFIRMED_GAP` | `PARTIAL_COVERAGE` | `COMMODITISED` | `UNKNOWN` — derived from Opportunity_Class.
- **Scoring_Rubric**: The deterministic rule set that maps Competitor_Count and SERP_Signals to a White_Space_Score (0–100) and an Opportunity_Class.
- **Run_Budget**: The maximum number of billable SERP_Provider calls permitted for a single pipeline run.
- **Result_Cache**: A persistent store of recent SERP_Responses and derived classifications, keyed by normalized Search_Keyword, used to avoid repeat billable calls within a refresh window.
- **Refresh_Window**: The maximum age of a cached classification before it is considered stale and must be re-fetched.
- **Report_Suggestion**: The `ReportSuggestion` object defined in `src/types.ts` that flows through the pipeline.
- **Action_Engine**: The existing `actionClassificationEngine.ts` that consumes White_Space_Status and White_Space_Score to produce the PUBLISH NOW / MONITOR / PASS verdict.

## Requirements

### Requirement 1: SERP-based coverage detection

**User Story:** As a Kaiso research operator, I want each opportunity keyword validated against real search-engine results rather than a fixed list of four publishers, so that the gap/commoditised decision reflects the actual competitive field.

#### Acceptance Criteria

1. WHEN the Detection_Service processes a Report_Suggestion, THE Detection_Service SHALL derive a Search_Keyword from the suggestion's `marketKeyword`, falling back to `reportTitle` when `marketKeyword` is empty.
2. WHEN a non-empty Search_Keyword is derived, THE Detection_Service SHALL request a SERP_Response for that Search_Keyword from the SERP_Provider.
3. THE Detection_Service SHALL evaluate competitor coverage using the SERP_Response rather than a hardcoded list of publisher domains.
3a. WHERE the SERP_Provider was not called for a Search_Keyword, THE Detection_Service SHALL still evaluate competitor coverage using a non-stale cached SERP_Response or an alternative coverage source when available.
4. WHEN a SERP_Response is received, THE Detection_Service SHALL extract the publisher domain for each organic result.
5. IF a derived Search_Keyword is empty after normalization OR the Report_Suggestion is missing both `marketKeyword` and `reportTitle`, THEN THE Detection_Service SHALL return the Report_Suggestion with White_Space_Status set to `UNKNOWN` and SHALL NOT call the SERP_Provider.
6. IF the SERP_Provider is unavailable for the run, THEN THE Detection_Service SHALL fall back to the legacy fixed-publisher coverage check to derive a best-effort classification before defaulting to `UNKNOWN`.

### Requirement 2: Opportunity definition and competitor-count thresholds

**User Story:** As a Kaiso research operator, I want an explicit, documented definition of what counts as an opportunity, so that classification is consistent and reviewable rather than implicit in code.

#### Acceptance Criteria

1. WHEN the Detection_Service has determined the Competitor_Count for a Search_Keyword, THE Detection_Service SHALL assign an Opportunity_Class of Green WHERE the Competitor_Count is 0.
2. WHEN the Competitor_Count is 1 or 2, THE Detection_Service SHALL assign an Opportunity_Class of Yellow.
3. WHEN the Competitor_Count is between 3 and 6 inclusive, THE Detection_Service SHALL assign an Opportunity_Class of Red with reason "crowded".
4. WHEN the Competitor_Count is 7 or greater, THE Detection_Service SHALL assign an Opportunity_Class of Red with reason "commoditised".
5. THE Detection_Service SHALL record the numeric Competitor_Count used to derive the Opportunity_Class on the Report_Suggestion.
6. THE requirements document SHALL define the threshold boundaries in a single Scoring_Rubric so that threshold values are configurable in one location.

### Requirement 3: Signal-source detection

**User Story:** As a Kaiso research operator, I want existing coverage detected from multiple SERP signal types, so that a keyword is not declared a gap merely because one signal type was empty.

#### Acceptance Criteria

1. WHEN evaluating a SERP_Response, THE Detection_Service SHALL inspect organic results for Competitor_Reports.
2. WHEN evaluating a SERP_Response, THE Detection_Service SHALL inspect paid advertisement results for publisher and Report_Marketplace domains.
3. WHERE the SERP_Response includes an AI Overview or AI-generated answer, THE Detection_Service SHALL extract cited and referenced source domains from that AI Overview.
4. WHERE an organic result exposes schema.org `Report` or `Product` structured-data markup, THE Detection_Service SHALL treat that result as a stronger Competitor_Report signal than a result without such markup.
5. WHEN evaluating organic results, THE Detection_Service SHALL identify results from Report_Marketplace domains as Competitor_Reports.
6. WHEN evaluating a SERP_Response, THE Detection_Service SHALL identify results whose URL or title indicates a PDF document.
7. WHEN evaluating a result title, THE Detection_Service SHALL detect the "Market Size", "Market Share", and "Market Forecast" title patterns as syndicated-report indicators, AND THE Detection_Service SHALL treat a result as a syndicated-report indicator WHEN any single one of these patterns is present.
8. THE Detection_Service SHALL record on the Report_Suggestion which SERP_Signal types contributed to the detected coverage.

### Requirement 4: False-positive reduction and report-vs-blog discrimination

**User Story:** As a Kaiso research operator, I want genuine syndicated-report pages distinguished from blog posts, news articles, and generic content, so that a keyword is classified Red only when real competing reports exist.

#### Acceptance Criteria

1. WHEN classifying an organic result, THE Detection_Service SHALL count the result as a Competitor_Report only WHERE the result exhibits at least one report indicator (report-style URL path, "Market Size/Share/Forecast" title pattern, schema.org Report/Product markup, or Report_Marketplace domain).
2. IF an organic result matches a known blog, news, or article URL pattern, THEN THE Detection_Service SHALL exclude that result from the Competitor_Count regardless of any report indicators it exhibits.
3. WHEN multiple results originate from the same publisher domain, THE Detection_Service SHALL count that domain once toward the Competitor_Count.
4. WHEN a result is from a paywalled page that still exhibits a "Market Size/Share/Forecast" title pattern or schema.org Report/Product markup, THE Detection_Service SHALL count that result as a Competitor_Report.
5. THE Detection_Service SHALL exclude Kaiso's own domains from the Competitor_Count.

### Requirement 5: Keyword alias and variant handling

**User Story:** As a Kaiso research operator, I want keyword aliases and wording variants normalized before lookup, so that coverage is matched regardless of trivial phrasing differences and duplicate queries are avoided.

#### Acceptance Criteria

1. WHEN deriving a Search_Keyword, THE Detection_Service SHALL normalize the keyword by lowercasing, trimming surrounding whitespace, collapsing internal whitespace runs to a single space, and removing leading "global" and trailing "market"/"industry" qualifiers.
2. WHEN comparing a result title to the Search_Keyword, THE Detection_Service SHALL treat singular and plural forms of a token as matching.
3. WHEN comparing a result title to the Search_Keyword, THE Detection_Service SHALL ignore token ordering differences.
4. WHEN two Report_Suggestions in the same run normalize to the same Search_Keyword, THE Detection_Service SHALL reuse the first SERP_Response for the second suggestion rather than issuing a duplicate SERP_Provider call.
5. WHEN the first SERP_Provider call for a Search_Keyword fails or times out, THE Detection_Service SHALL reuse that failed result for subsequent suggestions normalizing to the same Search_Keyword within the run rather than retrying.

### Requirement 6: Scoring and green/yellow/red classification output

**User Story:** As a Kaiso research operator, I want a deterministic score and color band per keyword, so that I can quickly rank opportunities and reduce subjective judgment.

#### Acceptance Criteria

1. WHEN the Opportunity_Class is Green, THE Detection_Service SHALL set the White_Space_Score to a value of 75 or greater.
2. WHEN the Opportunity_Class is Yellow, THE Detection_Service SHALL set the White_Space_Score to a value between 40 and 74 inclusive.
3. WHEN the Opportunity_Class is Red, THE Detection_Service SHALL set the White_Space_Score to a value strictly less than 40.
4. WHEN the same SERP_Response is evaluated more than once, THE Detection_Service SHALL produce the identical White_Space_Score and Opportunity_Class each time (deterministic scoring).
5. THE Detection_Service SHALL produce a one-sentence human-readable explanation that names the Competitor_Count and the contributing SERP_Signal types for each classification.

### Requirement 7: Non-fatal degradation

**User Story:** As a Kaiso research operator, I want the pipeline to continue when SERP lookups fail, so that an external API problem never breaks a research run.

#### Acceptance Criteria

1. IF a SERP_Provider request fails, times out, or returns an error status, THEN THE Detection_Service SHALL return the affected Report_Suggestion with White_Space_Status set to `UNKNOWN` and SHALL continue processing remaining suggestions.
2. IF the SERP_Provider API credential is absent or invalid, THEN THE Detection_Service SHALL skip SERP lookups for the run and SHALL return every Report_Suggestion with White_Space_Status set to `UNKNOWN`.
3. WHEN any error occurs within the Detection_Service, THE Detection_Service SHALL log the error and SHALL return the input Report_Suggestions without throwing an exception to the calling pipeline.
4. WHEN the Detection_Service completes, THE Detection_Service SHALL return a Report_Suggestion array of the same length as the input array.

### Requirement 8: Caching and refresh cadence

**User Story:** As a Kaiso research operator, I want recent SERP results cached and refreshed on a defined cadence, so that repeated runs do not re-incur SERP costs for unchanged keywords.

#### Acceptance Criteria

1. WHEN the Detection_Service derives a Search_Keyword, THE Detection_Service SHALL check the Result_Cache for a non-stale entry keyed by the normalized Search_Keyword before calling the SERP_Provider.
2. WHERE a non-stale Result_Cache entry exists for a Search_Keyword, THE Detection_Service SHALL use the cached classification and SHALL NOT call the SERP_Provider.
3. WHEN a SERP_Response is successfully retrieved and classified, THE Detection_Service SHALL store the classification in the Result_Cache with a timestamp.
4. WHEN a Result_Cache entry's age exceeds the Refresh_Window, THE Detection_Service SHALL treat that entry as stale and SHALL re-fetch from the SERP_Provider.
5. THE Detection_Service SHALL persist the Result_Cache to a location that survives within the runtime's writable storage for the duration of the Refresh_Window.

### Requirement 9: Cost budgeting and rate control

**User Story:** As a Kaiso research operator, I want SERP API usage bounded per run, so that detection costs stay predictable and capped.

#### Acceptance Criteria

1. THE Detection_Service SHALL enforce a configurable Run_Budget of at least 1 limiting the number of billable SERP_Provider calls per pipeline run.
2. WHEN the number of billable SERP_Provider calls in a run reaches the Run_Budget, THE Detection_Service SHALL stop issuing further SERP_Provider calls and SHALL set White_Space_Status to `UNKNOWN` for any remaining unprocessed Report_Suggestions.
3. WHEN issuing consecutive SERP_Provider calls, THE Detection_Service SHALL apply a configurable minimum delay between calls to respect provider rate limits.
4. WHEN a SERP_Provider call is served from the Result_Cache, THE Detection_Service SHALL NOT count that call against the Run_Budget.
5. THE Detection_Service SHALL log the count of billable SERP_Provider calls made during each run.

### Requirement 10: Backward-compatible output contract

**User Story:** As a Kaiso engineer, I want the Detection_Service to set the same `ReportSuggestion` fields the downstream engine already consumes, so that the Action_Engine continues to work without modification.

#### Acceptance Criteria

1. WHEN the Detection_Service classifies a Report_Suggestion, THE Detection_Service SHALL set `whiteSpaceStatus` to one of `CONFIRMED_GAP`, `PARTIAL_COVERAGE`, `COMMODITISED`, or `UNKNOWN`.
2. WHEN the Opportunity_Class is Green, THE Detection_Service SHALL set `whiteSpaceStatus` to `CONFIRMED_GAP`.
3. WHEN the Opportunity_Class is Yellow, THE Detection_Service SHALL set `whiteSpaceStatus` to `PARTIAL_COVERAGE`.
4. WHEN the Opportunity_Class is Red, THE Detection_Service SHALL set `whiteSpaceStatus` to `COMMODITISED`.
5. THE Detection_Service SHALL map each Opportunity_Class to exactly one `whiteSpaceStatus` value.
6. IF the Opportunity_Class is missing or unrecognized, THEN THE Detection_Service SHALL set `whiteSpaceStatus` to `UNKNOWN`.
7. WHEN the Detection_Service classifies a Report_Suggestion, THE Detection_Service SHALL set `whiteSpaceScore`, `whiteSpaceLabel`, `whiteSpaceCompetitors`, and `whiteSpaceGapReason` on that Report_Suggestion, AND WHERE one or more of these fields cannot be derived, THE Detection_Service SHALL populate the remaining fields and complete the classification rather than rejecting it.
8. WHEN populating `whiteSpaceCompetitors`, THE Detection_Service SHALL list the distinct publisher domains counted as Competitor_Reports.
9. WHERE the Detection_Service adds richer fields beyond the existing contract, THE Detection_Service SHALL add them as new optional fields on `ReportSuggestion` without removing or repurposing the existing white-space fields.

### Requirement 11: Actionable checklist and sample rubric artifact

**User Story:** As a Kaiso research operator, I want an operational checklist and a sample scoring rubric, so that the classification logic is transparent and the manual review process is repeatable.

#### Acceptance Criteria

1. THE design SHALL document a Scoring_Rubric table mapping Competitor_Count ranges and SERP_Signal combinations to White_Space_Score and Opportunity_Class.
2. THE design SHALL document an operator checklist enumerating the SERP_Signal types to verify when manually reviewing a classification.
3. THE Scoring_Rubric SHALL express threshold boundaries and score bands as named, configurable values rather than inline literals.
