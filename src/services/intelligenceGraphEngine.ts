/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Intelligence Graph Engine
 * src/services/intelligenceGraphEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * Converts reasoning-engine output into a structured intelligence graph.
 *
 * This engine transforms:
 * - isolated opportunities
 * - thematic clusters
 * - strategic relationships
 *
 * into:
 *
 * - graph nodes
 * - graph edges
 * - weighted intelligence pathways
 * - influence maps
 * - propagation-ready structures
 *
 * This becomes the foundation for:
 * - signal propagation analysis
 * - second-order impact tracing
 * - graph-based RAG
 * - strategic dependency mapping
 * - forecasting systems
 * - intelligence explainability
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ReportSuggestion } from "../types";

import {
  SignalRelationship,
  ReasoningCluster,
  ReasoningResult,
} from "./reasoningEngine";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type GraphNodeType =
  | "Signal"
  | "Cluster"
  | "Vertical"
  | "Strategic Pillar"
  | "Market Theme";

export interface IntelligenceNode {
  id: string;

  type: GraphNodeType;

  label: string;

  weight: number;

  metadata: Record<string, any>;
}

export interface IntelligenceEdge {
  id: string;

  source: string;

  target: string;

  relationshipType: string;

  strength: number;

  directional: boolean;

  rationale: string;
}

export interface IntelligenceGraph {
  nodes: IntelligenceNode[];

  edges: IntelligenceEdge[];

  totalNodes: number;

  totalEdges: number;

  dominantThemes: string[];

  dominantVerticals: string[];

  graphDensity: number;

