/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Multi-Signal Reasoning Engine
 * src/services/reasoningEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * This engine transforms isolated AI-generated opportunities into
 * interconnected market intelligence reasoning structures.
 *
 * Instead of treating each opportunity independently,
 * the engine identifies:
 *
 * - causal relationships
 * - macro-theme convergence
 * - supply chain dependencies
 * - regulatory propagation
 * - adjacent market effects
 * - upstream/downstream commercial implications
 *
 * This becomes the foundation for:
 *
 * - advanced intelligence graphs
 * - strategic forecasting
 * - thematic market maps
 * - signal propagation analysis
 * - future RAG architecture
 * - commercial reasoning explainability
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Type } from "@google/genai";
import { ReportSuggestion } from "../types";
import { keyManager } from "./geminiService";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type RelationshipType =
  | "Thematic Convergence"
  | "Supply Chain Dependency"
  | "Regulatory Spillover"
  | "Technology Enablement"
  | "Buyer Overlap"
  | "Geographic Reinforcement"
  | "Capital Flow Alignment"
  | "Infrastructure Coupling";

export interface SignalRelationship {
  sourceId: string;
  targetId: string;

  relationshipType: RelationshipType;

  strength: number; // 0–100

  rationale: string;
}

export interface ReasoningCluster {
  clusterId: string;

  thematicCluster: string;

  signals: ReportSuggestion[];

  averageOpportunityScore: number;

  dominantVerticals: string[];

  dominantPillars: string[];

  relationshipDensity: number;

  strategicNarrative: string;
}

export interface ReasoningResult {
  relationships: SignalRelationship[];

  clusters: ReasoningCluster[];

  strongestSignals: ReportSuggestion[];

  macroThemes: string[];

  reasoningSummary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL LLM TYPES (NEW — not exported, never crosses the engine boundary)
//
// These describe the lightweight, references-only envelope the model returns.
// The model is NEVER asked to emit ReportSuggestion[], numeric scores, or
// derived fields — those are rehydrated/computed locally. Declared here (never
// in types.ts) per project steering.
// ─────────────────────────────────────────────────────────────────────────────

type ConfidenceBand = "WEAK" | "MODERATE" | "STRONG" | "CRITICAL";

interface LLMEdge {
  sourceId: string; // must reference a real signal id
  targetId: string; // must reference a real signal id
  relationshipType: RelationshipType;
  confidence: ConfidenceBand; // mapped → numeric strength locally
  rationale: string;
}

interface LLMClusterRef {
  thematicCluster: string; // human-readable theme label
  memberSignalIds: string[]; // ids drawn from curatedPortfolio
  strategicNarrative: string;
}

interface LLMReasoningEnvelope {
  edges: LLMEdge[];
  clusters: LLMClusterRef[];
  macroThemes: string[];
  reasoningSummary: string;
}

interface LLMSignalProjection {
  id: string;
  reportTitle: string;
  marketKeyword: string;
  vertical: string;
  strategicPillar: string;
  thematicCluster: string;
  primaryStakeholder: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI STRUCTURED-OUTPUTS RESPONSE SCHEMA (NEW — internal)
//
// Mirrors the Type.* schema convention already used in geminiService.ts.
// relationshipType and confidence are enum-constrained to eliminate free-text
// drift: the eight allowed relationship types and four confidence bands.
// ─────────────────────────────────────────────────────────────────────────────

const REASONING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    edges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceId: { type: Type.STRING },
          targetId: { type: Type.STRING },
          relationshipType: {
            type: Type.STRING,
            enum: [
              "Thematic Convergence",
              "Supply Chain Dependency",
              "Regulatory Spillover",
              "Technology Enablement",
              "Buyer Overlap",
              "Geographic Reinforcement",
              "Capital Flow Alignment",
              "Infrastructure Coupling",
            ],
          },
          confidence: {
            type: Type.STRING,
            enum: ["WEAK", "MODERATE", "STRONG", "CRITICAL"],
          },
          rationale: { type: Type.STRING },
        },
        required: ["sourceId", "targetId", "relationshipType", "confidence", "rationale"],
      },
    },
    clusters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          thematicCluster: { type: Type.STRING },
          memberSignalIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          strategicNarrative: { type: Type.STRING },
        },
        required: ["thematicCluster", "memberSignalIds", "strategicNarrative"],
      },
    },
    macroThemes: { type: Type.ARRAY, items: { type: Type.STRING } },
    reasoningSummary: { type: Type.STRING },
  },
  required: ["edges", "clusters", "macroThemes", "reasoningSummary"],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE BAND → NUMERIC STRENGTH MAPPING (NEW — internal)
