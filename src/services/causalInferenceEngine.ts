import {
  BenchmarkResult,
  CausalEdge,
  CausalNode,
  CausalPath,
  CausalType,
  ConfidenceScore,
  createConfidenceScore,
  Evidence,
  InfluenceScore,
  InterventionAnalysis,
  PropagationDirection,
  PropagationResult,
  RetrievalResult,
  RootCauseAnalysis,
  SimulationResult,
  TemporalRelation,
  UUID,
  calculatePropagationStrength,
  calculateWeightedConfidence,
  normalizeInfluence,
} from './schemaRegistry';

/**
 * Kaiso Research AI
 * Causal Inference Engine
 *
 * Purpose:
 * Deterministic causal estimation and propagation infrastructure.
 *
 * Architectural Constraints:
 * - deterministic reasoning only
 * - evidence-grounded inference
 * - modular engine isolation
 * - measurable propagation analysis
 * - no autonomous causal hallucination
 */

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export interface CausalInferenceInput {
  retrievals?: RetrievalResult[];
  evidence?: Evidence[];
  simulations?: SimulationResult[];
  benchmarks?: BenchmarkResult[];
  nodes?: CausalNode[];
  edges?: CausalEdge[];
}

export interface CausalInferenceResult {
  nodes: CausalNode[];
  edges: CausalEdge[];
  inferredPaths: CausalPath[];
  influenceScores: InfluenceScore[];
  systemicConfidence: ConfidenceScore;
  metadata: {
    totalNodes: number;
    totalEdges: number;
    generatedPaths: number;
    generatedAt: string;
  };
}

export interface CausalTraversalOptions {
  maxDepth?: number;
  minimumInfluence?: number;
  includeIndirect?: boolean;
}

export interface RootCauseOptions {
  maxDepth?: number;
  minimumConfidence?: number;
}

export interface InterventionOptions {
  maxPropagationDepth?: number;
  minimumEffectThreshold?: number;
}

/* -------------------------------------------------------------------------- */
/*                            Internal Graph Structures                       */
/* -------------------------------------------------------------------------- */

interface AdjacencyMap {
  [nodeId: string]: CausalEdge[];
}

/* -------------------------------------------------------------------------- */
/*                         Causal Inference Engine Class                      */
/* -------------------------------------------------------------------------- */

