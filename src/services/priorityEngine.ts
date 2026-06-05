/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Priority Engine
 * src/services/priorityEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * The Priority Engine transforms intelligence outputs into strategic
 * executive prioritization.
 *
 * Upstream engines already determine:
 * - market relevance
 * - structural durability
 * - propagation pathways
 * - historical persistence
 * - thematic convergence
 *
 * This engine answers:
 *
 *   "What deserves immediate strategic attention?"
 *
 * CORE RESPONSIBILITIES
 * ---------------------
 * 1. Executive Escalation Scoring
 * 2. Strategic Urgency Detection
 * 3. Regime Shift Identification
 * 4. Structural Asymmetry Detection
 * 5. Supercycle Escalation
 * 6. Analyst Attention Prioritization
 *
 * OUTPUT
 * ------
 * Produces:
 * - priority scores
 * - escalation tiers
 * - strategic narratives
 * - urgency classifications
 * - executive monitoring queues
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ForecastCluster } from './forecastEngine';
import { EvolvedClusterAssessment } from './evolutionEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EscalationTier =
  | 'Background'
  | 'Monitor'
  | 'Important'
  | 'Strategic'
  | 'Critical';

export type StrategicUrgency =
  | 'Low'
  | 'Moderate'
  | 'High'
  | 'Immediate';

export interface PriorityAssessment {
  cluster: string;

  priorityScore: number;

  escalationTier: EscalationTier;

  urgency: StrategicUrgency;

  asymmetryScore: number;

  regimeShiftProbability: number;

  executiveExposure: number;

  narrative: string;

  drivers: string[];
}

export interface PriorityReport {
  generatedAt: string;

  totalClustersEvaluated: number;

  criticalAlerts: number;

  strategicAlerts: number;

  importantAlerts: number;

  monitorAlerts: number;

  backgroundSignals: number;

  highestPriorityCluster?: string;

  averagePriorityScore: number;

  assessments: PriorityAssessment[];

  warnings: string[];
}