//
// Qualitative bands map to the strict 0–100 scale. Calibrated so MODERATE and
// above clear the Stage 8 MIN_PROPAGATION_STRENGTH (40) gate, while WEAK edges
// remain in the graph but stay below the propagation threshold.
// ─────────────────────────────────────────────────────────────────────────────

const BAND_TO_STRENGTH: Record<ConfidenceBand, number> = {
  WEAK: 30,
  MODERATE: 55,
  STRONG: 75,
  CRITICAL: 95,
};

function bandToStrength(band: ConfidenceBand): number {
  const raw = BAND_TO_STRENGTH[band] ?? 30; // absent/null/empty/unknown band → WEAK floor
  return Math.max(0, Math.min(100, raw)); // defensive clamp to inclusive 0–100
}

// ─────────────────────────────────────────────────────────────────────────────
// EDGE REFERENTIAL VALIDATION
//
// Converts the model's lightweight LLMEdge[] into the strict SignalRelationship[]
// contract Stage 7/8 consume. Every edge must reference real curatedPortfolio
// ids — orphan, self-referential, or empty edges are dropped so the Stage 8
// adjacency map never dangles on unknown nodes. Duplicate undirected pairs are
// collapsed, keeping the highest-strength edge. Bands map to numeric strength.
// ─────────────────────────────────────────────────────────────────────────────