export class CausalInferenceEngine {
  private nodes: Map<UUID, CausalNode>;
  private edges: CausalEdge[];
  private adjacencyMap: AdjacencyMap;

  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.adjacencyMap = {};
  }

  /* ------------------------------------------------------------------------ */
  /*                           Primary Inference Flow                         */
  /* ------------------------------------------------------------------------ */

  public infer(
    input: CausalInferenceInput,
  ): CausalInferenceResult {
    this.reset();

    this.ingestNodes(input.nodes ?? []);
    this.ingestEdges(input.edges ?? []);

    this.constructGraphFromRetrievals(input.retrievals ?? []);
    this.integrateEvidence(input.evidence ?? []);
    this.integrateSimulations(input.simulations ?? []);

    const inferredPaths = this.generatePropagationPaths();
    const influenceScores = this.calculateInfluenceScores();

    const systemicConfidence = calculateWeightedConfidence(
      this.edges.map((edge) => edge.confidence.value),
    );

    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      inferredPaths,
      influenceScores,
      systemicConfidence,
      metadata: {
        totalNodes: this.nodes.size,
        totalEdges: this.edges.length,
        generatedPaths: inferredPaths.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /* ------------------------------------------------------------------------ */
  /*                              Root Cause Logic                            */
  /* ------------------------------------------------------------------------ */

  public analyzeRootCause(
    targetNodeId: UUID,
    options: RootCauseOptions = {},
  ): RootCauseAnalysis {
    const maxDepth = options.maxDepth ?? 4;

    const upstreamPaths = this.traceUpstream(
      targetNodeId,
      maxDepth,
    );

    const probableCauses = Array.from(
      new Set(
        upstreamPaths.flatMap((path) => path.nodeSequence),
      ),
    ).filter((id) => id !== targetNodeId);

    const confidence = calculateWeightedConfidence(
      upstreamPaths.map((path) => path.cumulativeConfidence),
    );

    return {
      targetNodeId,
      probableCauses,
      supportingPaths: upstreamPaths,
      confidence,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*                           Downstream Propagation                         */
  /* ------------------------------------------------------------------------ */

  public propagateInfluence(
    originNodeId: UUID,
    options: CausalTraversalOptions = {},
  ): PropagationResult {
    const maxDepth = options.maxDepth ?? 5;

    const paths = this.traceDownstream(
      originNodeId,
      maxDepth,
    );

    const affectedNodes = Array.from(
      new Set(paths.flatMap((path) => path.nodeSequence)),
    ).filter((id) => id !== originNodeId);

    const totalPropagationStrength = calculatePropagationStrength(
      paths.map((path) => path.cumulativeInfluence),
    );

    const confidence = calculateWeightedConfidence(
      paths.map((path) => path.cumulativeConfidence),
    );

    return {
      originNodeId,
      affectedNodes,
      totalPropagationStrength,
      propagationPaths: paths,
      confidence,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*                           Intervention Estimation                        */
  /* ------------------------------------------------------------------------ */

  public analyzeIntervention(
    interventionNodeId: UUID,
    options: InterventionOptions = {},
  ): InterventionAnalysis {
    const propagation = this.propagateInfluence(
      interventionNodeId,
      {
        maxDepth: options.maxPropagationDepth ?? 4,
      },
    );

    const estimatedEffectStrength =
      propagation.totalPropagationStrength;

    return {
      interventionNodeId,
      projectedImpacts: propagation.affectedNodes,
      estimatedEffectStrength,
      systemicRisk: Math.abs(estimatedEffectStrength),
      confidence: propagation.confidence,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*                             Graph Construction                           */
  /* ------------------------------------------------------------------------ */

  private ingestNodes(nodes: CausalNode[]): void {
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
  }

  private ingestEdges(edges: CausalEdge[]): void {
    for (const edge of edges) {
      this.edges.push(edge);
      this.registerEdge(edge);
    }
  }

  private constructGraphFromRetrievals(
    retrievals: RetrievalResult[],
  ): void {
    for (const retrieval of retrievals) {
      const sourceNodeId = retrieval.id;

      this.ensureNodeExists(sourceNodeId, retrieval.query);

      for (const match of retrieval.matches) {
        this.ensureNodeExists(
          match.targetId,
          match.targetId,
        );

        const edge: CausalEdge = {
          id: this.generateId(),
          createdAt: Date.now(), // Fixed: registry expects number
          semanticVersion: '1.0.0',
          status: 'active' as any,
          sourceNodeId,
          targetNodeId: match.targetId,
          causalType: CausalType.CORRELATED_ONLY,
          temporalRelation: TemporalRelation.TRANSIENT,
          direction: PropagationDirection.DOWNSTREAM,
          influenceStrength: normalizeInfluence(
            match.relevanceScore,
          ),
          confidence: retrieval.retrievalConfidence,
        };

        this.edges.push(edge);
        this.registerEdge(edge);
      }
    }
  }

  private integrateEvidence(
    evidenceList: Evidence[],
  ): void {
    for (const evidence of evidenceList) {
      const relatedEdges = this.edges.filter(
        (edge) =>
          edge.sourceNodeId === evidence.id ||
          edge.targetNodeId === evidence.id,
      );

      for (const edge of relatedEdges) {
        edge.confidence = calculateWeightedConfidence([
          edge.confidence.value,
          evidence.confidence.value,
        ]);

        edge.causalType =
          evidence.corroborationScore &&
          evidence.corroborationScore > 0.7
            ? CausalType.DIRECT
            : edge.causalType;
      }
    }
  }

  private integrateSimulations(
    simulations: SimulationResult[],
  ): void {
    for (const simulation of simulations) {
      for (const edge of this.edges) {
        const reinforcement =
          simulation.resilienceScore * 0.1;

        edge.influenceStrength = normalizeInfluence(
          edge.influenceStrength + reinforcement,
        );
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                             Path Generation                              */
  /* ------------------------------------------------------------------------ */

  private generatePropagationPaths(): CausalPath[] {
    const paths: CausalPath[] = [];

    for (const nodeId of this.nodes.keys()) {
      const downstreamPaths = this.traceDownstream(
        nodeId,
        3,
      );

      paths.push(...downstreamPaths);
    }

    return paths;
  }

  private traceDownstream(
    originNodeId: UUID,
    maxDepth: number,
    visited = new Set<UUID>(),
    currentPath: UUID[] = [],
  ): CausalPath[] {
    if (maxDepth <= 0 || visited.has(originNodeId)) {
      return [];
    }

    visited.add(originNodeId);

    const edges = this.adjacencyMap[originNodeId] ?? [];

    const paths: CausalPath[] = [];

    for (const edge of edges) {
      const sequence = [...currentPath, edge.targetNodeId];

      const path: CausalPath = {
        pathId: this.generateId(),
        nodeSequence: [originNodeId, ...sequence],
        cumulativeInfluence: edge.influenceStrength,
        cumulativeConfidence: edge.confidence.value,
        propagationDepth: sequence.length,
      };

      paths.push(path);

      const nested = this.traceDownstream(
        edge.targetNodeId,
        maxDepth - 1,
        new Set(visited),
        sequence,
      );

      paths.push(...nested);
    }

    return paths;
  }

  private traceUpstream(
    targetNodeId: UUID,
    maxDepth: number,
  ): CausalPath[] {
    const reverseEdges = this.edges.filter(
      (edge) => edge.targetNodeId === targetNodeId,
    );

    const paths: CausalPath[] = [];

    for (const edge of reverseEdges) {
      const path: CausalPath = {
        pathId: this.generateId(),
        nodeSequence: [edge.sourceNodeId, targetNodeId],
        cumulativeInfluence: edge.influenceStrength,
        cumulativeConfidence: edge.confidence.value,
        propagationDepth: 1,
      };

      paths.push(path);

      if (maxDepth > 1) {
        const nested = this.traceUpstream(
          edge.sourceNodeId,
          maxDepth - 1,
        );

        paths.push(...nested);
      }
    }

    return paths;
  }

  /* ------------------------------------------------------------------------ */
  /*                          Influence Scoring Logic                         */
  /* ------------------------------------------------------------------------ */

  private calculateInfluenceScores(): InfluenceScore[] {
    const scores: InfluenceScore[] = [];

    for (const nodeId of this.nodes.keys()) {
      const outgoing = this.edges.filter(
        (edge) => edge.sourceNodeId === nodeId,
      );

      const incoming = this.edges.filter(
        (edge) => edge.targetNodeId === nodeId,
      );

      const downstreamInfluence = calculatePropagationStrength(
        outgoing.map((edge) => edge.influenceStrength),
      );

      const upstreamInfluence = calculatePropagationStrength(
        incoming.map((edge) => edge.influenceStrength),
      );

      const confidence = calculateWeightedConfidence([
        ...outgoing.map((edge) => edge.confidence.value),
        ...incoming.map((edge) => edge.confidence.value),
      ]);

      scores.push({
        nodeId,
        upstreamInfluence,
        downstreamInfluence,
        centralityScore:
          Math.abs(upstreamInfluence) +
          Math.abs(downstreamInfluence),
        confidence,
      });
    }

    return scores;
  }

  /* ------------------------------------------------------------------------ */
  /*                               Graph Helpers                              */
  /* ------------------------------------------------------------------------ */

  private registerEdge(edge: CausalEdge): void {
    if (!this.adjacencyMap[edge.sourceNodeId]) {
      this.adjacencyMap[edge.sourceNodeId] = [];
    }

    this.adjacencyMap[edge.sourceNodeId].push(edge);
  }

  private ensureNodeExists(
    nodeId: UUID,
    label: string,
  ): void {
    if (this.nodes.has(nodeId)) return;

    this.nodes.set(nodeId, {
      id: nodeId,
      createdAt: Date.now(), // Fixed: registry expects number
      semanticVersion: '1.0.0',
      status: 'active' as any,
      label,
      category: 'inferred', // Added missing required property
      confidence: createConfidenceScore(0.5),
    });
  }

  private reset(): void {
    this.nodes.clear();
    this.edges = [];
    this.adjacencyMap = {};
  }

  private generateId(): UUID {
    return `causal_${Math.random()
      .toString(36)
      .slice(2, 12)}`;
  }
}

/* -------------------------------------------------------------------------- */
/*                            Singleton Engine Export                         */
/* -------------------------------------------------------------------------- */

export const causalInferenceEngine =
  new CausalInferenceEngine();

export default causalInferenceEngine;
