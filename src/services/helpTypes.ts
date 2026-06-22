/**
 * Type definitions and tunable constants for the In-App Help / Search feature.
 *
 * These types are intentionally isolated in this module and do NOT modify or
 * extend any interface in `src/types.ts`. They are shared by the client
 * retrieval layer, the React hook/panel, and the server fallback route.
 */

/** Grouping for a knowledge base entry (UI filtering + categorization). */
export type HelpCategory =
  | 'metric'
  | 'section'
  | 'verdict'
  | 'pillar'
  | 'vertical'
  | 'pipeline-stage'
  | 'concept';

/** A single curated, app-aware knowledge base entry. */
export interface HelpEntry {
  /** Stable slug, e.g. "metric-opportunity-score". Unique across the KB. */
  id: string;
  /** Grouping for UI + filtering. */
  category: HelpCategory;
  /** Human label, e.g. "opportunityScore". */
  title: string;
  /** Exact code symbols this entry explains, e.g. ["opportunityScore"]. */
  symbols: string[];
  /** Colloquial phrasings, e.g. ["the ranking number", "score"]. */
  aliases: string[];
  /** Canonical explanation (markdown-light, kept small ~<= 600 chars). */
  body: string;
  /** Provenance, e.g. "AI_CONTEXT/PIPELINE_MAP.md". */
  sourceDoc?: string;
}

/** A knowledge base entry paired with its normalized match score. */
export interface ScoredEntry {
  entry: HelpEntry;
  /** 0..1 normalized match score. */
  score: number;
}

/** A lightweight citation reference to a knowledge base entry. */
export interface HelpSource {
  id: string;
  title: string;
  sourceDoc?: string;
}

/** A resolved, cacheable, renderable answer. */
export interface HelpAnswer {
  /** Original query. */
  query: string;
  /** Resolved explanation text. */
  answer: string;
  /** KB entries that backed the answer. */
  sources: HelpSource[];
  /** Provenance of the answer (for UI badge + telemetry). */
  mode: 'local' | 'llm';
  /** Epoch ms (cache freshness / debugging). */
  answeredAt: number;
}

/** Request body for the grounded LLM fallback route. */
export interface HelpExplainRequest {
  query: string;
  /** KB entry ids selected by client retrieval as grounding context. */
  contextIds: string[];
}

/** Response body from the grounded LLM fallback route. */
export interface HelpExplainResponse {
  answer: string;
  sources: HelpSource[];
  mode: 'llm';
}

/** Input settle delay (ms) before local retrieval runs. */
export const DEBOUNCE_MS = 250;
/** Best-match score at/above this → answer locally. */
export const LOCAL_CONFIDENCE = 0.55;
/** Matches in [SUGGEST_FLOOR, LOCAL_CONFIDENCE) → show as suggestions. */
export const SUGGEST_FLOOR = 0.20;
/** Max candidates surfaced and used as LLM grounding context. */
export const TOP_K = 4;
/** Max fallback LLM calls per browser session before graceful degrade. */
export const LLM_SESSION_BUDGET = 15;
