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

import { ReportSuggestion } from "../types";

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

    const density =
      signals.length <= 1
        ? 0
        : Math.round(
            (clusterRelationships.length /
              (signals.length * (signals.length - 1))) * 100
          );

    clusters.push({
      clusterId:
        `cluster_${Math.random().toString(36).substring(2, 10)}`,

      thematicCluster: theme,

      signals,

      averageOpportunityScore:
        Math.round(avgScore * 10) / 10,

      dominantVerticals,

      dominantPillars,

      relationshipDensity: density,

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
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function runReasoningEngine(
  suggestions: ReportSuggestion[]
): ReasoningResult {

  const relationships =
    buildSignalRelationships(suggestions);

  const clusters =
    buildReasoningClusters(
      suggestions,
      relationships
    );

  const strongestSignals = [...suggestions]
    .sort(
      (a, b) =>
        (b.opportunityScore || 0) -
        (a.opportunityScore || 0)
    )
    .slice(0, 10);

  const macroThemes = unique(
    suggestions.map(s => s.thematicCluster)
  );

  const reasoningSummary =
    `The reasoning engine identified ` +
    `${relationships.length} strategic relationships across ` +
    `${clusters.length} thematic clusters. ` +
    `Dominant macro themes include ${macroThemes.slice(0, 5).join(", ")}.`;

  return {
    relationships,
    clusters,
    strongestSignals,
    macroThemes,
    reasoningSummary,
  };
}