function validateEdges(
  llmEdges: LLMEdge[],
  validIds: Set<string>
): SignalRelationship[] {
  // Keyed by undirected pair → best (highest-strength) relationship seen, plus
  // the input index of its first occurrence for stable tie-breaking.
  const byPair = new Map<string, { rel: SignalRelationship; order: number }>();

  (llmEdges ?? []).forEach((e, index) => {
    const sourceId = e?.sourceId;
    const targetId = e?.targetId;

    // Drop missing/empty, self-referential, and orphan (unknown-id) edges.
    if (!sourceId || !targetId) return;
    if (sourceId === targetId) return;
    if (!validIds.has(sourceId) || !validIds.has(targetId)) return;

    const rel: SignalRelationship = {
      sourceId,
      targetId,
      relationshipType: e.relationshipType,
      strength: bandToStrength(e.confidence),
      rationale: e.rationale,
    };

    const pairKey = [sourceId, targetId].sort().join("::"); // undirected dedupe
    const existing = byPair.get(pairKey);

    if (!existing) {
      byPair.set(pairKey, { rel, order: index });
    } else if (rel.strength > existing.rel.strength) {
      // Keep the stronger edge but preserve the earliest order for tie stability.
      byPair.set(pairKey, { rel, order: existing.order });
    }
  });

  return [...byPair.values()]
    .sort((a, b) => b.rel.strength - a.rel.strength || a.order - b.order)
    .map(entry => entry.rel);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTER REHYDRATION
//
// The model emits only lightweight cluster refs (theme + member ids + narrative).
// Deterministic code rebuilds the full ReasoningCluster shape Stage 7 consumes:
// attaching the REAL ReportSuggestion objects from the in-memory portfolio and
// computing every numeric field locally. Member ids are resolved in order,
// de-duplicated, and unknown ids dropped; empty clusters are discarded.
// ─────────────────────────────────────────────────────────────────────────────

/** De-duplicate + order strings by descending frequency, then alphabetically. */
function rankByFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => {
    const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

function rehydrateClusters(
  llmClusters: LLMClusterRef[],
  relationships: SignalRelationship[],
  byId: Map<string, ReportSuggestion>
): ReasoningCluster[] {
  const clusters: ReasoningCluster[] = [];

  for (const ref of llmClusters ?? []) {
    // Resolve member ids: preserve order, de-duplicate, drop unknown ids.
    const seen = new Set<string>();
    const signals: ReportSuggestion[] = [];
    for (const id of ref.memberSignalIds ?? []) {
      if (!id || seen.has(id)) continue;
      const sig = byId.get(id);
      if (!sig) continue; // unknown id → drop
      seen.add(id);
      signals.push(sig);
    }

    if (signals.length === 0) continue; // discard empty clusters

    const avgScore =
      signals.reduce((sum, s) => sum + (s.opportunityScore || 0), 0) /
      signals.length;

    // relationshipDensity = internal relationships / max possible undirected
    // pairs, bounded to 0–1; 0 when fewer than 2 signals.
    const memberIds = new Set(signals.map(s => s.id));
    const internalRels = relationships.filter(
      r => memberIds.has(r.sourceId) && memberIds.has(r.targetId)
    );
    const maxPairs = (signals.length * (signals.length - 1)) / 2;
    const density =
      maxPairs === 0 ? 0 : Math.min(1, internalRels.length / maxPairs);

    clusters.push({
      clusterId: deterministicClusterId(ref.thematicCluster),
      thematicCluster: ref.thematicCluster,
      signals, // REAL ReportSuggestion objects from the portfolio
      averageOpportunityScore: Math.round(avgScore * 100) / 100,
      dominantVerticals: rankByFrequency(signals.map(s => String(s.vertical))),
      dominantPillars: rankByFrequency(
        signals
          .map(s => s.strategicPillar)
          .filter((p): p is NonNullable<typeof p> => Boolean(p)) as string[]
      ),
      relationshipDensity: Math.round(density * 100) / 100,
      strategicNarrative: ref.strategicNarrative,
    });
  }

  return clusters.sort(
    (a, b) =>
      b.averageOpportunityScore - a.averageOpportunityScore ||
      a.clusterId.localeCompare(b.clusterId)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI TRANSPORT (batched, bounded)
//
// One batched structured-output call reasons over the ENTIRE portfolio at once.
// Dispatched through the reused GeminiKeyManager (multi-key rotation + transient
// retry) and bounded by REASONING_TIMEOUT_MS so a hung call cannot consume the
// 600s Express budget. Returns the parsed envelope, or null on empty/unparseable
// output; throws on transport failure so the caller can fall back.
// ─────────────────────────────────────────────────────────────────────────────

const REASONING_MODEL = "gemini-2.5-flash";
const REASONING_TIMEOUT_MS = 45_000;

/** Bounded race: abort + reject if the LLM call exceeds `ms`. */
function withReasoningTimeout<T>(
  promise: Promise<T>,
  ms: number,
  ctrl: AbortController
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        ctrl.abort();
        reject(new Error("Reasoning LLM timeout"));
      }, ms)
    ),
  ]);
}

/** Project the portfolio to the compact 7-field shape (token control). */
function serializeForLLM(portfolio: ReportSuggestion[]): LLMSignalProjection[] {
  return portfolio.map(s => ({
    id: s.id,
    reportTitle: s.reportTitle,
    marketKeyword: s.marketKeyword,
    vertical: String(s.vertical),
    strategicPillar: s.strategicPillar ?? "Unspecified",
    thematicCluster: s.thematicCluster,
    primaryStakeholder: s.primaryStakeholder ?? "Unspecified",
  }));
}

