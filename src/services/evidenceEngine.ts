// src/services/evidenceEngine.ts

/**
 * Evidence Engine
 * -------------------------------------------------------
 * Purpose:
 * Provides evidence attribution, corroboration,
 * provenance tracking, contradiction detection,
 * and evidence strength analysis.
 */

import {
  Evidence,
  Forecast,
  Recommendation,
  Signal,
  IntelligenceStatus,
  SEMANTIC_VERSION,
  normalizeConfidence,
  normalizeScore,
  ConfidenceBand,
} from "./schemaRegistry";

export interface EvidenceChain {
  chainId: string;
  recommendationId?: string;
  forecastId?: string;
  signalIds: string[];
  evidenceIds: string[];
  chainStrength: number;
  contradictionsDetected: number;
  corroborationScore: number;
}

export interface EvidenceAnalysisResult {
  overallEvidenceStrength: number;
  corroborationScore: number;
  contradictionScore: number;
  provenanceCompleteness: number;
  groundedConfidence: number;
  evidenceChains: EvidenceChain[];
  warnings: string[];
  generatedAt: number;
}

export interface EvidenceEngineContext {
  minimumEvidenceStrength?: number;
  contradictionPenalty?: number;
  corroborationWeight?: number;
  authorityWeight?: number;
}

const DEFAULT_CONTEXT: Required<EvidenceEngineContext> = {
  minimumEvidenceStrength: 0.4,
  contradictionPenalty: 0.2,
  corroborationWeight: 0.35,
  authorityWeight: 0.35,
};

export class EvidenceEngine {
  public analyzeEvidence(
    signals: Signal[],
    evidence: Evidence[],
    forecasts: Forecast[],
    recommendations: Recommendation[],
    context: EvidenceEngineContext = {}
  ): EvidenceAnalysisResult {
    const config = {
      ...DEFAULT_CONTEXT,
      ...context,
    };

    const evidenceChains = this.buildEvidenceChains(
      signals,
      evidence,
      forecasts,
      recommendations
    );

    const corroborationScore = this.computeCorroborationScore(evidenceChains);
    const contradictionScore = this.computeContradictionScore(evidenceChains);
    const provenanceCompleteness = this.computeProvenanceCompleteness(evidenceChains);
    const overallEvidenceStrength = this.computeOverallEvidenceStrength(evidence);

    const groundedConfidence = this.computeGroundedConfidence(
      corroborationScore,
      contradictionScore,
      overallEvidenceStrength
    );

    const warnings = this.generateWarnings({
      corroborationScore,
      contradictionScore,
      provenanceCompleteness,
      overallEvidenceStrength,
    });

    return {
      overallEvidenceStrength,
      corroborationScore,
      contradictionScore,
      provenanceCompleteness,
      groundedConfidence,
      evidenceChains,
      warnings,
      generatedAt: Date.now(),
    };
  }

  private buildEvidenceChains(
    signals: Signal[],
    evidence: Evidence[],
    forecasts: Forecast[],
    recommendations: Recommendation[]
  ): EvidenceChain[] {
    const chains: EvidenceChain[] = [];

    for (const recommendation of recommendations) {
      const relatedForecasts = forecasts.filter(
        f => f.clusterId === recommendation.clusterId
      );

      const signalIds = new Set<string>();
      const evidenceIds = new Set<string>();

      for (const forecast of relatedForecasts) {
        forecast.signalIds.forEach(id => signalIds.add(id));
        forecast.supportingEvidence?.forEach(id => evidenceIds.add(id));
      }

      const corroborationScore = this.computeChainCorroboration(
        Array.from(signalIds),
        evidence
      );

      const contradictionsDetected = this.detectContradictions(
        Array.from(signalIds),
        signals
      );

      const chainStrength = normalizeScore(
        corroborationScore - contradictionsDetected * 0.1
      );

      chains.push({
        chainId: `chain_${recommendation.id}`,
        recommendationId: recommendation.id,
        forecastId: relatedForecasts[0]?.id,
        signalIds: Array.from(signalIds),
        evidenceIds: Array.from(evidenceIds),
        chainStrength,
        contradictionsDetected,
        corroborationScore,
      });
    }

    return chains;
  }

  private computeCorroborationScore(chains: EvidenceChain[]): number {
    if (!chains.length) return 0;
    const avg = chains.reduce((s, c) => s + c.corroborationScore, 0) / chains.length;
    return normalizeScore(avg);
  }

  private computeChainCorroboration(signalIds: string[], evidence: Evidence[]): number {
    if (!signalIds.length) return 0;
    let matches = 0;
    for (const e of evidence) {
      // Logic for matching evidence to signals could be more complex, keeping it simple
      const hasMatch = e.metadata?.supportingSignals 
        ? (e.metadata.supportingSignals as string[]).some(id => signalIds.includes(id))
        : false;
      if (hasMatch) matches++;
    }
    return normalizeScore(matches / signalIds.length);
  }

  private detectContradictions(signalIds: string[], signals: Signal[]): number {
    const relevant = signals.filter(s => signalIds.includes(s.id));
    let count = 0;
    for (let i = 0; i < relevant.length; i++) {
      for (let j = i + 1; j < relevant.length; j++) {
        const delta = Math.abs(relevant[i].importanceWeight - relevant[j].importanceWeight);
        if (delta >= 0.7) count++;
      }
    }
    return count;
  }

  private computeContradictionScore(chains: EvidenceChain[]): number {
    if (!chains.length) return 0;
    const total = chains.reduce((s, c) => s + c.contradictionsDetected, 0);
    return normalizeScore(1 - total / (chains.length || 1));
  }

  private computeProvenanceCompleteness(chains: EvidenceChain[]): number {
    if (!chains.length) return 0;
    const complete = chains.filter(c => c.signalIds.length > 0 && c.evidenceIds.length > 0).length;
    return normalizeScore(complete / chains.length);
  }

  private computeOverallEvidenceStrength(evidence: Evidence[]): number {
    if (!evidence.length) return 0;
    const avg = evidence.reduce((s, e) => s + e.reliabilityScore, 0) / evidence.length;
    return normalizeScore(avg);
  }

  private computeGroundedConfidence(
    corroboration: number,
    contradiction: number,
    strength: number
  ): number {
    const score = corroboration * 0.4 + contradiction * 0.3 + strength * 0.3;
    return normalizeConfidence(score);
  }

  private generateWarnings(scores: Record<string, number>): string[] {
    const warnings: string[] = [];
    if (scores.corroborationScore < 0.5) warnings.push("Low corroboration detected");
    if (scores.contradictionScore < 0.5) warnings.push("Evidence contradictions increasing");
    if (scores.overallEvidenceStrength < 0.5) warnings.push("Weak evidence strength detected");
    return warnings;
  }
}

export default EvidenceEngine;
