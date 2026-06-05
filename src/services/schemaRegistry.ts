export type UUID = string;

/**
 * Kaiso Intelligence Architecture
 * Canonical Ontology & Semantic Governance Layer
 *
 * This registry defines the shared semantic contracts used across
 * all intelligence engines. It serves as the single source of truth
 * for deterministic intelligence modeling.
 *
 * Architectural Principles:
 * - Ontology before Orchestration: Define the "what" before the "how".
 * - Evidence before Confidence: Confidence must be anchored in provenance.
 * - Measurement before Optimization: All intelligence must be benchmarkable.
 * - Determinism before Autonomy: Logic flows must be traceable and repeatable.
 */

/* -------------------------------------------------------------------------- */
/*                               Core Constants                               */
/* -------------------------------------------------------------------------- */

export const SEMANTIC_VERSION = "2.0.0";

export const NORMALIZATION_RANGES = {
  confidence: { min: 0, max: 1 },
  relevance: { min: 0, max: 1 },
  influence: { min: -1, max: 1 },
  uncertainty: { min: 0, max: 1 },
  resilience: { min: 0, max: 1 },
  benchmark: { min: 0, max: 100 },
} as const;

/* -------------------------------------------------------------------------- */
/*                                 Enumerations                               */
/* -------------------------------------------------------------------------- */

export enum IntelligenceStatus {
  ACTIVE = "active",
  STALE = "stale",
  ARCHIVED = "archived",
  INVALIDATED = "invalidated",
}

export enum ConfidenceBand {
  VERY_LOW = "very_low",
  LOW = "low",
  MODERATE = "moderate",
  HIGH = "high",
  VERY_HIGH = "very_high",
}

export enum SignalType {
  TREND = "trend",
  EVENT = "event",
  MARKET = "market",
  TECHNOLOGY = "technology",
  RESEARCH = "research",
  BEHAVIOR = "behavior",
  FINANCIAL = "financial",
  REGULATORY = "regulatory",
  GEOPOLITICAL = "geopolitical",
  SOCIAL = "social",
}

export enum ForecastClassification {
  EMERGING = "emerging",
  GROWING = "growing",
  STABLE = "stable",
  DECLINING = "declining",
  DISRUPTIVE = "disruptive",
}

export enum RecommendationType {
  STRATEGIC = "strategic",
  DEFENSIVE = "defensive",
  OPPORTUNISTIC = "opportunistic",
  CORRECTIVE = "corrective",
  EXPLORATORY = "exploratory",
}

export enum EvidenceType {
  PRIMARY = "primary",
  SECONDARY = "secondary",
  DERIVED = "derived",
  INFERRED = "inferred",
  SIMULATED = "simulated",
}

export enum RelationshipType {
  CAUSAL = "causal",
  CORRELATED = "correlated",
  DEPENDENT = "dependent",
  COMPETITIVE = "competitive",
  SUPPORTIVE = "supportive",
  TEMPORAL = "temporal",
  HIERARCHICAL = "hierarchical",
  SEMANTIC = "semantic",
}

export enum RetrievalType {
  ENTITY_MATCH = "entity_match",
  SEMANTIC_MATCH = "semantic_match",
  TEMPORAL_MATCH = "temporal_match",
  RECURRENCE_MATCH = "recurrence_match",
  CONTEXTUAL_MATCH = "contextual_match",
}

export enum SimulationType {
  STRESS_TEST = "stress_test",
  PERTURBATION = "perturbation",
  COUNTERFACTUAL = "counterfactual",
  RESILIENCE = "resilience",
  SENSITIVITY = "sensitivity",
}

export enum BenchmarkType {
  RETRIEVAL = "retrieval",
  RECOMMENDATION = "recommendation",
  EVIDENCE = "evidence",
  SIMULATION = "simulation",
  CAUSAL = "causal",
  SYSTEMIC = "systemic",
}

export enum CausalType {
  DIRECT = "direct",
  INDIRECT = "indirect",
  REINFORCING = "reinforcing",
  INHIBITING = "inhibiting",
  CASCADING = "cascading",
  CORRELATED_ONLY = "correlated_only",
}

export enum TemporalRelation {
  IMMEDIATE = "immediate",
  DELAYED = "delayed",
  PERSISTENT = "persistent",
  TRANSIENT = "transient",
}

export enum PropagationDirection {
  UPSTREAM = "upstream",
  DOWNSTREAM = "downstream",
  BIDIRECTIONAL = "bidirectional",
}

export enum EntityType {
  ORGANIZATION = "organization",
  PERSON = "person",
  TECHNOLOGY = "technology",
  MARKET = "market",
  COUNTRY = "country",
  PRODUCT = "product",
  INDUSTRY = "industry",
  RESEARCH_DOMAIN = "research_domain",
  TOPIC = "topic",
}

/* -------------------------------------------------------------------------- */
/*                              Foundational Types                            */
/* -------------------------------------------------------------------------- */

