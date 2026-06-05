// src/services/evaluationEngine.ts

/**
 * Evaluation Engine
 * -------------------------------------------------------
 * Purpose:
 * Evaluates the health, reliability, stability,
 * consistency, and integrity of the intelligence system.
 */

import {
  Forecast,
  Recommendation,
  Signal,
  IntelligenceStatus,
  SEMANTIC_VERSION,
  normalizeScore,
  normalizeConfidence,
  BaseIntelligenceObject,
} from "./schemaRegistry";

export interface EvaluationResult extends BaseIntelligenceObject {
  overallHealth: number;
  recommendationQuality: number;
  rankingIntegrity: number;
  forecastStability: number;
  confidenceCalibration: number;
  diversityHealth: number;
  signalIntegrity: number;
  warnings: string[];
  metadata: {
    evaluatedRecommendations: number;
    evaluatedForecasts: number;
    evaluatedSignals: number;
    evaluationTimestamp: number;
  };
}

export interface EvaluationContext {
  minimumConfidence?: number;
  diversityThreshold?: number;
  weakSignalThreshold?: number;
  duplicateTolerance?: number;
}

const DEFAULT_CONTEXT: Required<EvaluationContext> = {
  minimumConfidence: 0.45,
  diversityThreshold: 0.5,
  weakSignalThreshold: 0.3,
  duplicateTolerance: 0.2,
};

export class EvaluationEngine {
  /**
   * Main Evaluation Entry
   */
  public evaluateSystem(
    recommendations: Recommendation[],
    forecasts: Forecast[],
    signals: Signal[],
    context: EvaluationContext = {}
  ): EvaluationResult {
    const config = {
      ...DEFAULT_CONTEXT,
      ...context,
    };

    const recommendationQuality = this.evaluateRecommendationQuality(
      recommendations,
      config
    );

    const rankingIntegrity = this.evaluateRankingIntegrity(recommendations);

    const forecastStability = this.evaluateForecastStability(forecasts);

    const confidenceCalibration = this.evaluateConfidenceCalibration(
      recommendations,
      forecasts
    );

    const diversityHealth = this.evaluateDiversityHealth(
      recommendations,
      config
    );

    const signalIntegrity = this.evaluateSignalIntegrity(signals, config);

    const warnings = this.generateWarnings({
      recommendationQuality,
      rankingIntegrity,
      forecastStability,
      confidenceCalibration,
      diversityHealth,
      signalIntegrity,
    });

    const averageHealth =
      (recommendationQuality +
        rankingIntegrity +
        forecastStability +
        confidenceCalibration +
        diversityHealth +
        signalIntegrity) /
      6;

    return {
      id: `eval_${Date.now()}`,
      createdAt: Date.now(),
      status: IntelligenceStatus.ACTIVE,
      semanticVersion: SEMANTIC_VERSION,
      overallHealth: normalizeScore(averageHealth),
      recommendationQuality,
      rankingIntegrity,
      forecastStability,
      confidenceCalibration,
      diversityHealth,
      signalIntegrity,
      warnings,
      metadata: {
        evaluatedRecommendations: recommendations.length,
        evaluatedForecasts: forecasts.length,
        evaluatedSignals: signals.length,
        evaluationTimestamp: Date.now(),
      },
    };
  }

  private evaluateRecommendationQuality(
    recommendations: Recommendation[],
    context: Required<EvaluationContext>
  ): number {
    if (!recommendations.length) return 0;

    let quality = 0;
    for (const rec of recommendations) {
      let score = 0;
      if (rec.confidence.value >= context.minimumConfidence) score += 0.4;
      if (rec.supportingSignals.length >= 2) score += 0.3;
      if (rec.recommendationScore >= 0.5) score += 0.3;
      quality += score;
    }

    return normalizeScore(quality / recommendations.length);
  }

  private evaluateRankingIntegrity(
    recommendations: Recommendation[]
  ): number {
    if (recommendations.length <= 1) return 1;

    let integrity = 1;
    for (let i = 0; i < recommendations.length - 1; i++) {
      const current = recommendations[i];
      const next = recommendations[i + 1];

      const invalidRanking =
        current.recommendationScore < next.recommendationScore &&
        current.confidence.value > next.confidence.value;

      if (invalidRanking) integrity -= 0.1;
    }

    return normalizeScore(integrity);
  }

  private evaluateForecastStability(forecasts: Forecast[]): number {
    if (!forecasts.length) return 0;

    const scores = forecasts.map(f => f.forecastScore);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.reduce((acc, score) => acc + Math.pow(score - average, 2), 0) /
      scores.length;

    return normalizeScore(1 - variance);
  }

  private evaluateConfidenceCalibration(
    recommendations: Recommendation[],
    forecasts: Forecast[]
  ): number {
    if (!recommendations.length || !forecasts.length) return 0;

    const recConf =
      recommendations.reduce((sum, r) => sum + r.confidence.value, 0) /
      recommendations.length;
    const forecastConf =
      forecasts.reduce((sum, f) => sum + f.confidence.value, 0) /
      forecasts.length;

    const delta = Math.abs(recConf - forecastConf);
    return normalizeScore(1 - delta);
  }

  private evaluateDiversityHealth(
    recommendations: Recommendation[],
    context: Required<EvaluationContext>
  ): number {
    if (!recommendations.length) return 0;

    const verticalMap = new Map<string, number>();
    for (const rec of recommendations) {
      const vertical = rec.verticals[0] ?? "unknown";
      verticalMap.set(vertical, (verticalMap.get(vertical) ?? 0) + 1);
    }

    const maxConcentration = Math.max(...Array.from(verticalMap.values()));
    const ratio = maxConcentration / recommendations.length;

    return normalizeScore(1 - ratio);
  }

  private evaluateSignalIntegrity(
    signals: Signal[],
    context: Required<EvaluationContext>
  ): number {
    if (!signals.length) return 0;

    let penalties = 0;
    for (const signal of signals) {
      if (signal.importanceWeight < context.weakSignalThreshold) {
        penalties += 0.1;
      }
      // Assuming metadata could hold duplicate/weakSource flags if needed
      if (signal.metadata?.duplicate) penalties += 0.1;
      if (signal.metadata?.weakSource) penalties += 0.1;
    }

    return normalizeScore(1 - penalties / signals.length);
  }

  private generateWarnings(scores: Record<string, number>): string[] {
    const warnings: string[] = [];
    if (scores.recommendationQuality < 0.5)
      warnings.push("Low recommendation quality detected");
    if (scores.rankingIntegrity < 0.6)
      warnings.push("Ranking inconsistencies detected");
    if (scores.forecastStability < 0.5)
      warnings.push("Forecast instability increasing");
    if (scores.diversityHealth < 0.4)
      warnings.push("Recommendation diversity collapse detected");
    return warnings;
  }
}

export default EvaluationEngine;
