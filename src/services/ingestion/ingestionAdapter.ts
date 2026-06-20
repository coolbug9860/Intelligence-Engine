/**
 * ingestionAdapter.ts
 *
 * The ONE seam function: `IngestionRecord` → existing `EDGARSignal`.
 *
 * This is the only place any new source re-enters the pipeline. It plugs
 * straight into server.ts's `combinedSignals` merge so Stage 1 (`analyzeNews`)
 * consumes it with ZERO downstream changes. `src/types.ts` is not modified —
 * we import the existing `EDGARSignal` interface and the canonical `VERTICALS`
 * runtime list as-is.
 */

import { EDGARSignal, VERTICALS } from '../../types';
import type { IngestionRecord } from './ingestionTypes';

/** EDGARSignal.excerpt ceiling, matching the existing EDGAR/RSS/SAM convention. */
const MAX_EXCERPT_LENGTH = 700;

/** Canonical vertical set for the recognized-vertical check (Req 6.4). */
const KNOWN_VERTICALS = new Set<string>(VERTICALS);

/**
 * Fields an IngestionRecord MUST carry to produce a structurally valid
 * EDGARSignal (every EDGARSignal field non-null, non-empty). `vertical_hint`
 * and `full_text_url` are intentionally NOT required here:
 *  - vertical_hint null/unrecognized falls back to 'General' (Req 6.4),
 *  - full_text_url is consumed by the keyword gate, not the adapter.
 */
const REQUIRED_FIELDS: ReadonlyArray<keyof IngestionRecord> = [
  'source_system',
  'content_type',
  'headline',
  'abstract',
  'source_url',
  'tracking_timestamp',
  'external_id',
];

/** True for a present, non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Map an IngestionRecord onto the existing EDGARSignal.
 *
 * Throws (naming the offending field) when a required field is missing/empty —
 * no partial EDGARSignal is ever emitted (Req 6.7). Excerpt is truncated to
 * 700 chars (Req 6.8). Null/unrecognized vertical_hint → 'General' (Req 6.4).
 */
export function ingestionRecordToEdgarSignal(rec: IngestionRecord): EDGARSignal {
  for (const field of REQUIRED_FIELDS) {
    if (!isNonEmptyString(rec[field])) {
      throw new Error(
        `ingestionRecordToEdgarSignal: missing or empty required field "${field}"`
      );
    }
  }

  const vertical =
    rec.vertical_hint && KNOWN_VERTICALS.has(rec.vertical_hint)
      ? rec.vertical_hint
      : 'General';

  return {
    title: rec.headline,
    filingType: rec.content_type,
    companyName: rec.source_system,
    filingDate: rec.tracking_timestamp,
    excerpt: rec.abstract.slice(0, MAX_EXCERPT_LENGTH),
    url: rec.source_url,
    vertical,
    matchedKeyword: rec.external_id,
  };
}

/** Batch helper for the server seam. */
export function adaptRecords(records: IngestionRecord[]): EDGARSignal[] {
  return records.map(ingestionRecordToEdgarSignal);
}
