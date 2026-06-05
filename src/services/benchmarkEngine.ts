// src/services/benchmarkEngine.ts

/**
 * Benchmark Engine
 * -------------------------------------------------------
 * Purpose:
 * Provides longitudinal measurement,
 * calibration analysis, quality tracking,
 * and systemic benchmarking.
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
  ConfidenceScore,
  createConfidenceScore,
} from "./schemaRegistry";

export interface BenchmarkSnapshot extends BaseIntelligenceObject {
  overallHealth: number;
  forecastCalibration: number;
  recommendationStability: number;
  signalReliability: number;
  degradationRisk: number;
}

export class BenchmarkEngine {
  public benchmarkSystem(
    signals: Signal[],
    forecasts: Forecast[],
    recommendations: Recommendation[]
  ): BenchmarkSnapshot {
    const forecastCalibration = this.computeForecastCalibration(forecasts);
    const recommendationStability = this.computeRecommendationStability(recommendations);
    const signalReliability = this.computeSignalReliability(signals);

    const overallHealth = normalizeScore(
      forecastCalibration * 0.4 +
      recommendationStability * 0.3 +
      signalReliability * 0.3
    );

    return {
      id: `bench_${Date.now()}`,
      createdAt: Date.now(),
      status: IntelligenceStatus.ACTIVE,
      semanticVersion: SEMANTIC_VERSION,
      overallHealth,
      forecastCalibration,
      recommendationStability,
      signalReliability,
      degradationRisk: normalizeScore(1 - overallHealth),
    };
  }

  private computeForecastCalibration(forecasts: Forecast[]): number {
    if (!forecasts.length) return 0.5;
    const avgConf = forecasts.reduce((s, f) => s + f.confidence.value, 0) / forecasts.length;
    return normalizeConfidence(avgConf);
  }

  private computeRecommendationStability(recommendations: Recommendation[]): number {
    if (!recommendations.length) return 0.5;
    const avgScore = recommendations.reduce((s, r) => s + r.recommendationScore, 0) / recommendations.length;
    return normalizeScore(avgScore);
  }

  private computeSignalReliability(signals: Signal[]): number {
    if (!signals.length) return 0.5;
    const avgConf = signals.reduce((s, sig) => s + sig.confidence.value, 0) / signals.length;
    return normalizeConfidence(avgConf);
  }
}

export default BenchmarkEngine;