/** Build the batched whole-portfolio reasoning prompt. */
function buildReasoningPrompt(projection: LLMSignalProjection[]): string {
  return [
    "You are the strategic reasoning core of a B2B market-intelligence platform.",
    "Below is the FULL curated portfolio of opportunities for this cycle. Analyze",
    "the ENTIRE set together and reason about how these opportunities converge.",
    "",
    "Identify relationships between signals. For each relationship, uncover:",
    "  - Causal relationships (one signal drives or enables another)",
    "  - Supply chain dependencies (upstream/downstream production linkage)",
    "  - Regulatory spillover (a policy trigger affecting multiple signals)",
    "  - Upstream/downstream commercial implications (buyer/capital/infrastructure flow)",
    "",
    "Map every relationship to EXACTLY ONE relationshipType:",
    '  "Thematic Convergence" | "Supply Chain Dependency" | "Regulatory Spillover" |',
    '  "Technology Enablement" | "Buyer Overlap" | "Geographic Reinforcement" |',
    '  "Capital Flow Alignment" | "Infrastructure Coupling"',
    "",
    "Assign each relationship a confidence band: WEAK | MODERATE | STRONG | CRITICAL.",
    "",
    "RULES:",
    '  - Use ONLY the exact "id" values provided below for sourceId/targetId and',
    "    cluster memberSignalIds. Never invent ids.",
    "  - Group signals into thematic clusters by genuine strategic convergence.",
    "  - Return STRICT JSON matching the provided schema. No markdown, no prose.",
    "",
    "PORTFOLIO:",
    JSON.stringify(projection, null, 2),
  ].join("\n");
}

