// src/services/retrievalEngine.ts

/**
 * Retrieval Engine
 * -------------------------------------------------------
 * Purpose:
 * Provides contextual intelligence retrieval,
 * historical pattern recall, semantic matching,
 * and relevance ranking.
 */

import {
  Forecast,
  Recommendation,
  Signal,
  normalizeScore,
  IntelligenceStatus,
  SEMANTIC_VERSION,
  BaseIntelligenceObject,
  ConfidenceScore,
} from "./schemaRegistry";

export interface RetrievalQuery {
  query: string;
  entities?: string[];
  tags?: string[];
  clusterId?: string;
  minimumConfidence?: number;
  limit?: number;
  recencyWeight?: number;
}

export interface RetrievalItemResult<T> {
  item: T;
  relevanceScore: number;
  similarityScore: number;
  confidenceScore: number;
  recencyScore: number;
  matchedEntities?: string[];
  matchedTags?: string[];
}

export interface RetrievalAnalysis extends BaseIntelligenceObject {
  totalResults: number;
  averageRelevance: number;
  recurringPatterns: string[];
  dominantEntities: string[];
  warnings: string[];
  metadata: {
    query: string;
    generatedAt: number;
  };
}

export interface RetrievalContext {
  similarityWeight?: number;
  confidenceWeight?: number;
  recencyWeight?: number;
  entityWeight?: number;
  tagWeight?: number;
}

const DEFAULT_CONTEXT: Required<RetrievalContext> = {
  similarityWeight: 0.35,
  confidenceWeight: 0.2,
  recencyWeight: 0.2,
  entityWeight: 0.15,
  tagWeight: 0.1,
};

export class RetrievalEngine {
  /**
   * Retrieve relevant signals
   */
  public retrieveSignals(
    query: RetrievalQuery,
    signals: Signal[],
    context: RetrievalContext = {}
  ): RetrievalItemResult<Signal>[] {
    const config = { ...DEFAULT_CONTEXT, ...context };

    return signals
      .map(signal => {
        const similarityScore = this.computeSimilarity(
          query.query,
          signal.title,
          signal.description
        );

        const confidenceVal = signal.confidence.value;
        const recencyScore = this.computeRecency(signal.timestamp);
        const entityScore = this.computeEntityMatch(query.entities, signal.entities);
        const tagScore = this.computeTagMatch(query.tags, signal.tags);

        const relevanceScore = normalizeScore(
          similarityScore * config.similarityWeight +
          confidenceVal * config.confidenceWeight +
          recencyScore * config.recencyWeight +
          entityScore * config.entityWeight +
          tagScore * config.tagWeight
        );

        return {
          item: signal,
          relevanceScore,
          similarityScore,
          confidenceScore: confidenceVal,
          recencyScore,
          matchedEntities: signal.entities?.filter(e => query.entities?.includes(e)) ?? [],
          matchedTags: signal.tags?.filter(t => query.tags?.includes(t)) ?? [],
        };
      })
      .filter(r => r.confidenceScore >= (query.minimumConfidence ?? 0))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, query.limit ?? 10);
  }

  /**
   * Retrieve relevant forecasts
   */
  public retrieveForecasts(
    query: RetrievalQuery,
    forecasts: Forecast[],
    context: RetrievalContext = {}
  ): RetrievalItemResult<Forecast>[] {
    const config = { ...DEFAULT_CONTEXT, ...context };

    return forecasts
      .map(forecast => {
        const similarityScore = this.computeSimilarity(query.query, forecast.classification, forecast.forecastHorizon);
        const confidenceVal = forecast.confidence.value;
        const recencyScore = this.computeRecency(forecast.createdAt);
        
        const relevanceScore = normalizeScore(
          similarityScore * config.similarityWeight +
          confidenceVal * config.confidenceWeight +
          recencyScore * config.recencyWeight
        );

        return {
          item: forecast,
          relevanceScore,
          similarityScore,
          confidenceScore: confidenceVal,
          recencyScore,
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, query.limit ?? 10);
  }

  public analyzeRetrieval<T>(
    results: RetrievalItemResult<T>[],
    query: string
  ): RetrievalAnalysis {
    const averageRelevance = results.length 
      ? results.reduce((s, r) => s + r.relevanceScore, 0) / results.length 
      : 0;

    return {
      id: `ret_${Date.now()}`,
      createdAt: Date.now(),
      status: IntelligenceStatus.ACTIVE,
      semanticVersion: SEMANTIC_VERSION,
      totalResults: results.length,
      averageRelevance: normalizeScore(averageRelevance),
      recurringPatterns: this.detectPatterns(results),
      dominantEntities: this.extractEntities(results),
      warnings: averageRelevance < 0.4 ? ["Low average relevance"] : [],
      metadata: {
        query,
        generatedAt: Date.now(),
      },
    };
  }

  private computeSimilarity(queryValue: string, primary?: string, secondary?: string): number {
    const q = queryValue.toLowerCase();
    const content = `${primary ?? ""} ${secondary ?? ""}`.toLowerCase();
    if (!content.trim()) return 0;
    const tokens = q.split(/\s+/);
    const matches = tokens.filter(t => content.includes(t));
    return normalizeScore(matches.length / (tokens.length || 1));
  }

  private computeEntityMatch(qEntities?: string[], tEntities?: string[]): number {
    if (!qEntities?.length || !tEntities?.length) return 0;
    const matches = qEntities.filter(e => tEntities.includes(e));
    return normalizeScore(matches.length / qEntities.length);
  }

  private computeTagMatch(qTags?: string[], tTags?: string[]): number {
    if (!qTags?.length || !tTags?.length) return 0;
    const matches = qTags.filter(t => tTags.includes(t));
    return normalizeScore(matches.length / qTags.length);
  }

  private computeRecency(timestamp?: number): number {
    if (!timestamp) return 0.5;
    const age = Date.now() - timestamp;
    const days = age / (1000 * 60 * 60 * 24);
    if (days <= 1) return 1;
    if (days <= 7) return 0.8;
    if (days <= 30) return 0.6;
    return 0.4;
  }

  private detectPatterns<T>(results: RetrievalItemResult<T>[]): string[] {
    return results.length >= 3 ? ["Recurring theme cluster detected"] : [];
  }

  private extractEntities<T>(results: RetrievalItemResult<T>[]): string[] {
    const counts = new Map<string, number>();
    results.forEach(r => {
      r.matchedEntities?.forEach(e => counts.set(e, (counts.get(e) ?? 0) + 1));
    });
    return Array.from(counts.entries()).sort((a,b) => b[1]-a[1]).slice(0, 5).map(e => e[0]);
  }
}

export default RetrievalEngine;
