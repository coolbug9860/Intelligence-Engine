/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Signal Propagation Engine
 * src/services/signalPropagationEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * Simulates how strategic market signals propagate through the
 * intelligence graph ecosystem.
 *
 * This engine transforms static relationships into dynamic influence flows.
 *
 * It enables:
 * - second-order impact tracing
 * - cascading market detection
 * - influence amplification analysis
 * - downstream opportunity discovery
 * - strategic early warning systems
 * - macro convergence forecasting
 *
 * EXAMPLE
 * -------
 * Semiconductor Export Restrictions
 *        ↓
 * GPU Supply Constraints
 *        ↓
 * AI Infrastructure Bottlenecks
 *        ↓
 * Cloud Infrastructure Expansion
 *        ↓
 * Grid Modernization Demand
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  IntelligenceGraph,
  IntelligenceNode,
  IntelligenceEdge,
} from "./intelligenceGraphEngine";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PropagationPath {
  pathId: string;

  originNode: string;

  targetNode: string;

  nodeSequence: string[];

  totalInfluenceScore: number;

  averageEdgeStrength: number;

  propagationDepth: number;

  propagationNarrative: string;
}

export interface InfluenceNode {
  nodeId: string;

  label: string;

  cumulativeInfluence: number;

  inboundConnections: number;

  outboundConnections: number;

  influenceRank: number;
}

export interface PropagationResult {
  paths: PropagationPath[];

  influenceRanking: InfluenceNode[];

  dominantPropagationThemes: string[];

  propagationSummary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PROPAGATION_DEPTH = 4;

const MIN_PROPAGATION_STRENGTH = 40;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function getNodeLabel(
  nodes: IntelligenceNode[],
  id: string
): string {

  return nodes.find(n => n.id === id)?.label || id;
}

function buildAdjacencyMap(
  edges: IntelligenceEdge[]
): Map<string, IntelligenceEdge[]> {

  const adjacency = new Map<string, IntelligenceEdge[]>();

  for (const edge of edges) {

    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }

    adjacency.get(edge.source)!.push(edge);

    // Non-directional edges propagate both ways
    if (!edge.directional) {

      if (!adjacency.has(edge.target)) {
        adjacency.set(edge.target, []);
      }

      adjacency.get(edge.target)!.push({
        ...edge,
        source: edge.target,
        target: edge.source,
      });
    }
  }

  return adjacency;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────

function discoverPropagationPaths(
  graph: IntelligenceGraph
): PropagationPath[] {

  const paths: PropagationPath[] = [];

  const adjacency =
    buildAdjacencyMap(graph.edges);

  function dfs(
    current: string,
    visited: string[],
    cumulativeStrength: number,
    edgeStrengths: number[]
  ) {

    if (visited.length > MAX_PROPAGATION_DEPTH) {
      return;
    }

    const connections =
      adjacency.get(current) || [];

    for (const edge of connections) {

      if (
        edge.strength <
        MIN_PROPAGATION_STRENGTH
      ) {
        continue;
      }

      if (visited.includes(edge.target)) {
        continue;
      }

      const nextVisited = [
        ...visited,
        edge.target,
      ];

      const nextStrengths = [
        ...edgeStrengths,
        edge.strength,
      ];

      const influence =
        cumulativeStrength *
        (edge.strength / 100);

      if (nextVisited.length >= 3) {

        const avgStrength =
          nextStrengths.reduce(
            (a, b) => a + b,
            0
          ) / nextStrengths.length;

        paths.push({
          pathId:
            `path_${Math.random()
              .toString(36)
              .substring(2, 10)}`,

          originNode: visited[0],

          targetNode: edge.target,

          nodeSequence: nextVisited,

          totalInfluenceScore:
            Math.round(influence),

          averageEdgeStrength:
            Math.round(avgStrength),

          propagationDepth:
            nextVisited.length - 1,

          propagationNarrative:
            buildPropagationNarrative(
              graph.nodes,
              nextVisited
            ),
        });
      }

      dfs(
        edge.target,
        nextVisited,
        influence,
        nextStrengths
      );
    }
  }

  // Start propagation from every signal node
  const originNodes =
    graph.nodes.filter(
      n => n.type === "Signal"
    );

  for (const node of originNodes) {

    dfs(
      node.id,
      [node.id],
      node.weight,
      []
    );
  }

  return paths.sort(
    (a, b) =>
      b.totalInfluenceScore -
      a.totalInfluenceScore
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NARRATIVE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

function buildPropagationNarrative(
  nodes: IntelligenceNode[],
  sequence: string[]
): string {

  const labels = sequence.map(id =>
    getNodeLabel(nodes, id)
  );

  return labels.join(" → ");
}

// ─────────────────────────────────────────────────────────────────────────────
// INFLUENCE ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function calculateInfluenceRanking(
  graph: IntelligenceGraph
): InfluenceNode[] {

  return graph.nodes.map(node => {

    const inbound =
      graph.edges.filter(
        e => e.target === node.id
      );

    const outbound =
      graph.edges.filter(
        e => e.source === node.id
      );

    const inboundStrength =
      inbound.reduce(
        (sum, e) => sum + e.strength,
        0
      );

    const outboundStrength =
      outbound.reduce(
        (sum, e) => sum + e.strength,
        0
      );

    const cumulative =
      inboundStrength +
      outboundStrength +
      node.weight;

    return {
      nodeId: node.id,

      label: node.label,

      cumulativeInfluence:
        Math.round(cumulative),

      inboundConnections:
        inbound.length,

      outboundConnections:
        outbound.length,

      influenceRank: 0,
    };
  })
  .sort(
    (a, b) =>
      b.cumulativeInfluence -
      a.cumulativeInfluence
  )
  .map((node, index) => ({
    ...node,
    influenceRank: index + 1,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function runSignalPropagation(
  graph: IntelligenceGraph
): PropagationResult {

  const paths =
    discoverPropagationPaths(graph);

  const influenceRanking =
    calculateInfluenceRanking(graph);

  const dominantPropagationThemes =
    unique(
      graph.nodes
        .filter(
          n =>
            n.type === "Cluster" ||
            n.type === "Market Theme"
        )
        .map(n => n.label)
    ).slice(0, 10);

  const propagationSummary =
    `Propagation engine discovered ` +
    `${paths.length} propagation pathways across ` +
    `${graph.totalNodes} intelligence nodes. ` +
    `Top influence node: ` +
    `${influenceRanking[0]?.label || "N/A"}.`;

  return {
    paths,
    influenceRanking,
    dominantPropagationThemes,
    propagationSummary,
  };
}
