// src/services/recommendationEngine.ts

/**
 * Recommendation Engine
 * -------------------------------------------------------
 * Purpose:
 * Converts validated intelligence outputs into actionable,
 * explainable, ranked recommendations.
 *
 * Position in Architecture:
 * Signal Engine
 *   → Validation Layer
 *   → Clustering
 *   → Forecast Engine
 *   → Priority Engine
 *   → Recommendation Engine
 *   → AI Synthesis / Analyst Output
 *
 * Design Goals:
 * - Deterministic
 * - Explainable
 * - Extensible
 * - Research-grade compatible
 * - Evaluation friendly
 */

import {
  Forecast,
  Priority,
  Recommendation,
  RecommendationType,
  Signal,
  normalizeScore,
  IntelligenceStatus,
  SEMANTIC_VERSION,
  createConfidenceScore,
  calculateWeightedConfidence,
} from "./schemaRegistry";

export interface RecommendationContext {
  maxRecommendations?: number;
  minimumConfidence?: number;
  diversityProtection?: boolean;
  diversityLimitPerVertical?: number;
  weights?: {
    forecast?: number;
    priority?: number;
    confidence?: number;
    urgency?: number;
    impact?: number;
  };
}

const DEFAULT_CONTEXT: Required<RecommendationContext> = {
  maxRecommendations: 10,
  minimumConfidence: 0.45,
  diversityProtection: true,
  diversityLimitPerVertical: 3,
  weights: {
    forecast: 0.3,
    priority: 0.35,
    confidence: 0.15,
    urgency: 0.1,
    impact: 0.1,
  },
};

export class RecommendationEngine {
  /**
   * Main Recommendation Generation Entry
   */
  public generateRecommendations(
    forecasts: Forecast[],
    priorities: Priority[],
    context: RecommendationContext = {}
  ): Recommendation[] {
    const config = this.mergeContext(context);
    const priorityMap = this.buildPriorityMap(priorities);
    const recommendations: Recommendation[] = [];

    for (const forecast of forecasts) {
      const priority = priorityMap.get(forecast.clusterId);
      if (!priority) continue;

      const recommendation = this.buildRecommendation(
        forecast,
        priority,
        config
      );

      if (recommendation.confidence.value >= config.minimumConfidence) {
        recommendations.push(recommendation);
      }
    }

    const ranked = this.rankRecommendations(recommendations);

    const diversified = config.diversityProtection
      ? this.applyDiversityProtection(
          ranked,
          config.diversityLimitPerVertical
        )
      : ranked;

    return diversified.slice(0, config.maxRecommendations);
  }

  /**
   * Core Recommendation Builder
   */
  private buildRecommendation(
    forecast: Forecast,
    priority: Priority,
    context: Required<RecommendationContext>
  ): Recommendation {
    const recommendationScore = this.computeRecommendationScore(
      forecast,
      priority,
      context
    );

    const confidence = this.computeConfidence(
      forecast,
      priority
    );

    const recommendationType = this.determineRecommendationType(
      recommendationScore,
      priority.urgency
    );

    const reasoning = this.generateReasoning(
      forecast,
      priority,
      recommendationScore
    );

    return {
      id: `rec_${forecast.clusterId}`,
      clusterId: forecast.clusterId,
      title: this.generateTitle(forecast, recommendationType),
      description: this.generateDescription(forecast, priority),
      type: recommendationType,
      recommendationScore,
      confidence,
      supportingSignals: forecast.signalIds,
      supportingEvidence: forecast.supportingEvidence ?? [],
      verticals: forecast.tags ?? [], // Using tags as verticals proxy if specific verticals field omitted
      projectedImpact: priority.impact,
      status: IntelligenceStatus.ACTIVE,
      createdAt: Date.now(),
      semanticVersion: SEMANTIC_VERSION,
    };
  }

  /**
   * Weighted Composite Recommendation Score
   */
  private computeRecommendationScore(
    forecast: Forecast,
    priority: Priority,
    context: Required<RecommendationContext>
  ): number {
    const weights = context.weights;

    const score =
      forecast.forecastScore * weights.forecast +
      priority.priorityScore * weights.priority +
      priority.confidence.value * weights.confidence +
      priority.urgency * weights.urgency +
      priority.impact * weights.impact;

    return normalizeScore(score);
  }

