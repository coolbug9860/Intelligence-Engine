/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Forecast Engine
 * src/services/forecastEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * Converts isolated intelligence snapshots into longitudinal market forecasting.
 *
 * This engine evaluates:
 * - signal persistence
 * - thematic acceleration
 * - market momentum
 * - structural convergence
 * - supercycle formation
 *
 * The objective is NOT statistical prediction.
 *
 * Instead:
 * this engine estimates strategic trajectory strength
 * using deterministic intelligence heuristics.
 *
 * OUTPUT CLASSIFICATIONS
 * ----------------------
 * - Transient
 * - Emerging
 * - Structural
 * - Supercycle
 *
 * EXAMPLES
 * --------
 * Transient:
 *   One-time supply disruption
 *
 * Emerging:
 *   Early industrial AI adoption
 *
 * Structural:
 *   Grid modernization investment cycle
 *
 * Supercycle:
 *   Industrial decarbonization
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ReportSuggestion } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ForecastClassification =
  | "Transient"
  | "Emerging"
  | "Structural"
  | "Supercycle";

export interface ForecastSignal {
  signalId: string;

  marketKeyword: string;

  thematicCluster: string;

  classification: ForecastClassification;

  momentumScore: number;

  persistenceScore: number;

  convergenceScore: number;

  forecastScore: number;

  accelerationIndex: number;

  forecastNarrative: string;

  sourceSuggestion: ReportSuggestion;
}

export interface ForecastCluster {
  cluster: string;
  thematicCluster: string;

  signalCount: number;

  forecastScore: number;
  averageForecastScore: number;

  classification: ForecastClassification;
  dominantClassification: ForecastClassification;

  signals: ReportSuggestion[];
  verticals: string[];
  pillars: string[];

  accelerationTrend: number;

  strategicImportance: number;

  narrative: string;
}

export interface ForecastResult {
  signals: ForecastSignal[];

  clusters: ForecastCluster[];

  dominantEmergingThemes: string[];

  dominantStructuralThemes: string[];

  detectedSupercycles: string[];

