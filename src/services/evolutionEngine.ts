/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Evolution Engine
 * src/services/evolutionEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * The Evolution Engine transforms the platform from a static intelligence
 * processor into an adaptive intelligence system.
 *
 * Previous engines:
 * - extract signals
 * - normalize data
 * - score opportunities
 * - build strategic reasoning
 * - forecast market trajectories
 * - persist memory
 *
 * This engine answers the next critical question:
 *
 *   "Which forecasts were actually correct over time?"
 *
 * The engine continuously compares:
 * - historical forecasts
 * - recurring themes
 * - present intelligence cycles
 * - signal persistence
 * - thematic survival
 *
 * It then recalibrates:
 * - source reliability
 * - cluster strength
 * - forecast trust
 * - strategic confidence
 *
 * RESULT
 * ------
 * The platform gradually becomes:
 * - less reactive
 * - less noisy
 * - more historically calibrated
 * - more institutionally intelligent
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  ForecastCluster,
  ForecastClassification,
} from './forecastEngine';

import {
  MemorySnapshot,
  ClusterMemoryRecord,
} from './memoryEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvolutionInput {
  currentForecasts: ForecastCluster[];
  historicalMemory: MemorySnapshot[];
}

export interface EvolvedClusterAssessment {
  cluster: string;

  /**
   * Historical survival rate:
   * How often this cluster reappeared over time.
   */
  recurrenceScore: number;

  /**
   * Forecast stability:
   * Did the cluster remain structurally important?
   */
  persistenceScore: number;

  /**
   * Forecast accuracy:
   * Did prior classifications prove durable?
   */
  forecastAccuracyScore: number;

  /**
   * Momentum trajectory:
   * Accelerating / Stable / Weakening / Collapsing
   */
  trajectory: EvolutionTrajectory;

  /**
   * Confidence multiplier generated from historical behavior.
   * Used later to influence future opportunity scoring.
   */
  intelligenceWeight: number;

  /**
   * Strategic interpretation for UI/reporting.
   */
  narrative: string;
}

export type EvolutionTrajectory =
  | 'Accelerating'
  | 'Stable'
  | 'Weakening'
  | 'Collapsing';

export interface EvolutionReport {
  generatedAt: string;

  totalClustersAnalyzed: number;

  acceleratingClusters: number;
  stableClusters: number;
  weakeningClusters: number;
  collapsingClusters: number;

  strongestCluster?: string;
  weakestCluster?: string;

  averageForecastAccuracy: number;

  warnings: string[];

