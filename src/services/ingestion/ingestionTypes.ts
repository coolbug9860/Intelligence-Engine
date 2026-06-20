/**
 * ingestionTypes.ts
 *
 * The single normalization target for the Zero-Cost Ingestion Layer.
 *
 * Every external source (RSS, EDGAR, SAM.gov, EU TED, UK FTS / Contracts Finder,
 * U.S. Federal Register, and EU EPO patents) maps into ONE shape: `IngestionRecord`.
 * Records pass the local zero-LLM keyword gate, are lazily enriched on a match,
 * then collapse through `ingestionRecordToEdgarSignal` into the EXISTING
 * `EDGARSignal` seam — so nothing downstream changes.
 *
 * These are LOCAL module types (declared here, exactly like `SamSignal` lives in
 * samGovService.ts). `src/types.ts` is intentionally NOT modified.
 */

/** Which connector produced a record. */
export type SourceSystem =
  | 'RSS'
  | 'NEWSAPI'
  | 'EDGAR'
  | 'SAM_GOV'
  | 'EU_TED'
  | 'UK_FTS'
  | 'UK_CONTRACTS_FINDER'
  | 'US_FEDERAL_REGISTER'
  | 'EU_EPO';

/** Semantic class of an ingested item. */
export type ContentType =
  | 'news'
  | 'regulatory_filing'
  | 'procurement_notice'
  | 'award_notice'
  | 'epo_patent';

/**
 * The one DTO every source normalizes into. Exactly 11 fields.
 *
 * `vertical_hint` MAY be null (let downstream taxonomy/Gemini decide).
 * `full_text_url` MAY be null (no long-form document to lazily fetch).
 * All other fields are non-null, with string fields non-empty.
 */
export interface IngestionRecord {
  source_system: SourceSystem;   // which connector produced this record
  content_type: ContentType;     // semantic class of the item
  jurisdiction: string;          // ISO country/region code, e.g. 'US' | 'EU' | 'GB'
  headline: string;              // short title — fed to the keyword gate
  abstract: string;              // summary/description — fed to the keyword gate
  source_url: string;            // human-readable canonical link
  full_text_url: string | null;  // heavy document URL — fetched LAZILY on gate match
  tracking_timestamp: string;    // ISO timestamp used for freshness/ordering
  external_id: string;           // stable per-source id (noticeId, ocid, accession, epodoc, …)
  vertical_hint: string | null;  // best-effort vertical tag (null = let downstream decide)
  language: string;              // ISO 639-1, e.g. 'en'
}
