/**
 * keywordGate.ts (Task 2)
 *
 * The local, zero-LLM cost-protection chokepoint of the Zero-Cost Ingestion Layer.
 *
 * `matchRecord` is a PURE, synchronous predicate over `headline + abstract` — no
 * network, no model call. Heavy `full_text_url` fetches happen ONLY for records
 * that pass the gate (lazy fetching), bounding outbound enrichment to the
 * high-signal subset. This is what protects the $0/month budget and the per-source
 * rate limits.
 *
 * Validates: Requirements 7.1–7.7
 */

import type { IngestionRecord } from './ingestionTypes';

/** A record after the gate, optionally enriched with its long-form text. */
export type EnrichedRecord = IngestionRecord & {
  fullText?: string;          // present only when enrichment completed
  enrichmentCompleted: boolean; // explicit not-completed indication (Req 7.7)
};

/** Per-record lazy full-text fetch timeout (Req 7.7). */
const ENRICH_TIMEOUT_MS = 10_000;

/**
 * Exactly 42 commercial-signal keywords (Kaiso's 14 verticals × high-intent terms).
 * Kept as a flat readonly list so the count is auditable.
 */
export const GATE_KEYWORDS: readonly string[] = [
  'semiconductor', 'chip fabrication', 'advanced packaging',
  'medical device', 'clinical trial', 'drug approval',
  'electric vehicle', 'battery', 'autonomous',
  'renewable energy', 'energy storage', 'grid',
  'digital payments', 'embedded finance', 'open banking',
  'specialty chemicals', 'advanced materials', 'coatings',
  'satellite', 'unmanned', 'defense procurement',
  'precision agriculture', 'agritech', 'crop',
  'cold chain', 'food safety', 'alternative protein',
  'modular construction', 'infrastructure', 'facility modernization',
  'e-commerce logistics', 'last mile', 'supply chain',
  '5g', 'cloud migration', 'cybersecurity',
  'insurtech', 'banking as a service', 'reshoring',
  'carbon capture', 'hydrogen', 'data center',
] as const; // 42 entries

/** Escape a literal keyword for safe inclusion in a RegExp. */
function escapeForRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Precompiled, case-insensitive, word-boundary alternation built once at module
 * load. Word boundaries prevent substring false-positives (e.g. "grid" must not
 * match inside "gridlock"-style tokens beyond a boundary).
 */
const GATE_REGEX: RegExp = new RegExp(
  `\\b(${GATE_KEYWORDS.map(escapeForRegex).join('|')})\\b`,
  'i'
);

/**
 * Pure, synchronous, zero-LLM gate. True when the space-joined `headline` and
 * `abstract` hit any of the 42 keywords. Performs NO network or model call.
 */
export function matchRecord(rec: IngestionRecord): boolean {
  return GATE_REGEX.test(`${rec.headline} ${rec.abstract}`);
}

/**
 * Lazy enrichment: fetch `full_text_url` for a single (already gate-passing)
 * record. Non-fatal — a non-OK response, network error, or 10s timeout leaves
 * the record un-enriched (headline + abstract only) and flags it not-completed,
 * never throwing (Req 7.7). A null `full_text_url` is a no-op enrichment.
 */
export async function enrichFullText(rec: IngestionRecord): Promise<EnrichedRecord> {
  if (!rec.full_text_url) {
    return { ...rec, enrichmentCompleted: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICH_TIMEOUT_MS);

  try {
    const response = await fetch(rec.full_text_url, {
      headers: {
        // Descriptive UA — several gov/procurement hosts 403 a header-less fetch.
        'User-Agent': 'KaisoResearch/1.0 (market intelligence platform; contact@kaisoresearch.com)',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[KeywordGate] full-text fetch HTTP ${response.status} for ${rec.external_id}`);
      return { ...rec, enrichmentCompleted: false };
    }
    const fullText = await response.text();
    return { ...rec, fullText, enrichmentCompleted: true };
  } catch (err) {
    console.warn(`[KeywordGate] full-text fetch failed for ${rec.external_id}:`, err);
    return { ...rec, enrichmentCompleted: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gate → lazy fetch → return matches.
 *
 * Returns ONLY the records that pass `matchRecord`, in their original relative
 * order, each enriched exactly once. The result is a subset of the input: no
 * added, duplicated, or synthesized records. Empty input or zero matches yields
 * an empty array with no enrichment performed and no throw (Req 7.5, 7.6).
 */
export async function runKeywordGateAndEnrich(
  records: IngestionRecord[]
): Promise<EnrichedRecord[]> {
  const matched = records.filter(matchRecord); // order-preserving subset
  return Promise.all(matched.map(enrichFullText));
}