  forecastSummary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function average(values: number[]): number {

  if (!values.length) return 0;

  return (
    values.reduce((a, b) => a + b, 0) /
    values.length
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────────────────────

function calculateMomentumScore(
  suggestion: ReportSuggestion
): number {

  let score = 0;

  score += suggestion.opportunityScore || 0;

  score +=
    (suggestion.nexusArticlesCount || 0) * 4;

  if (
    suggestion.salesPotential === "High"
  ) {
    score += 12;
  }

  if (
    suggestion.marketExecutionWindow ===
    "Long-term (1Y+)"
  ) {
    score += 10;
  }

  if (
    suggestion.sentimentPolarity ===
    "Bullish"
  ) {
    score += 8;
  }

  return Math.min(100, Math.round(score));
}

function calculatePersistenceScore(
  suggestion: ReportSuggestion
): number {

  let score = 0;

  // Long-term themes persist more
  if (
    suggestion.marketExecutionWindow ===
    "Long-term (1Y+)"
  ) {
    score += 35;
  }

  // Durable thematic clusters
  const durableThemes = [
    "Industrial Decarbonization",
    "Energy Transition",
    "AI Infrastructure",
    "Grid Modernization",
    "Critical Mineral Protectionism",
    "Supply Chain Resilience",
    "Automation",
  ];

  if (
    durableThemes.some(theme =>
      normalize(suggestion.thematicCluster)
        .includes(normalize(theme))
    )
  ) {
    score += 35;
  }

  // Strong commercial buyer alignment
  if (
    suggestion.primaryStakeholder &&
    suggestion.primaryStakeholder
      .toLowerCase()
      .includes("chief")
  ) {
    score += 15;
  }

  // High authority signals persist more
  score +=
    Math.round(
      (suggestion.credibilityScore || 0) * 0.15
    );

  return Math.min(100, score);
}

function calculateConvergenceScore(
  suggestion: ReportSuggestion,
  allSignals: ReportSuggestion[]
): number {

  const similarSignals =
    allSignals.filter(s => {

      if (s.id === suggestion.id) {
        return false;
      }

      return (
        normalize(s.thematicCluster) ===
          normalize(suggestion.thematicCluster) ||

        normalize(s.marketKeyword) ===
          normalize(suggestion.marketKeyword)
      );
    });

  let score =
    similarSignals.length * 12;

  // Multi-vertical convergence
  const verticals = unique(
    similarSignals.map(s => s.vertical)
  );

  score += verticals.length * 6;

  // Pillar convergence
  const pillars = unique(
    similarSignals.map(
      s => s.strategicPillar
    )
  );

  score += pillars.length * 5;

  return Math.min(100, score);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

function classifyForecast(
  forecastScore: number
): ForecastClassification {

  if (forecastScore >= 85) {
    return "Supercycle";
  }

  if (forecastScore >= 70) {
    return "Structural";
  }

  if (forecastScore >= 50) {
    return "Emerging";
  }

  return "Transient";
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL FORECASTING
// ─────────────────────────────────────────────────────────────────────────────

function forecastSignal(
  suggestion: ReportSuggestion,
  allSignals: ReportSuggestion[]
): ForecastSignal {

  const momentumScore =
    calculateMomentumScore(suggestion);

  const persistenceScore =
    calculatePersistenceScore(suggestion);

  const convergenceScore =
    calculateConvergenceScore(
      suggestion,
      allSignals
    );

  const forecastScore =
    Math.round(
      (
        momentumScore * 0.4 +
        persistenceScore * 0.35 +
        convergenceScore * 0.25
      )
    );

  const accelerationIndex =
    Math.round(
      (
        convergenceScore * 0.6 +
        momentumScore * 0.4
      )
    );

  const classification =
    classifyForecast(forecastScore);

  return {
    signalId: suggestion.id,

    marketKeyword:
      suggestion.marketKeyword,

    thematicCluster:
      suggestion.thematicCluster,

    classification,

    momentumScore,

    persistenceScore,

    convergenceScore,

    forecastScore,

    accelerationIndex,

    forecastNarrative:
      buildForecastNarrative(
        suggestion,
        classification,
        forecastScore
      ),
    sourceSuggestion: suggestion,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NARRATIVE
// ─────────────────────────────────────────────────────────────────────────────

function buildForecastNarrative(
  suggestion: ReportSuggestion,
  classification: ForecastClassification,
  score: number
): string {

  switch (classification) {

    case "Supercycle":
      return (
        `${suggestion.thematicCluster} demonstrates ` +
        `high structural persistence and multi-sector ` +
        `commercial convergence, indicating potential ` +
        `supercycle formation.`
      );

    case "Structural":
      return (
        `${suggestion.thematicCluster} exhibits ` +
        `durable strategic momentum with sustained ` +
        `enterprise and infrastructure alignment.`
      );

    case "Emerging":
      return (
        `${suggestion.thematicCluster} shows early-stage ` +
        `commercial acceleration with expanding ` +
        `market validation signals.`
      );

    default:
      return (
        `${suggestion.thematicCluster} currently appears ` +
        `event-driven with limited long-term persistence indicators.`
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTER FORECASTING
// ─────────────────────────────────────────────────────────────────────────────

function buildForecastClusters(
  forecasts: ForecastSignal[]
): ForecastCluster[] {

  const clusterMap =
    new Map<string, ForecastSignal[]>();

  for (const signal of forecasts) {

    const key =
      normalize(signal.thematicCluster);

    if (!clusterMap.has(key)) {
      clusterMap.set(key, []);
    }

    clusterMap.get(key)!.push(signal);
  }

  const clusters: ForecastCluster[] = [];

  for (const [theme, signals] of clusterMap.entries()) {

    const avgScore =
      average(
        signals.map(
          s => s.forecastScore
        )
      );

    const avgAcceleration =
      average(
        signals.map(
          s => s.accelerationIndex
        )
      );

    const classifications =
      signals.map(s => s.classification);

    const dominantClassification =
      classifications
        .sort(
          (a, b) =>
            classifications.filter(v => v === a).length -
            classifications.filter(v => v === b).length
        )
        .pop() || "Transient";

    const strategicImportance =
      Math.round(
        avgScore * 0.7 +
        avgAcceleration * 0.3
      );

    const clusterSignals = signals.map(s => s.sourceSuggestion);
    const verticals = unique(clusterSignals.map(s => s.vertical as string));
    const pillars = unique(clusterSignals.map(s => s.strategicPillar as string));

    clusters.push({
      cluster: theme,
      thematicCluster: theme,

      signalCount: signals.length,

      forecastScore: Math.round(avgScore),
      averageForecastScore:
        Math.round(avgScore),

      classification: dominantClassification,
      dominantClassification,

      signals: clusterSignals,
      verticals,
      pillars,

      accelerationTrend:
        Math.round(avgAcceleration),

      strategicImportance,

      narrative:
        `${theme} shows ${dominantClassification.toLowerCase()} ` +
        `forecast characteristics across ${signals.length} ` +
        `converging intelligence signals.`,
    });
  }

  return clusters.sort(
    (a, b) =>
      b.strategicImportance -
      a.strategicImportance
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function runForecastEngine(
  suggestions: ReportSuggestion[]
): ForecastResult {

  const forecasts =
    suggestions.map(s =>
      forecastSignal(
        s,
        suggestions
      )
    );

  const clusters =
    buildForecastClusters(
      forecasts
    );

  const dominantEmergingThemes =
    clusters
      .filter(
        c =>
          c.dominantClassification ===
          "Emerging"
      )
      .map(c => c.thematicCluster)
      .slice(0, 10);

  const dominantStructuralThemes =
    clusters
      .filter(
        c =>
          c.dominantClassification ===
          "Structural"
      )
      .map(c => c.thematicCluster)
      .slice(0, 10);

  const detectedSupercycles =
    clusters
      .filter(
        c =>
          c.dominantClassification ===
          "Supercycle"
      )
      .map(c => c.thematicCluster);

  const forecastSummary =
    `Forecast engine analyzed ` +
    `${forecasts.length} intelligence signals ` +
    `across ${clusters.length} thematic clusters. ` +
    `${detectedSupercycles.length} potential ` +
    `supercycle themes detected.`;

  return {
    signals: forecasts,

    clusters,

    dominantEmergingThemes,

    dominantStructuralThemes,

    detectedSupercycles,

    forecastSummary,
  };
}
