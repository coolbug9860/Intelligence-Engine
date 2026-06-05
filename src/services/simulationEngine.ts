// src/services/simulationEngine.ts

/**
 * Simulation Engine
 * -------------------------------------------------------
 * Purpose:
 * Provides scenario simulation, counterfactual
 * reasoning, stress testing, and trajectory
 * analysis.
 */

import {
  Forecast,
  ForecastClassification,
  normalizeConfidence,
  normalizeScore,
  Priority,
  Recommendation,
  Signal,
  IntelligenceStatus,
  SEMANTIC_VERSION,
  BaseIntelligenceObject,
  ConfidenceScore,
  createConfidenceScore,
} from "./schemaRegistry";

export interface SimulationPerturbation {
  variable: "confidence" | "forecast" | "priority" | "volatility";
  operation: "increase" | "decrease" | "multiply" | "override";
  value: number;
}

export interface SimulationScenario {
  id: string;
  title: string;
  description?: string;
  perturbations: SimulationPerturbation[];
}

export interface SimulationResult extends BaseIntelligenceObject {
  scenarioId: string;
  forecastShift: number;
  priorityShift: number;
  recommendationShift: number;
  confidenceShift: number;
  uncertaintyShift: number;
  systemicStressScore: number;
  resilienceScore: number;
  warnings: string[];
  confidence: ConfidenceScore;
}

export class SimulationEngine {
  public simulateScenario(
    scenario: SimulationScenario,
    forecasts: Forecast[],
    priorities: Priority[],
    recommendations: Recommendation[],
    signals: Signal[]
  ): SimulationResult {
    const forecastShift = this.computeForecastShift(forecasts, scenario);
    const priorityShift = this.computePriorityShift(priorities, scenario);
    const recommendationShift = this.computeRecommendationShift(recommendations, scenario);
    const confidenceShift = this.computeConfidenceShift(signals, scenario);
    const uncertaintyShift = this.computeUncertaintyShift(scenario);

    const systemicStressScore = normalizeScore(
      forecastShift * 0.4 + recommendationShift * 0.3 + uncertaintyShift * 0.3
    );

    const resilienceScore = normalizeScore(1 - systemicStressScore);

    const warnings: string[] = [];
    if (systemicStressScore > 0.7) warnings.push("High systemic stress detected");
    if (resilienceScore < 0.4) warnings.push("Low system resilience detected");

    return {
      id: `sim_${Date.now()}`,
      createdAt: Date.now(),
      status: IntelligenceStatus.ACTIVE,
      semanticVersion: SEMANTIC_VERSION,
      scenarioId: scenario.id,
      forecastShift,
      priorityShift,
      recommendationShift,
      confidenceShift,
      uncertaintyShift,
      systemicStressScore,
      resilienceScore,
      warnings,
      confidence: createConfidenceScore(resilienceScore, uncertaintyShift),
    };
  }

  private computeForecastShift(forecasts: Forecast[], scenario: SimulationScenario): number {
    if (!forecasts.length) return 0;
    // Simplified: return sum of relevant perturbations
    const p = scenario.perturbations.filter(p => p.variable === "forecast");
    return normalizeScore(p.reduce((s, x) => s + x.value, 0) / forecasts.length);
  }

  private computePriorityShift(priorities: Priority[], scenario: SimulationScenario): number {
    if (!priorities.length) return 0;
    const p = scenario.perturbations.filter(p => p.variable === "priority");
    return normalizeScore(p.reduce((s, x) => s + x.value, 0) / priorities.length);
  }

  private computeRecommendationShift(recommendations: Recommendation[], scenario: SimulationScenario): number {
    if (!recommendations.length) return 0;
    const p = scenario.perturbations.filter(p => p.variable === "volatility");
    return normalizeScore(p.reduce((s, x) => s + x.value, 0) / recommendations.length);
  }

  private computeConfidenceShift(signals: Signal[], scenario: SimulationScenario): number {
    if (!signals.length) return 0;
    const p = scenario.perturbations.filter(p => p.variable === "confidence");
    return normalizeScore(p.reduce((s, x) => s + x.value, 0) / signals.length);
  }

  private computeUncertaintyShift(scenario: SimulationScenario): number {
    const p = scenario.perturbations.filter(p => p.variable === "volatility");
    return normalizeScore(p.reduce((s, x) => s + x.value, 0));
  }
}

export default SimulationEngine;