  graphSummary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function createEdgeId(
  source: string,
  target: string
): string {
  return `edge_${source}_${target}`;
}

function safeScore(value?: number): number {
  if (!value || Number.isNaN(value)) return 0;
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildSignalNodes(
  suggestions: ReportSuggestion[]
): IntelligenceNode[] {

  return suggestions.map(signal => ({
    id: signal.id,

    type: "Signal",

    label: signal.marketKeyword,

    weight: safeScore(signal.opportunityScore),

    metadata: {
      reportTitle: signal.reportTitle,
      vertical: signal.vertical,
      strategicPillar: signal.strategicPillar,
      thematicCluster: signal.thematicCluster,
      source: signal.sourceName,
      confidenceScore: signal.confidenceScore,
      opportunityScore: signal.opportunityScore,
    },
  }));
}

function buildClusterNodes(
  clusters: ReasoningCluster[]
): IntelligenceNode[] {

  return clusters.map(cluster => ({
    id: cluster.clusterId,

    type: "Cluster",

    label: cluster.thematicCluster,

    weight: cluster.averageOpportunityScore,

    metadata: {
      dominantVerticals: cluster.dominantVerticals,
      dominantPillars: cluster.dominantPillars,
      relationshipDensity: cluster.relationshipDensity,
      signalCount: cluster.signals.length,
    },
  }));
}

function buildVerticalNodes(
  suggestions: ReportSuggestion[]
): IntelligenceNode[] {

  const verticals = unique(
    suggestions.map(s => s.vertical)
  );

  return verticals.map(vertical => {

    const relatedSignals =
      suggestions.filter(s => s.vertical === vertical);

    const avgWeight =
      relatedSignals.reduce(
        (sum, s) => sum + safeScore(s.opportunityScore),
        0
      ) / relatedSignals.length;

    return {
      id: `vertical_${vertical}`,

      type: "Vertical",

      label: vertical,

      weight: Math.round(avgWeight),

      metadata: {
        signalCount: relatedSignals.length,
      },
    };
  });
}

function buildPillarNodes(
  suggestions: ReportSuggestion[]
): IntelligenceNode[] {

  const pillars = unique(
    suggestions.map(s => s.strategicPillar)
  );

  return pillars.map(pillar => {

    const relatedSignals =
      suggestions.filter(
        s => s.strategicPillar === pillar
      );

    const avgWeight =
      relatedSignals.reduce(
        (sum, s) => sum + safeScore(s.opportunityScore),
        0
      ) / relatedSignals.length;

    return {
      id: `pillar_${pillar}`,

      type: "Strategic Pillar",

      label: pillar,

      weight: Math.round(avgWeight),

      metadata: {
        signalCount: relatedSignals.length,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EDGE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildRelationshipEdges(
  relationships: SignalRelationship[]
): IntelligenceEdge[] {

  return relationships.map(rel => ({
    id: createEdgeId(
      rel.sourceId,
      rel.targetId
    ),

    source: rel.sourceId,

    target: rel.targetId,

    relationshipType: rel.relationshipType,

    strength: rel.strength,

    directional: false,

    rationale: rel.rationale,
  }));
}

function buildClusterMembershipEdges(
  clusters: ReasoningCluster[]
): IntelligenceEdge[] {

  const edges: IntelligenceEdge[] = [];

  for (const cluster of clusters) {

    for (const signal of cluster.signals) {

      edges.push({
        id: createEdgeId(
          signal.id,
          cluster.clusterId
        ),

        source: signal.id,

        target: cluster.clusterId,

        relationshipType: "Cluster Membership",

        strength: 100,

        directional: true,

        rationale:
          `${signal.marketKeyword} belongs to thematic cluster "${cluster.thematicCluster}".`,
      });
    }
  }

  return edges;
}

function buildVerticalEdges(
  suggestions: ReportSuggestion[]
): IntelligenceEdge[] {

  return suggestions.map(signal => ({
    id: createEdgeId(
      signal.id,
      `vertical_${signal.vertical}`
    ),

    source: signal.id,

    target: `vertical_${signal.vertical}`,

    relationshipType: "Vertical Alignment",

    strength: 90,

    directional: true,

    rationale:
      `${signal.marketKeyword} aligns with ${signal.vertical}.`,
  }));
}

function buildPillarEdges(
  suggestions: ReportSuggestion[]
): IntelligenceEdge[] {

  return suggestions.map(signal => ({
    id: createEdgeId(
      signal.id,
      `pillar_${signal.strategicPillar}`
    ),

    source: signal.id,

    target: `pillar_${signal.strategicPillar}`,

    relationshipType: "Strategic Pillar Alignment",

    strength: 90,

    directional: true,

    rationale:
      `${signal.marketKeyword} maps to ${signal.strategicPillar}.`,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

function calculateGraphDensity(
  nodes: number,
  edges: number
): number {

  if (nodes <= 1) return 0;

  const maxEdges = nodes * (nodes - 1);

  return Math.round(
    (edges / maxEdges) * 100
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function buildIntelligenceGraph(
  reasoning: ReasoningResult,
  suggestions: ReportSuggestion[]
): IntelligenceGraph {

  // Nodes
  const signalNodes =
    buildSignalNodes(suggestions);

  const clusterNodes =
    buildClusterNodes(reasoning.clusters);

  const verticalNodes =
    buildVerticalNodes(suggestions);

  const pillarNodes =
    buildPillarNodes(suggestions);

  const nodes: IntelligenceNode[] = [
    ...signalNodes,
    ...clusterNodes,
    ...verticalNodes,
    ...pillarNodes,
  ];

  // Edges
  const relationshipEdges =
    buildRelationshipEdges(
      reasoning.relationships
    );

  const clusterEdges =
    buildClusterMembershipEdges(
      reasoning.clusters
    );

  const verticalEdges =
    buildVerticalEdges(suggestions);

  const pillarEdges =
    buildPillarEdges(suggestions);

  const edges: IntelligenceEdge[] = [
    ...relationshipEdges,
    ...clusterEdges,
    ...verticalEdges,
    ...pillarEdges,
  ];

  const dominantThemes =
    unique(
      suggestions.map(
        s => s.thematicCluster
      )
    ).slice(0, 10);

  const dominantVerticals =
    unique(
      suggestions.map(
        s => s.vertical
      )
    );

  const graphDensity =
    calculateGraphDensity(
      nodes.length,
      edges.length
    );

  const graphSummary =
    `Intelligence graph contains ` +
    `${nodes.length} nodes and ${edges.length} edges ` +
    `across ${dominantThemes.length} macro themes.`;

  return {
    nodes,
    edges,

    totalNodes: nodes.length,

    totalEdges: edges.length,

    dominantThemes,

    dominantVerticals,

    graphDensity,

    graphSummary,
  };
}