  /**
   * Confidence Synthesis
   */
  private computeConfidence(
    forecast: Forecast,
    priority: Priority
  ): Recommendation["confidence"] {
    return calculateWeightedConfidence([
      forecast.confidence.value,
      priority.confidence.value,
    ]);
  }

  /**
   * Recommendation Classification
   */
  private determineRecommendationType(
    score: number,
    urgency: number
  ): RecommendationType {
    if (score >= 0.85 && urgency >= 0.7) {
      return RecommendationType.STRATEGIC;
    }
    if (score >= 0.7) {
      return RecommendationType.OPPORTUNISTIC;
    }
    if (score >= 0.55) {
      return RecommendationType.EXPLORATORY;
    }
    if (score >= 0.4) {
      return RecommendationType.DEFENSIVE;
    }
    return RecommendationType.CORRECTIVE;
  }

  /**
   * Human-readable reasoning trace
   */
  private generateReasoning(
    forecast: Forecast,
    priority: Priority,
    score: number
  ): string[] {
    const reasoning: string[] = [];

    if (forecast.forecastScore >= 0.75) {
      reasoning.push("Strong forecast momentum detected");
    }
    if (priority.priorityScore >= 0.75) {
      reasoning.push("High strategic priority score");
    }
    if (priority.urgency >= 0.7) {
      reasoning.push("Elevated urgency detected");
    }
    if (score >= 0.8) {
      reasoning.push("High composite recommendation score");
    }

    return reasoning;
  }

  /**
   * Ranking
   */
  private rankRecommendations(
    recommendations: Recommendation[]
  ): Recommendation[] {
    return [...recommendations].sort(
      (a, b) => b.recommendationScore - a.recommendationScore
    );
  }

  /**
   * Diversity Protection
   */
  private applyDiversityProtection(
    recommendations: Recommendation[],
    limitPerVertical: number
  ): Recommendation[] {
    const verticalCounts = new Map<string, number>();
    const filtered: Recommendation[] = [];

    for (const recommendation of recommendations) {
      const primaryVertical = recommendation.verticals[0] ?? "unknown";
      const currentCount = verticalCounts.get(primaryVertical) ?? 0;

      if (currentCount >= limitPerVertical) {
        continue;
      }

      verticalCounts.set(primaryVertical, currentCount + 1);
      filtered.push(recommendation);
    }

    return filtered;
  }

  private buildPriorityMap(
    priorities: Priority[]
  ): Map<string, Priority> {
    return new Map(
      priorities.map(priority => [priority.clusterId, priority])
    );
  }

  private mergeContext(
    context: RecommendationContext
  ): Required<RecommendationContext> {
    return {
      ...DEFAULT_CONTEXT,
      ...context,
      weights: {
        ...DEFAULT_CONTEXT.weights,
        ...context.weights,
      },
    };
  }

  /**
   * Title Generation
   */
  private generateTitle(
    forecast: Forecast,
    type: RecommendationType
  ): string {
    const vertical = forecast.tags?.[0] ?? "General";

    switch (type) {
      case RecommendationType.STRATEGIC:
        return `Strategic Opportunity Detected in ${vertical}`;
      case RecommendationType.OPPORTUNISTIC:
        return `High Priority Trend in ${vertical}`;
      case RecommendationType.EXPLORATORY:
        return `Investigation Recommended for ${vertical}`;
      case RecommendationType.DEFENSIVE:
        return `Monitor Emerging Activity in ${vertical}`;
      default:
        return `Experimental Intelligence Signal in ${vertical}`;
    }
  }

  /**
   * Description Generation
   */
  private generateDescription(
    forecast: Forecast,
    priority: Priority
  ): string {
    return [
      `Forecast score: ${forecast.forecastScore.toFixed(2)}`,
      `Priority score: ${priority.priorityScore.toFixed(2)}`,
      `Confidence: ${priority.confidence.value.toFixed(2)}`,
    ].join(" | ");
  }
}

export default RecommendationEngine;
