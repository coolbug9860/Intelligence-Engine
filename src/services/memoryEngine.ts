
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Memory Engine
 * src/services/memoryEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * Persistent longitudinal intelligence memory system.
 *
 * The Memory Engine transforms the platform from:
 *   reactive intelligence
 * into:
 *   historical + evolving intelligence.
 *
 * CORE RESPONSIBILITIES
 * ---------------------
 * 1. Persist intelligence cycles
 * 2. Track recurring themes
 * 3. Measure signal persistence
 * 4. Monitor forecast evolution
 * 5. Detect accelerating macro-patterns
 * 6. Build longitudinal market memory
 *
 * WHY THIS MATTERS
 * ----------------
 * Without memory:
 * - every intelligence cycle is isolated,
 * - forecasts reset every run,
 * - recurring themes are forgotten.
 *
 * With memory:
 * - strategic persistence becomes measurable,
 * - supercycles become detectable,
 * - trend evolution becomes explainable,
 * - historical analogues become possible.
 *
 * THIS ENGINE DOES NOT:
 * ---------------------
 * - use vectors,
 * - use embeddings,
 * - use databases,
 * - use AI reasoning.
 *
 * It is intentionally deterministic.
 *
 * Future systems (vectorEngine, ragEngine, agentEngine)
 * will build on top of this layer.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ReportSuggestion } from '../types';
import { ForecastClassification } from './forecastEngine';

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ClusterMemoryRecord {
  cluster: string;
  classification: ForecastClassification;
}

export interface MemorySnapshot {
  clusters: ClusterMemoryRecord[];
}

export interface IntelligenceCycleMemory {

  cycleId: string;

  generatedAt: string;

  signals: ReportSuggestion[];

}

export interface ThemeMemory {

  thematicCluster: string;

  firstSeen: string;

  lastSeen: string;

  totalOccurrences: number;

  activeCycles: number;

  cumulativeOpportunityScore: number;

  averageOpportunityScore: number;

  highestOpportunityScore: number;

  verticalSpread: string[];

  pillarSpread: string[];

  sourceCount: number;

  sourceDomains: string[];

  recurringKeywords: string[];

  persistenceScore: number;

  accelerationScore: number;

  forecastTrajectory:
    | 'Transient'
    | 'Emerging'
    | 'Structural'
    | 'Supercycle';

}

export interface SignalRecurrence {

  marketKeyword: string;

  occurrences: number;

  firstSeen: string;

  lastSeen: string;

  averageOpportunityScore: number;

  highestOpportunityScore: number;

  associatedVerticals: string[];

  associatedThemes: string[];

}

export interface ForecastEvolution {

  thematicCluster: string;

  history: Array<{
    date: string;
    classification: string;
    score: number;
  }>;

  currentClassification: string;

  trajectoryDirection:
    | 'Accelerating'
    | 'Stable'
    | 'Weakening';

}

export interface MemoryState {

  totalCycles: number;

  totalSignals: number;

  totalThemesTracked: number;

  totalKeywordsTracked: number;

  createdAt: string;

  updatedAt: string;

}

export interface IntelligenceMemory {

  state: MemoryState;

  cycles: IntelligenceCycleMemory[];

  themes: ThemeMemory[];

  recurrences: SignalRecurrence[];

  forecastEvolution: ForecastEvolution[];

}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