export interface ConfidenceScore {
  value: number;
  band: ConfidenceBand;
  uncertainty: number;
  evidenceWeight?: number;
  benchmarkWeight?: number;
  reasoning?: string[];
}

export interface BaseIntelligenceObject {
  id: UUID;
  createdAt: number;
  updatedAt?: number;
  semanticVersion: string;
  status: IntelligenceStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProvenanceReference {
  sourceId: string;
  sourceType: string;
  origin?: string;
  timestamp?: number;
  reliability?: number;
  url?: string;
}

export interface SemanticVector {
  dimensions: number;
  embeddingModel: string;
  vector: number[];
}

/* -------------------------------------------------------------------------- */
/*                              Evidence Structures                           */
/* -------------------------------------------------------------------------- */

export interface Evidence extends BaseIntelligenceObject {
  type: EvidenceType;
  title: string;
  summary?: string;
  confidence: ConfidenceScore;
  provenance: ProvenanceReference[];
  corroborationScore: number;
  contradictionScore: number;
  reliabilityScore: number;
}

/* -------------------------------------------------------------------------- */
/*                            Core Intelligence Objects                        */
/* -------------------------------------------------------------------------- */

export interface Signal extends BaseIntelligenceObject {
  type: SignalType;
  title: string;
  description?: string;
  importanceWeight: number; // Replaces 'score' for semantic clarity
  confidence: ConfidenceScore;
  sourceReference?: ProvenanceReference;
  timestamp: number;
  entities: string[];
  embedding?: SemanticVector;
}

export interface Entity extends BaseIntelligenceObject {
  name: string;
  type: EntityType;
  aliases?: string[];
  taxonomy?: string[];
  confidence: ConfidenceScore;
}

export interface Relationship extends BaseIntelligenceObject {
  sourceId: UUID;
  targetId: UUID;
  type: RelationshipType;
  strength: number;
  confidence: ConfidenceScore;
  evidenceIds?: UUID[];
}

export interface Cluster extends BaseIntelligenceObject {
  title: string;
  signalIds: UUID[];
  verticals: string[];
  pillar?: string;
  clusterScore: number;
  confidence: ConfidenceScore;
}

export interface Forecast extends BaseIntelligenceObject {
  clusterId: UUID;
  classification: ForecastClassification;
  forecastScore: number;
  forecastHorizon?: string;
  confidence: ConfidenceScore;
  signalIds: UUID[];
  supportingEvidence?: UUID[];
}

export interface Priority extends BaseIntelligenceObject {
  clusterId: UUID;
  priorityScore: number;
  urgency: number;
  impact: number;
  strategicValue: number;
  confidence: ConfidenceScore;
}

export interface Recommendation extends BaseIntelligenceObject {
  clusterId: UUID;
  type: RecommendationType;
  title: string;
  description: string;
  recommendationScore: number;
  confidence: ConfidenceScore;
  supportingSignals: UUID[];
  supportingEvidence: UUID[];
  verticals: string[];
  projectedImpact?: number;
}

/* -------------------------------------------------------------------------- */
/*                              Retrieval Structures                          */
/* -------------------------------------------------------------------------- */

export interface RetrievalMatch {
  targetId: UUID;
  type: RetrievalType;
  relevanceScore: number;
  recurrenceScore?: number;
  semanticSimilarity?: number;
  temporalSimilarity?: number;
}

export interface RetrievalResult extends BaseIntelligenceObject {
  query: string;
  matches: RetrievalMatch[];
  confidence: ConfidenceScore;
  retrievalConfidence: ConfidenceScore; // Added for causal engine compatibility
}

/* -------------------------------------------------------------------------- */
/*                             Simulation Structures                          */
/* -------------------------------------------------------------------------- */

export interface SimulationScenario {
  id: UUID;
  name: string;
  description?: string;
  perturbationStrength: number;
}

export interface SimulationResult extends BaseIntelligenceObject {
  type: SimulationType;
  scenarioId: UUID;
  resilienceScore: number;
  uncertaintyScore: number;
  projectedEffects: string[];
  confidence: ConfidenceScore;
}

/* -------------------------------------------------------------------------- */
/*                             Benchmark Structures                           */
/* -------------------------------------------------------------------------- */

export interface BenchmarkMetric {
  metric: string;
  score: number;
  previousScore?: number;
  drift?: number;
  threshold?: number;
}

export interface BenchmarkResult extends BaseIntelligenceObject {
  type: BenchmarkType;
  metrics: BenchmarkMetric[];
  overallHealth: number;
  degradationDetected: boolean;
}

/* -------------------------------------------------------------------------- */
/*                           Causal Intelligence Layer                        */
/* -------------------------------------------------------------------------- */

export interface CausalNode extends BaseIntelligenceObject {
  label: string;
  category: string;
  confidence: ConfidenceScore;
  evidenceRefs?: UUID[];
  state?: Record<string, unknown>;
}

export interface CausalEdge extends BaseIntelligenceObject {
  sourceNodeId: UUID;
  targetNodeId: UUID;
  causalType: CausalType;
  temporalRelation: TemporalRelation;
  direction: PropagationDirection;
  influenceStrength: number;
  confidence: ConfidenceScore;
  evidenceRefs?: UUID[];
  propagationDelay?: number;
}

export interface CausalPath {
  pathId: UUID;
  nodeSequence: UUID[];
  cumulativeInfluence: number;
  cumulativeConfidence: number;
  propagationDepth: number;
}

export interface InfluenceImpact {
  nodeId: UUID;
  upstreamInfluence: number;
  downstreamInfluence: number;
  centralityScore: number;
  confidence: ConfidenceScore;
}

export interface InfluenceScore {
  nodeId: UUID;
  upstreamInfluence: number;
  downstreamInfluence: number;
  centralityScore: number;
  confidence: ConfidenceScore;
}

export interface RootCauseAnalysis {
  targetNodeId: UUID;
  probableCauses: UUID[];
  supportingPaths: CausalPath[];
  confidence: ConfidenceScore;
}

export interface PropagationResult {
  originNodeId: UUID;
  affectedNodes: UUID[];
  totalPropagationStrength: number;
  propagationPaths: CausalPath[];
  confidence: ConfidenceScore;
}

export interface InterventionAnalysis {
  interventionNodeId: UUID;
  projectedImpacts: UUID[];
  estimatedEffectStrength: number;
  systemicRisk: number;
  confidence: ConfidenceScore;
}

/* -------------------------------------------------------------------------- */
/*                           Validation & Normalization                       */
/* -------------------------------------------------------------------------- */

export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function normalizeConfidence(value: number): number {
  // Handle percentage inputs gracefully
  if (value > 1 && value <= 100) return value / 100;
  return clamp(value);
}

export function normalizeScore(value: number): number {
  return clamp(value);
}

export function normalizeInfluence(value: number): number {
  return clamp(value, -1, 1);
}

export function deriveConfidenceBand(value: number): ConfidenceBand {
  const normalized = normalizeConfidence(value);
  if (normalized >= 0.9) return ConfidenceBand.VERY_HIGH;
  if (normalized >= 0.7) return ConfidenceBand.HIGH;
  if (normalized >= 0.4) return ConfidenceBand.MODERATE;
  if (normalized >= 0.2) return ConfidenceBand.LOW;
  return ConfidenceBand.VERY_LOW;
}

export function createConfidenceScore(
  value: number,
  uncertainty = 0,
  reasoning: string[] = []
): ConfidenceScore {
  const normalizedValue = normalizeConfidence(value);
  return {
    value: normalizedValue,
    band: deriveConfidenceBand(normalizedValue),
    uncertainty: clamp(uncertainty),
    reasoning,
  };
}

/* -------------------------------------------------------------------------- */
/*                             Validation Utilities                           */
/* -------------------------------------------------------------------------- */

export function isValidUUID(value: unknown): value is UUID {
  return typeof value === "string" && value.length > 0;
}

export function validateConfidenceScore(confidence: ConfidenceScore): boolean {
  return (
    confidence.value >= 0 &&
    confidence.value <= 1 &&
    confidence.uncertainty >= 0 &&
    confidence.uncertainty <= 1
  );
}

/* -------------------------------------------------------------------------- */
/*                           Deterministic Semantic Helpers                   */
/* -------------------------------------------------------------------------- */

export function calculateWeightedConfidence(scores: number[]): ConfidenceScore {
  if (!scores.length) return createConfidenceScore(0, 1, ["No scores provided"]);
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((a, b) => a + Math.pow(b - average, 2), 0) / scores.length;
  return createConfidenceScore(average, variance);
}

export function calculatePropagationStrength(influences: number[]): number {
  if (!influences.length) return 0;
  // Deterministic aggregation of influence
  return normalizeInfluence(influences.reduce((a, b) => a + b, 0) / influences.length);
}

/* -------------------------------------------------------------------------- */
/*                              Canonical Registry Export                     */
/* -------------------------------------------------------------------------- */

export const SchemaRegistry = {
  semanticVersion: SEMANTIC_VERSION,
  normalizationRanges: NORMALIZATION_RANGES,
  enums: {
    IntelligenceStatus,
    ConfidenceBand,
    SignalType,
    ForecastClassification,
    RecommendationType,
    EvidenceType,
    RelationshipType,
    RetrievalType,
    SimulationType,
    BenchmarkType,
    CausalType,
    TemporalRelation,
    PropagationDirection,
    EntityType,
  },
  validators: {
    isValidUUID,
    validateConfidenceScore,
  },
  normalization: {
    normalizeConfidence,
    normalizeScore,
    normalizeInfluence,
  },
  helpers: {
    deriveConfidenceBand,
    createConfidenceScore,
    calculateWeightedConfidence,
  },
} as const;

export default SchemaRegistry;
