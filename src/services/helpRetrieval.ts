/**
 * Deterministic, client-side local retrieval for the In-App Help / Search feature.
 *
 * This module is intentionally pure: no React, no I/O, no module-level mutable
 * state. Functions return equal results for equal inputs, making the retrieval
 * layer trivially testable and referentially transparent.
 *
 * Exports are additive: `normalize` lands first; `scoreEntry` (task 3.3) and
 * `searchKnowledgeBase` (task 3.6) are added later without changing this one.
 */

/**
 * Common English stopwords plus filler words frequent in help-style questions
 * ("what", "does", "mean"). Dropping these focuses scoring on the meaningful
 * tokens (symbols, metric names, concepts) rather than question scaffolding.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'did',
  'for', 'from', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me',
  'mean', 'means', 'my', 'no', 'not', 'of', 'on', 'or', 'so', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'would', 'you', 'your',
]);

/**
 * Normalize free-text into a list of meaningful tokens.
 *
 * Steps: lowercase → strip punctuation (keep alphanumerics) → split on
 * whitespace → drop empty tokens and stopwords. The result depends only on the
 * input `text` (pure function, no external state).
 *
 * @param text - Raw query or entry text (may be empty/whitespace).
 * @returns Lowercased, punctuation-free, stopword-filtered tokens. Empty array
 *          for empty or whitespace-only input.
 */
export function normalize(text: string): string[] {
  if (!text) return [];

  return text
    .toLowerCase()
    // Replace any run of non-alphanumeric characters with a single space so
    // punctuation acts as a token boundary (e.g. "PASS?" -> "pass").
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

import type { HelpEntry, ScoredEntry } from './helpTypes';
import { LOCAL_CONFIDENCE, SUGGEST_FLOOR, TOP_K } from './helpTypes';

/** Score assigned when a query contains an exact code symbol of the entry. */
const SYMBOL_MATCH_SCORE = 1.0;
/** Score assigned when a query contains a colloquial alias of the entry. */
const ALIAS_MATCH_SCORE = 0.85;

/** Count how many of `qTokens` also appear in `entryTokens` (set membership). */
function countCommon(qTokens: string[], entryTokens: string[]): number {
  const entrySet = new Set(entryTokens);
  let overlap = 0;
  for (const token of qTokens) {
    if (entrySet.has(token)) overlap += 1;
  }
  return overlap;
}

/**
 * Score how well a single knowledge base entry matches a query, in [0, 1].
 *
 * Scoring tiers (highest signal wins):
 *  1. Exact symbol present in the query  → 1.0 (precise references are decisive).
 *  2. Alias present in the query         → 0.85 (strong colloquial match).
 *  3. Otherwise                          → normalized token coverage:
 *     the fraction of meaningful query tokens that the entry's
 *     title + aliases + body explains, clamped to [0, 1].
 *
 * Pure function: it reads `entry` and `query` only and never mutates either,
 * so the knowledge base is left untouched (Requirement 3.5).
 *
 * @param query - Raw user query.
 * @param entry - A single knowledge base entry.
 * @returns Match score within the inclusive range [0, 1].
 */
export function scoreEntry(query: string, entry: HelpEntry): number {
  const qLower = query.toLowerCase();

  // Tier 1: exact code symbol appears verbatim in the query → decisive match.
  for (const sym of entry.symbols) {
    const symLower = sym.toLowerCase().trim();
    if (symLower.length > 0 && qLower.includes(symLower)) {
      return SYMBOL_MATCH_SCORE;
    }
  }

  // Tier 2: colloquial alias appears in the query → strong match.
  for (const alias of entry.aliases) {
    const aliasLower = alias.toLowerCase().trim();
    if (aliasLower.length > 0 && qLower.includes(aliasLower)) {
      return ALIAS_MATCH_SCORE;
    }
  }

  // Tier 3: normalized token coverage of the query by the entry's text.
  const qTokens = normalize(query);
  if (qTokens.length === 0) return 0;

  const entryTokens = normalize(
    `${entry.title} ${entry.aliases.join(' ')} ${entry.body}`,
  );
  const overlap = countCommon(qTokens, entryTokens);
  const coverage = overlap / qTokens.length;

  // coverage is already within [0, 1] by construction; clamp defensively.
  return Math.max(0, Math.min(1, coverage));
}

/** Routing mode chosen by the local retrieval layer. */
export type RoutingMode = 'local' | 'suggestions' | 'needs-llm';

/**
 * Result of a local knowledge base search. Exactly one `mode` is returned:
 *  - `local`       → confident hit; `answer` is the matched entry's body (non-null).
 *  - `suggestions` → near-miss or empty query; ranked `topMatches`, null `answer`.
 *  - `needs-llm`   → no usable candidate; null `answer`, may carry weak matches.
 */
export interface HelpSearchResult {
  mode: RoutingMode;
  /** Non-null only when `mode === 'local'`. */
  answer: string | null;
  /** Ranked candidates (<= TOP_K), used for suggestions and LLM grounding. */
  topMatches: ScoredEntry[];
  /** 0..1 score of the best match (0 when there is no match). */
  confidence: number;
}

/**
 * Deterministic local search + router over the knowledge base.
 *
 * Algorithm (see design "Local retrieval + routing"):
 *  1. Normalize the query. Empty token list → `suggestions` with no matches,
 *     confidence 0 (Requirement 2.2).
 *  2. Score every entry, keep those scoring > 0, sort descending, take TOP_K.
 *  3. Route by the best score:
 *       best >= LOCAL_CONFIDENCE → `local` (answer = best entry body)
 *       best >= SUGGEST_FLOOR    → `suggestions`
 *       otherwise (incl. no match) → `needs-llm`
 *
 * Pure: does not mutate `kb` (it copies before sorting) and performs no I/O.
 *
 * @param query - Raw user query (may be empty/whitespace).
 * @param kb - Knowledge base entries to search.
 * @returns A single-mode HelpSearchResult with at most TOP_K candidates.
 */
export function searchKnowledgeBase(
  query: string,
  kb: HelpEntry[],
): HelpSearchResult {
  // Empty/whitespace queries: nothing to rank → browse-style suggestions.
  if (normalize(query).length === 0) {
    return { mode: 'suggestions', answer: null, topMatches: [], confidence: 0 };
  }

  // Score every entry; keep only positive matches (loop invariant: `scored`
  // holds exactly the processed entries whose score > 0).
  const scored: ScoredEntry[] = [];
  for (const entry of kb) {
    const score = scoreEntry(query, entry);
    if (score > 0) scored.push({ entry, score });
  }

  // Sort descending by score (copy already isolated from `kb`) and cap at TOP_K.
  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, TOP_K);
  const best = topMatches[0];

  // No candidate cleared a positive score → defer to the LLM fallback.
  if (!best) {
    return { mode: 'needs-llm', answer: null, topMatches: [], confidence: 0 };
  }

  if (best.score >= LOCAL_CONFIDENCE) {
    return {
      mode: 'local',
      answer: best.entry.body,
      topMatches,
      confidence: best.score,
    };
  }

  if (best.score >= SUGGEST_FLOOR) {
    return {
      mode: 'suggestions',
      answer: null,
      topMatches,
      confidence: best.score,
    };
  }

  return { mode: 'needs-llm', answer: null, topMatches, confidence: best.score };
}