export interface PriorityInput {
  forecasts: ForecastCluster[];
  evolutionAssessments: EvolvedClusterAssessment[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SALES_POTENTIAL_WEIGHT = {
  High: 15,
  Medium: 7,
  Emerging: 4,
};

const EXECUTION_WINDOW_WEIGHT = {
  'Immediate (0-3M)': 15,
  'Strategic (6-12M)': 8,
  'Long-term (1Y+)': 3,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function determineEscalationTier(score: number): EscalationTier {
  if (score >= 90) return 'Critical';
  if (score >= 75) return 'Strategic';
  if (score >= 60) return 'Important';
  if (score >= 40) return 'Monitor';

  return 'Background';
}

function determineUrgency(score: number): StrategicUrgency {
  if (score >= 90) return 'Immediate';
  if (score >= 70) return 'High';
  if (score >= 45) return 'Moderate';

  return 'Low';
}

function buildNarrative(
  cluster: string,
  tier: EscalationTier,
  urgency: StrategicUrgency,
  regimeShiftProbability: number
): string {

  switch (tier) {

    case 'Critical':
      return `"${cluster}" demonstrates high structural acceleration with elevated executive exposure and strong regime-shift indicators. Immediate strategic monitoring recommended.`;

    case 'Strategic':
      return `"${cluster}" represents a strategically significant thematic movement with strong long-term commercial implications.`;

    case 'Important':
      return `"${cluster}" shows meaningful structural development requiring active monitoring and analyst review.`;

    case 'Monitor':
      return `"${cluster}" demonstrates moderate strategic relevance but limited escalation urgency at the current stage.`;

    case 'Background':
      return `"${cluster}" currently appears informational rather than strategically transformational.`;
  }
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

export function prioritizeIntelligence(
  input: PriorityInput
): PriorityReport {

  const { forecasts, evolutionAssessments } = input;

  const warnings: string[] = [];

  if (!forecasts.length) {
    warnings.push('No forecast clusters supplied to priority engine.');
  }

  const evolutionMap = new Map(
    evolutionAssessments.map(a => [a.cluster, a])
  );

  const assessments: PriorityAssessment[] = [];

  for (const forecast of forecasts) {

    const evolution =
      evolutionMap.get(forecast.cluster);

    // ───────────────────────────────────────────────────────────────────────
    // Momentum Layer
    // ───────────────────────────────────────────────────────────────────────

    let momentumScore =
      forecast.forecastScore * 0.35;

    // ───────────────────────────────────────────────────────────────────────
    // Evolution Layer
    // ───────────────────────────────────────────────────────────────────────

    let evolutionWeight = 0;

    if (evolution) {
      evolutionWeight =
        evolution.intelligenceWeight * 0.25;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Commercial Layer
    // ───────────────────────────────────────────────────────────────────────

    const salesPotentialValues =
      forecast.signals.map(
        s => SALES_POTENTIAL_WEIGHT[s.salesPotential] ?? 0
      );

    const commercialWeight =
      average(salesPotentialValues);

    // ───────────────────────────────────────────────────────────────────────
    // Executive Exposure
    // ───────────────────────────────────────────────────────────────────────

    let executiveExposure = 0;

    executiveExposure +=
      forecast.verticals.length * 6;

    executiveExposure +=
      forecast.pillars.length * 5;

    executiveExposure +=
      forecast.signals.length * 1.5;

    executiveExposure = clamp(
      executiveExposure,
      0,
      100
    );

    // ───────────────────────────────────────────────────────────────────────
    // Urgency Layer
    // ───────────────────────────────────────────────────────────────────────

    const urgencyWeights =
      forecast.signals.map(
        s => EXECUTION_WINDOW_WEIGHT[s.marketExecutionWindow] ?? 0
      );

    const urgencyScore =
      average(urgencyWeights);

    // ───────────────────────────────────────────────────────────────────────
    // Regime Shift Detection
    // ───────────────────────────────────────────────────────────────────────

    let regimeShiftProbability = 0;

    regimeShiftProbability +=
      forecast.verticals.length * 8;

    regimeShiftProbability +=
      forecast.pillars.length * 7;

    regimeShiftProbability +=
      forecast.signals.length * 2;

    if (forecast.classification === 'Supercycle') {
      regimeShiftProbability += 20;
    }

    regimeShiftProbability = clamp(
      regimeShiftProbability,
      0,
      100
    );

    // ───────────────────────────────────────────────────────────────────────
    // Asymmetry Detection
    // High structural importance with relatively low signal density
    // ───────────────────────────────────────────────────────────────────────

    let asymmetryScore = 0;

    asymmetryScore +=
      forecast.forecastScore * 0.5;

    asymmetryScore +=
      regimeShiftProbability * 0.3;

    asymmetryScore -=
      forecast.signals.length * 2;

    asymmetryScore = clamp(
      asymmetryScore,
      0,
      100
    );

    // ───────────────────────────────────────────────────────────────────────
    // Final Priority Score
    // ───────────────────────────────────────────────────────────────────────

    let priorityScore = 0;

    priorityScore += momentumScore;
    priorityScore += evolutionWeight;
    priorityScore += commercialWeight;
    priorityScore += urgencyScore;
    priorityScore += regimeShiftProbability * 0.12;
    priorityScore += asymmetryScore * 0.08;
    priorityScore += executiveExposure * 0.10;

    // Supercycle escalation boost
    if (forecast.classification === 'Supercycle') {
      priorityScore += 10;
    }

    // Accelerating evolution boost
    if (evolution?.trajectory === 'Accelerating') {
      priorityScore += 8;
    }

    // Collapsing thematic penalty
    if (evolution?.trajectory === 'Collapsing') {
      priorityScore -= 12;
    }

    priorityScore = clamp(
      parseFloat(priorityScore.toFixed(2)),
      0,
      100
    );

    // ───────────────────────────────────────────────────────────────────────
    // Classification
    // ───────────────────────────────────────────────────────────────────────

    const escalationTier =
      determineEscalationTier(priorityScore);

    const urgency =
      determineUrgency(priorityScore);

    // ───────────────────────────────────────────────────────────────────────
    // Drivers
    // ───────────────────────────────────────────────────────────────────────

    const drivers: string[] = [];

    if (forecast.classification === 'Supercycle') {
      drivers.push('Supercycle classification');
    }

    if (forecast.verticals.length >= 3) {
      drivers.push('Cross-vertical convergence');
    }

    if (forecast.pillars.length >= 3) {
      drivers.push('Multi-pillar structural alignment');
    }

    if (regimeShiftProbability >= 75) {
      drivers.push('Elevated regime-shift probability');
    }

    if (asymmetryScore >= 70) {
      drivers.push('High strategic asymmetry');
    }

    if (evolution?.trajectory === 'Accelerating') {
      drivers.push('Accelerating historical trajectory');
    }

    const narrative = buildNarrative(
      forecast.cluster,
      escalationTier,
      urgency,
      regimeShiftProbability
    );

    assessments.push({
      cluster: forecast.cluster,

      priorityScore,

      escalationTier,

      urgency,

      asymmetryScore: parseFloat(asymmetryScore.toFixed(2)),

      regimeShiftProbability: parseFloat(
        regimeShiftProbability.toFixed(2)
      ),

      executiveExposure: parseFloat(
        executiveExposure.toFixed(2)
      ),

      narrative,

      drivers,
    });
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  assessments.sort(
    (a, b) => b.priorityScore - a.priorityScore
  );

  const criticalAlerts =
    assessments.filter(a => a.escalationTier === 'Critical').length;

  const strategicAlerts =
    assessments.filter(a => a.escalationTier === 'Strategic').length;

  const importantAlerts =
    assessments.filter(a => a.escalationTier === 'Important').length;

  const monitorAlerts =
    assessments.filter(a => a.escalationTier === 'Monitor').length;

  const backgroundSignals =
    assessments.filter(a => a.escalationTier === 'Background').length;

  const highestPriorityCluster =
    assessments[0]?.cluster;

  const averagePriorityScore = parseFloat(
    average(
      assessments.map(a => a.priorityScore)
    ).toFixed(2)
  );

  return {
    generatedAt: new Date().toISOString(),

    totalClustersEvaluated: assessments.length,

    criticalAlerts,
    strategicAlerts,
    importantAlerts,
    monitorAlerts,
    backgroundSignals,

    highestPriorityCluster,

    averagePriorityScore,

    assessments,

    warnings,
  };
}