async function callGeminiReasoning(
  portfolio: ReportSuggestion[]
): Promise<LLMReasoningEnvelope | null> {
  const prompt = buildReasoningPrompt(serializeForLLM(portfolio));
  const ctrl = new AbortController();

  const call = keyManager.call((client, keyMasked) => {
    console.info(
      `[ReasoningEngine] Convergent reasoning via ${REASONING_MODEL}. [${keyMasked}]`
    );
    return client.models.generateContent({
      model: REASONING_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 4096 },
        responseMimeType: "application/json",
        responseSchema: REASONING_SCHEMA as any,
      },
    });
  });

  const response = await withReasoningTimeout(call, REASONING_TIMEOUT_MS, ctrl);

  // `.text` is a getter in current @google/genai, a method in older SDKs.
  const responseAny = response as any;
  const raw =
    typeof responseAny.text === "function"
      ? await responseAny.text()
      : responseAny.text;
  const text = (raw ?? "").trim();
  if (!text) return null;

  // Structured outputs return a single JSON OBJECT envelope. safeJsonParse is
  // array-oriented (extracts the first balanced [...]) and would drop everything
  // outside the edges array, so parse the object directly.
  let cleaned = text;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n/i, "").replace(/\n```$/g, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as LLMReasoningEnvelope;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const MIN_RELATIONSHIP_SCORE = 40;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normalize(text: any) {
  return String(text || "").toLowerCase().trim();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * FNV-1a 32-bit hash → 8-char zero-padded lowercase hex.
 * Uses Math.imul for correct 32-bit integer multiplication. Deterministic,
 * dependency-free: identical input always yields identical output.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime, 32-bit via imul
  }
  return (hash >>> 0).toString(16).padStart(8, "0"); // unsigned, 8 hex chars
}

/**
 * Stable cluster id from a theme label. Replaces the previous Math.random()
 * id so identical signal inputs produce byte-identical cluster ids every run.
 * Normalizes lowercase → trim → collapse internal whitespace before hashing;
 * null/empty/whitespace-only labels fall back to "uncategorized".
 * Output format: `cluster_<8-hex>` (16 chars total).
 */
function deterministicClusterId(thematicCluster: string): string {
  const normalized = String(thematicCluster || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  return `cluster_${fnv1a(normalized || "uncategorized")}`;
}

function calculateSimilarity(a: string, b: string): number {
  const aWords = normalize(a).split(/\s+/);
  const bWords = normalize(b).split(/\s+/);

  const overlap = aWords.filter(word => bWords.includes(word));

  return overlap.length / Math.max(aWords.length, bWords.length);
}

function calculateRelationshipStrength(
  a: ReportSuggestion,
  b: ReportSuggestion
): number {

  let score = 0;

  // Same thematic cluster
  if (
    normalize(a.thematicCluster) ===
    normalize(b.thematicCluster)
  ) {
    score += 35;
  }

  // Same strategic pillar
  if (
    normalize(a.strategicPillar) ===
    normalize(b.strategicPillar)
  ) {
    score += 20;
  }

  // Same vertical
  if (
    normalize(a.vertical) ===
    normalize(b.vertical)
  ) {
    score += 15;
  }

  // Keyword overlap
  const keywordSimilarity = calculateSimilarity(
    a.marketKeyword,
    b.marketKeyword
  );

  score += keywordSimilarity * 20;

  // Buyer overlap
  const buyerSimilarity = calculateSimilarity(
    a.primaryStakeholder,
    b.primaryStakeholder
  );

  score += buyerSimilarity * 10;

  return Math.min(100, Math.round(score));
}

function inferRelationshipType(
  a: ReportSuggestion,
  b: ReportSuggestion
): RelationshipType {

  if (
    normalize(a.thematicCluster) ===
    normalize(b.thematicCluster)
  ) {
    return "Thematic Convergence";
  }

  if (
    normalize(a.strategicPillar) ===
    normalize(b.strategicPillar)
  ) {
    return "Capital Flow Alignment";
  }

  if (
    normalize(a.primaryStakeholder) ===
    normalize(b.primaryStakeholder)
  ) {
    return "Buyer Overlap";
  }

  if (
    normalize(a.vertical) ===
    normalize(b.vertical)
  ) {
    return "Infrastructure Coupling";
  }

  return "Technology Enablement";
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATIONSHIP ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function buildSignalRelationships(
  suggestions: ReportSuggestion[]
): SignalRelationship[] {

  const relationships: SignalRelationship[] = [];

  for (let i = 0; i < suggestions.length; i++) {

    for (let j = i + 1; j < suggestions.length; j++) {

      const a = suggestions[i];
      const b = suggestions[j];

      const strength = calculateRelationshipStrength(a, b);

      if (strength < MIN_RELATIONSHIP_SCORE) continue;

      relationships.push({
        sourceId: a.id,
        targetId: b.id,

        relationshipType: inferRelationshipType(a, b),

        strength,

        rationale:
          `${a.marketKeyword} and ${b.marketKeyword} ` +
          `share overlapping commercial drivers and strategic market dynamics.`,
      });
    }
  }

  return relationships.sort((a, b) => b.strength - a.strength);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTER ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function buildReasoningClusters(
  suggestions: ReportSuggestion[],
  relationships: SignalRelationship[]
): ReasoningCluster[] {

  const clusterMap = new Map<string, ReportSuggestion[]>();

  // Group by thematic cluster
  for (const signal of suggestions) {

    const key = normalize(signal.thematicCluster);

    if (!clusterMap.has(key)) {
      clusterMap.set(key, []);
    }

    clusterMap.get(key)!.push(signal);
  }

  const clusters: ReasoningCluster[] = [];

  for (const [theme, signals] of clusterMap.entries()) {

    const avgScore =
      signals.reduce(
        (sum, s) => sum + (s.opportunityScore || 0),
        0
      ) / signals.length;

    const dominantVerticals = unique(
      signals.map(s => s.vertical)
    );

    const dominantPillars = unique(
      signals.map(s => s.strategicPillar)
    );

    const clusterRelationships = relationships.filter(
      r =>
        signals.some(s => s.id === r.sourceId) &&
        signals.some(s => s.id === r.targetId)
    );

    // relationshipDensity on a 0–1 scale: internal relationships / max possible
    // undirected pairs (matches rehydrateClusters so both paths are consistent).
    const maxPairs = (signals.length * (signals.length - 1)) / 2;
    const density =
      maxPairs === 0 ? 0 : Math.min(1, clusterRelationships.length / maxPairs);

    clusters.push({
      clusterId: deterministicClusterId(theme),

      thematicCluster: theme,

      signals,

      averageOpportunityScore:
        Math.round(avgScore * 10) / 10,

      dominantVerticals,

      dominantPillars,

      relationshipDensity: Math.round(density * 100) / 100,

      strategicNarrative:
        `The ${theme} cluster indicates converging strategic ` +
        `market activity across ${dominantVerticals.join(", ")} ` +
        `with strong alignment around ${dominantPillars.join(", ")}.`,
    });
  }

  return clusters.sort(
    (a, b) =>
      b.averageOpportunityScore -
      a.averageOpportunityScore
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT ASSEMBLY (shared by both the LLM and fallback paths)
// ─────────────────────────────────────────────────────────────────────────────

/** Treat missing/non-numeric opportunityScore as 0. */
function toScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Assemble the final five-field ReasoningResult from validated relationships +
 * rehydrated clusters. Computes strongestSignals (top 10 by opportunityScore)
 * and macroThemes (unique cluster themes merged with any model-supplied themes).
 * Empty portfolio → empty arrays + a non-empty summary (never throws).
 */
function assembleResult(
  portfolio: ReportSuggestion[],
  relationships: SignalRelationship[],
  clusters: ReasoningCluster[],
  modelMacroThemes: string[] = [],
  modelReasoningSummary?: string
): ReasoningResult {
  const strongestSignals = [...portfolio]
    .sort((a, b) => toScore(b.opportunityScore) - toScore(a.opportunityScore))
    .slice(0, 10);

  const macroThemes = unique(
    [...clusters.map(c => c.thematicCluster), ...modelMacroThemes].filter(Boolean)
  );

  const reasoningSummary =
    modelReasoningSummary && modelReasoningSummary.trim().length > 0
      ? modelReasoningSummary
      : `The reasoning engine identified ${relationships.length} strategic ` +
        `relationships across ${clusters.length} thematic clusters.` +
        (macroThemes.length
          ? ` Dominant macro themes include ${macroThemes.slice(0, 5).join(", ")}.`
          : "");

  return { relationships, clusters, strongestSignals, macroThemes, reasoningSummary };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC FALLBACK CORE
//
// The original string-overlap implementation, preserved in behavior (now via
// deterministicClusterId, not Math.random). Used whenever the LLM reasoning
// path fails, guaranteeing a valid ReasoningResult every run.
// ─────────────────────────────────────────────────────────────────────────────

function runDeterministicReasoning(
  suggestions: ReportSuggestion[]
): ReasoningResult {
  const relationships = buildSignalRelationships(suggestions);
  const clusters = buildReasoningClusters(suggestions, relationships);
  return assembleResult(suggestions, relationships, clusters);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE (async — LLM reasoning with total deterministic fallback)
// ─────────────────────────────────────────────────────────────────────────────

export async function runReasoningEngine(
  curatedPortfolio: ReportSuggestion[]
): Promise<ReasoningResult> {
  // Trivial portfolios cannot form relationships — skip the LLM entirely.
  if (curatedPortfolio.length < 2) {
    return runDeterministicReasoning(curatedPortfolio);
  }

  try {
    const byId = new Map(curatedPortfolio.map(s => [s.id, s]));
    const validIds = new Set(byId.keys());

    const envelope = await callGeminiReasoning(curatedPortfolio);
    if (!envelope) {
      throw new Error("Empty or unparseable reasoning envelope");
    }

    const relationships = validateEdges(envelope.edges ?? [], validIds);
    const clusters = rehydrateClusters(envelope.clusters ?? [], relationships, byId);

    // Referential collapse guard: nothing usable survived validation.
    if (relationships.length === 0 && clusters.length === 0) {
      throw new Error("LLM output referentially empty after validation");
    }

    return assembleResult(
      curatedPortfolio,
      relationships,
      clusters,
      envelope.macroThemes ?? [],
      envelope.reasoningSummary
    );
  } catch (err) {
    console.warn(
      `[ReasoningEngine] LLM path failed, using deterministic fallback: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return runDeterministicReasoning(curatedPortfolio);
  }
}