  assessments: EvolvedClusterAssessment[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLASSIFICATION_STRENGTH: Record<ForecastClassification, number> = {
  Transient: 1,
  Emerging: 2,
  Structural: 3,
  Supercycle: 4,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function determineTrajectory(
  recurrence: number,
  persistence: number,
  forecastAccuracy: number
): EvolutionTrajectory {

  const composite =
    recurrence * 0.35 +
    persistence * 0.35 +
    forecastAccuracy * 0.30;

  if (composite >= 80) return 'Accelerating';
  if (composite >= 60) return 'Stable';
  if (composite >= 40) return 'Weakening';

  return 'Collapsing';
}

function buildNarrative(
  cluster: string,
  trajectory: EvolutionTrajectory,
  recurrence: number,
  persistence: number
): string {

  switch (trajectory) {
    case 'Accelerating':
      return `"${cluster}" demonstrates sustained recurrence and structural persistence across intelligence cycles, indicating durable strategic momentum.`;

    case 'Stable':
      return `"${cluster}" maintains consistent strategic relevance with moderate long-term persistence signals.`;

    case 'Weakening':
      return `"${cluster}" shows declining structural continuity and weakening recurrence across recent cycles.`;

    case 'Collapsing':
      return `"${cluster}" appears increasingly transient with low historical persistence and weak recurrence behavior.`;
  }
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

export function evolveIntelligence(
  input: EvolutionInput
): EvolutionReport {

  const { currentForecasts, historicalMemory } = input;

  const warnings: string[] = [];

  if (!currentForecasts.length) {
    warnings.push('No forecast clusters supplied to evolution engine.');
  }

  if (!historicalMemory.length) {
    warnings.push('No historical memory available. Evolution calibration limited.');
  }

  // Build historical lookup
  const historicalClusters = new Map<string, ClusterMemoryRecord[]>();

  for (const snapshot of historicalMemory) {
    for (const cluster of snapshot.clusters) {

      const existing = historicalClusters.get(cluster.cluster) ?? [];

      existing.push(cluster);

      historicalClusters.set(cluster.cluster, existing);
    }
  }

  const assessments: EvolvedClusterAssessment[] = [];

  for (const current of currentForecasts) {

    const history =
      historicalClusters.get(current.thematicCluster) ?? [];

    // ───────────────────────────────────────────────────────────────────────
    // Recurrence Score
    // How often the cluster survived across memory snapshots
    // ───────────────────────────────────────────────────────────────────────

    const recurrenceScore = clamp(
      (history.length / Math.max(historicalMemory.length, 1)) * 100,
      0,
      100
    );

    // ───────────────────────────────────────────────────────────────────────
    // Persistence Score
    // Based on historical classification durability
    // ───────────────────────────────────────────────────────────────────────

    const persistenceValues = history.map(h =>
      CLASSIFICATION_STRENGTH[h.classification]
    );

    const persistenceScore = clamp(
      average(persistenceValues) * 25,
      0,
      100
    );

    // ───────────────────────────────────────────────────────────────────────
    // Forecast Accuracy
    // Compare historical classification strength
    // with current classification strength
    // ───────────────────────────────────────────────────────────────────────

    const currentStrength =
      CLASSIFICATION_STRENGTH[current.dominantClassification];

    const accuracySamples = history.map(h => {

      const historicalStrength =
        CLASSIFICATION_STRENGTH[h.classification];

      const difference =
        Math.abs(currentStrength - historicalStrength);

      return clamp(100 - difference * 25, 0, 100);
    });

    const forecastAccuracyScore =
      average(accuracySamples);

    // ───────────────────────────────────────────────────────────────────────
    // Trajectory
    // ───────────────────────────────────────────────────────────────────────

    const trajectory = determineTrajectory(
      recurrenceScore,
      persistenceScore,
      forecastAccuracyScore
    );

    // ───────────────────────────────────────────────────────────────────────
    // Intelligence Weight
    // Used later to influence scoring systems
    // ───────────────────────────────────────────────────────────────────────

    let intelligenceWeight =
      recurrenceScore * 0.35 +
      persistenceScore * 0.35 +
      forecastAccuracyScore * 0.30;

    if (trajectory === 'Accelerating') {
      intelligenceWeight += 10;
    }

    if (trajectory === 'Collapsing') {
      intelligenceWeight -= 10;
    }

    intelligenceWeight = clamp(
      parseFloat(intelligenceWeight.toFixed(2)),
      0,
      100
    );

    const narrative = buildNarrative(
      current.thematicCluster,
      trajectory,
      recurrenceScore,
      persistenceScore
    );

    assessments.push({
      cluster: current.thematicCluster,
      recurrenceScore: parseFloat(recurrenceScore.toFixed(2)),
      persistenceScore: parseFloat(persistenceScore.toFixed(2)),
      forecastAccuracyScore: parseFloat(forecastAccuracyScore.toFixed(2)),
      trajectory,
      intelligenceWeight,
      narrative,
    });
  }

  // ─── Summary Metrics ──────────────────────────────────────────────────────

  const acceleratingClusters =
    assessments.filter(a => a.trajectory === 'Accelerating').length;

  const stableClusters =
    assessments.filter(a => a.trajectory === 'Stable').length;

  const weakeningClusters =
    assessments.filter(a => a.trajectory === 'Weakening').length;

  const collapsingClusters =
    assessments.filter(a => a.trajectory === 'Collapsing').length;

  const sortedByWeight =
    [...assessments].sort(
      (a, b) => b.intelligenceWeight - a.intelligenceWeight
    );

  const strongestCluster = sortedByWeight[0]?.cluster;
  const weakestCluster =
    sortedByWeight[sortedByWeight.length - 1]?.cluster;

  const averageForecastAccuracy = parseFloat(
    average(
      assessments.map(a => a.forecastAccuracyScore)
    ).toFixed(2)
  );

  return {
    generatedAt: new Date().toISOString(),

    totalClustersAnalyzed: assessments.length,

    acceleratingClusters,
    stableClusters,
    weakeningClusters,
    collapsingClusters,

    strongestCluster,
    weakestCluster,

    averageForecastAccuracy,

    warnings,

    assessments,
  };
}