export function createEmptyMemory(): IntelligenceMemory {

  const now = new Date().toISOString();

  return {
    state: {
      totalCycles: 0,
      totalSignals: 0,
      totalThemesTracked: 0,
      totalKeywordsTracked: 0,
      createdAt: now,
      updatedAt: now
    },

    cycles: [],

    themes: [],

    recurrences: [],

    forecastEvolution: []
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN MEMORY INGESTION
// ─────────────────────────────────────────────────────────────────────────────

export function ingestIntelligenceCycle(
  memory: IntelligenceMemory,
  signals: ReportSuggestion[]
): IntelligenceMemory {

  const updatedMemory: IntelligenceMemory = structuredClone(memory);

  const now = new Date().toISOString();

  // ───────────────────────────────────────────────────────────────────────────
  // STORE RAW CYCLE
  // ───────────────────────────────────────────────────────────────────────────

  const cycle: IntelligenceCycleMemory = {

    cycleId: generateCycleId(),

    generatedAt: now,

    signals
  };

  updatedMemory.cycles.push(cycle);

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE THEMATIC MEMORY
  // ───────────────────────────────────────────────────────────────────────────

  updateThemeMemory(updatedMemory, signals);

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE RECURRENCE MEMORY
  // ───────────────────────────────────────────────────────────────────────────

  updateSignalRecurrence(updatedMemory, signals);

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE FORECAST EVOLUTION
  // ───────────────────────────────────────────────────────────────────────────

  updateForecastEvolution(updatedMemory, signals);

  // ───────────────────────────────────────────────────────────────────────────
  // CAP RETAINED RAW CYCLES
  // ───────────────────────────────────────────────────────────────────────────
  // Bound disk size and structuredClone cost by retaining only the most recent
  // cycles. Suppression reads the last 15 cycles and evolution the last 10, so
  // keeping 60 leaves a wide safety margin. Aggregated theme / recurrence /
  // forecast memory is updated incrementally above and is NOT derived from this
  // array, so trimming raw cycles never loses longitudinal intelligence.
  const MAX_RETAINED_CYCLES = 60;
  if (updatedMemory.cycles.length > MAX_RETAINED_CYCLES) {
    updatedMemory.cycles =
      updatedMemory.cycles.slice(-MAX_RETAINED_CYCLES);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE STATE
  // ───────────────────────────────────────────────────────────────────────────
  // Lifetime counters are incremented rather than derived from cycles.length, so
  // they stay accurate after the raw cycle list above is trimmed.
  updatedMemory.state.totalCycles =
    (updatedMemory.state.totalCycles ?? 0) + 1;

  updatedMemory.state.totalSignals =
    (updatedMemory.state.totalSignals ?? 0) + signals.length;

  updatedMemory.state.totalThemesTracked =
    updatedMemory.themes.length;

  updatedMemory.state.totalKeywordsTracked =
    updatedMemory.recurrences.length;

  updatedMemory.state.updatedAt = now;

  return updatedMemory;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME MEMORY
// ─────────────────────────────────────────────────────────────────────────────

function updateThemeMemory(
  memory: IntelligenceMemory,
  signals: ReportSuggestion[]
): void {

  const now = new Date().toISOString();

  const grouped = new Map<string, ReportSuggestion[]>();

  for (const signal of signals) {

    const key = signal.thematicCluster;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key)!.push(signal);
  }

  for (const [cluster, clusterSignals] of grouped.entries()) {

    const existing =
      memory.themes.find(
        t => t.thematicCluster === cluster
      );

    const totalOpportunity =
      clusterSignals.reduce(
        (sum, s) => sum + s.opportunityScore,
        0
      );

    const highestScore =
      Math.max(
        ...clusterSignals.map(s => s.opportunityScore)
      );

    const verticalSpread =
      [...new Set(clusterSignals.map(s => s.vertical))];

    const pillarSpread =
      [...new Set(clusterSignals.map(s => s.strategicPillar))];

    const sourceDomains =
      [...new Set(
        clusterSignals.map(s =>
          extractDomain(s.sourceArticleUrl)
        )
      )];

    const recurringKeywords =
      [...new Set(
        clusterSignals.map(s => s.marketKeyword)
      )];

    if (!existing) {

      memory.themes.push({

        thematicCluster: cluster,

        firstSeen: now,

        lastSeen: now,

        totalOccurrences: clusterSignals.length,

        activeCycles: 1,

        cumulativeOpportunityScore: totalOpportunity,

        averageOpportunityScore:
          totalOpportunity / clusterSignals.length,

        highestOpportunityScore: highestScore,

        verticalSpread,

        pillarSpread,

        sourceCount: sourceDomains.length,

        sourceDomains,

        recurringKeywords,

        persistenceScore:
          calculatePersistenceScore(
            clusterSignals.length,
            verticalSpread.length,
            sourceDomains.length
          ),

        accelerationScore: 0,

        forecastTrajectory:
          classifyTrajectory(
            totalOpportunity / clusterSignals.length
          )
      });

    } else {

      const previousOccurrences =
        existing.totalOccurrences;

      existing.lastSeen = now;

      existing.totalOccurrences +=
        clusterSignals.length;

      existing.activeCycles += 1;

      existing.cumulativeOpportunityScore +=
        totalOpportunity;

      existing.averageOpportunityScore =
        existing.cumulativeOpportunityScore /
        existing.totalOccurrences;

      existing.highestOpportunityScore =
        Math.max(
          existing.highestOpportunityScore,
          highestScore
        );

      existing.verticalSpread =
        [...new Set([
          ...existing.verticalSpread,
          ...verticalSpread
        ])];

      existing.pillarSpread =
        [...new Set([
          ...existing.pillarSpread,
          ...pillarSpread
        ])];

      existing.sourceDomains =
        [...new Set([
          ...existing.sourceDomains,
          ...sourceDomains
        ])];

      existing.sourceCount =
        existing.sourceDomains.length;

      existing.recurringKeywords =
        [...new Set([
          ...existing.recurringKeywords,
          ...recurringKeywords
        ])];

      existing.persistenceScore =
        calculatePersistenceScore(
          existing.totalOccurrences,
          existing.verticalSpread.length,
          existing.sourceCount
        );

      existing.accelerationScore =
        calculateAccelerationScore(
          previousOccurrences,
          existing.totalOccurrences
        );

      existing.forecastTrajectory =
        classifyTrajectory(
          existing.averageOpportunityScore
        );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL RECURRENCE
// ─────────────────────────────────────────────────────────────────────────────

function updateSignalRecurrence(
  memory: IntelligenceMemory,
  signals: ReportSuggestion[]
): void {

  const now = new Date().toISOString();

  for (const signal of signals) {

    const existing =
      memory.recurrences.find(
        r => r.marketKeyword === signal.marketKeyword
      );

    if (!existing) {

      memory.recurrences.push({

        marketKeyword: signal.marketKeyword,

        occurrences: 1,

        firstSeen: now,

        lastSeen: now,

        averageOpportunityScore:
          signal.opportunityScore,

        highestOpportunityScore:
          signal.opportunityScore,

        associatedVerticals: [signal.vertical],

        associatedThemes: [signal.thematicCluster]
      });

    } else {

      existing.occurrences += 1;

      existing.lastSeen = now;

      existing.averageOpportunityScore =
        (
          (
            existing.averageOpportunityScore *
            (existing.occurrences - 1)
          ) +
          signal.opportunityScore
        ) / existing.occurrences;

      existing.highestOpportunityScore =
        Math.max(
          existing.highestOpportunityScore,
          signal.opportunityScore
        );

      existing.associatedVerticals =
        [...new Set([
          ...existing.associatedVerticals,
          signal.vertical
        ])];

      existing.associatedThemes =
        [...new Set([
          ...existing.associatedThemes,
          signal.thematicCluster
        ])];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORECAST EVOLUTION
// ─────────────────────────────────────────────────────────────────────────────

function updateForecastEvolution(
  memory: IntelligenceMemory,
  signals: ReportSuggestion[]
): void {

  const now = new Date().toISOString();

  const grouped = new Map<string, ReportSuggestion[]>();

  for (const signal of signals) {

    const key = signal.thematicCluster;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key)!.push(signal);
  }

  for (const [cluster, clusterSignals] of grouped.entries()) {

    const averageScore =
      clusterSignals.reduce(
        (sum, s) => sum + s.opportunityScore,
        0
      ) / clusterSignals.length;

    const classification =
      classifyTrajectory(averageScore);

    const existing =
      memory.forecastEvolution.find(
        f => f.thematicCluster === cluster
      );

    if (!existing) {

      memory.forecastEvolution.push({

        thematicCluster: cluster,

        history: [{
          date: now,
          classification,
          score: averageScore
        }],

        currentClassification: classification,

        trajectoryDirection: 'Stable'
      });

    } else {

      existing.history.push({
        date: now,
        classification,
        score: averageScore
      });

      existing.currentClassification =
        classification;

      existing.trajectoryDirection =
        determineTrajectoryDirection(
          existing.history
        );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function calculatePersistenceScore(
  occurrences: number,
  verticalSpread: number,
  sourceSpread: number
): number {

  const raw =
    (occurrences * 0.5) +
    (verticalSpread * 8) +
    (sourceSpread * 5);

  return Math.min(100, Math.round(raw));
}

function calculateAccelerationScore(
  previous: number,
  current: number
): number {

  if (previous === 0) return 0;

  return Math.round(
    ((current - previous) / previous) * 100
  );
}

function classifyTrajectory(
  score: number
):
  | 'Transient'
  | 'Emerging'
  | 'Structural'
  | 'Supercycle' {

  if (score >= 85) return 'Supercycle';

  if (score >= 70) return 'Structural';

  if (score >= 55) return 'Emerging';

  return 'Transient';
}

function determineTrajectoryDirection(
  history: Array<{ score: number }>
):
  | 'Accelerating'
  | 'Stable'
  | 'Weakening' {

  if (history.length < 2) {
    return 'Stable';
  }

  const recent =
    history.slice(-3);

  const first =
    recent[0].score;

  const last =
    recent[recent.length - 1].score;

  if (last > first + 8) {
    return 'Accelerating';
  }

  if (last < first - 8) {
    return 'Weakening';
  }

  return 'Stable';
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getTopThemes(
  memory: IntelligenceMemory,
  limit = 10
): ThemeMemory[] {

  return [...memory.themes]
    .sort(
      (a, b) =>
        b.persistenceScore - a.persistenceScore
    )
    .slice(0, limit);
}

export function getAcceleratingThemes(
  memory: IntelligenceMemory
): ThemeMemory[] {

  return memory.themes
    .filter(
      t => t.accelerationScore > 25
    )
    .sort(
      (a, b) =>
        b.accelerationScore - a.accelerationScore
    );
}

export function getSupercycles(
  memory: IntelligenceMemory
): ThemeMemory[] {

  return memory.themes
    .filter(
      t => t.forecastTrajectory === 'Supercycle'
    )
    .sort(
      (a, b) =>
        b.persistenceScore - a.persistenceScore
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {

  try {

    return new URL(url)
      .hostname
      .replace(/^www\./, '');

  } catch {

    return 'unknown';
  }
}

function generateCycleId(): string {

  return (
    'cycle_' +
    Date.now() +
    '_' +
    Math.random()
      .toString(36)
      .substring(2, 8)
  );
}
