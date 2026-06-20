/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Intelligence Orchestrator
 * src/services/intelligenceOrchestrator.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * Central deterministic orchestration layer for the entire intelligence system.
 *
 * This service coordinates ALL intelligence engines into a single,
 * traceable, production-grade pipeline.
 *
 * WHY THIS EXISTS
 * ---------------
 * Without orchestration:
 * - engines become fragmented,
 * - outputs become inconsistent,
 * - frontend integration becomes unstable,
 * - future memory/RAG systems become difficult.
 *
 * The orchestrator creates:
 * - a unified intelligence state,
 * - deterministic execution order,
 * - centralized diagnostics,
 * - future extensibility.
 *
 * PIPELINE
 * --------
 * AI Signal Extraction
 *   → Source Authority
 *   → Validation
 *   → Taxonomy Normalization
 *   → Deterministic Scoring
 *   → Freshness Scoring
 *   → Deduplication
 *   → Diversity Protection
 *   → Reasoning
 *   → Intelligence Graph
 *   → Signal Propagation
 *   → Forecasting
 *
 * OUTPUT
 * ------
 * Returns a complete IntelligenceState object suitable for:
 * - dashboards,
 * - APIs,
 * - exports,
 * - vector indexing,
 * - RAG systems,
 * - future agentic memory systems.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { RSSArticle, ReportSuggestion, EDGARSignal } from '../types';
import type { VerticalCalibration } from './outcomeLedger';

import { analyzeNews } from './geminiService';

import { normalizeSourceAuthority } from './sourceAuthorityEngine';
import { validateSuggestion } from './validationEngine';
import { normalizeSuggestion } from './taxonomyEngine';
import { calculateOpportunityScore } from './scoringEngine';
import { applyFreshnessScoring } from './freshnessEngine';
import { applyTitleCoherence } from './titleCoherenceEngine';
import { runTemporalIntelligence } from './temporalIntelligenceEngine';

import {
  deduplicateSuggestions
} from './deduplicationEngine';


import {
  applyDiversityProtection,
  DiversityResult
} from './diversityEngine';

import {
  runReasoningEngine
} from './reasoningEngine';

import {
  buildIntelligenceGraph
} from './intelligenceGraphEngine';

import {
  runSignalPropagation
} from './signalPropagationEngine';

import {
  runForecastEngine
} from './forecastEngine';

import {
  evolveIntelligence,
  EvolutionReport
} from './evolutionEngine';

import {
  prioritizeIntelligence,
  PriorityReport
} from './priorityEngine';

import {
  ingestIntelligenceCycle,
  createEmptyMemory,
  IntelligenceMemory,
  MemorySnapshot
} from './memoryEngine';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineDiagnostics {
  rawSignals: number;
  deduplicatedSignals: number;
  curatedSignals: number;

  executionTimeMs: number;

  generatedAt: string;

  warnings: string[];

  pipelineStages: string[];
}

export interface IntelligenceState {

  // Raw AI outputs before heavy processing
  rawSignals: ReportSuggestion[];

  // Fully normalized/scored signals
  normalizedSignals: ReportSuggestion[];

  // Final curated portfolio
  curatedPortfolio: ReportSuggestion[];

  // Diversity diagnostics
  diversity: DiversityResult;

  // Strategic reasoning clusters
  reasoningClusters: any;

  // Intelligence graph
  intelligenceGraph: any;

  // Propagation analysis
  propagationAnalysis: any;

  // Forecast layer
  forecastAnalysis: any;

  // Evolution layer
  evolutionAnalysis: EvolutionReport;

  // Priority layer
  priorityAnalysis: PriorityReport;

  // Memory layer
  memoryState: IntelligenceMemory;

  // Diagnostics
  diagnostics: PipelineDiagnostics;

  // Metadata
  metadata: {
    pipelineVersion: string;
    generatedAt: string;
    articleCount: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

export async function runIntelligencePipeline(
  articles: RSSArticle[],
  watchlistTitles: string[] = [],
  previousMemory?: IntelligenceMemory,
  edgarSignals: EDGARSignal[] = [],
  calibration: VerticalCalibration = {}
): Promise<IntelligenceState> {

  // --- Browser execution: Fetch from Server API ---
  if (typeof window !== 'undefined') {
    const response = await fetch('/api/intelligence/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionStorage.getItem('kaiso_auth_token') ?? ''}` },
      body: JSON.stringify({ articles, watchlistTitles, previousMemory })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Intelligence Run Failed');
    }
    return response.json();
  }

  const startedAt = Date.now();

  const memory = previousMemory || createEmptyMemory();

  const warnings: string[] = [];

  const pipelineStages: string[] = [];

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 1 — AI SIGNAL EXTRACTION
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('AI Signal Extraction');

  // Extract recently surfaced opportunities from memory for novelty suppression.
  // Reads from prior cycles only (current cycle not yet ingested at this stage).
  // Capped at last 15 cycles to bound the list size.
  // anchorTitle is included so the suppression block can forbid reuse of the
  // same source article/filing as primary evidence across consecutive sessions.
  const recentlySurfaced = memory.cycles
    .slice(-15)
    .flatMap(cycle =>
      cycle.signals.map(s => ({
        reportTitle: s.reportTitle,
        vertical:    s.vertical as string,
        generatedAt: cycle.generatedAt,
        anchorTitle: s.sourceArticleTitle ?? undefined,
      }))
    );

  const rawSignals = await analyzeNews(articles, edgarSignals, recentlySurfaced);

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 2 — DETERMINISTIC NORMALIZATION PIPELINE
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Source Authority');
  pipelineStages.push('Validation');
  pipelineStages.push('Taxonomy Normalization');
  pipelineStages.push('Deterministic Scoring');
  pipelineStages.push('Freshness Scoring');

  const normalizedSignals = rawSignals.map(signal => {

    let processed = normalizeSourceAuthority(signal);

    processed = validateSuggestion(processed);

    processed = normalizeSuggestion(processed);

    processed = calculateOpportunityScore(processed, calibration);

    processed = applyFreshnessScoring(processed);

    // Deterministic guard: enforce geography-once on the title/keyword and cap
    // event-subject (non-market) titles into PASS range. Runs last so the final
    // (freshness-decayed) opportunityScore is what gets capped, and the cleaned
    // marketKeyword propagates to the Phase-2 whitespace/SERP check.
    processed = applyTitleCoherence(processed);

    return processed;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 2.5 — TEMPORAL INTELLIGENCE
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Temporal Intelligence');

  const temporallyGroundedSignals = runTemporalIntelligence(normalizedSignals);

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 3 — DEDUPLICATION
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Deduplication');

  const deduplicatedSignals =
    deduplicateSuggestions(temporallyGroundedSignals);

  // Gemini returns 10 so dedup has a buffer. If dedup collapses so aggressively
  // that we drop below 8, log a warning — it means Gemini produced several
  // near-identical opportunities despite the diversity rule, which points to
  // a sparse or highly concentrated signal batch worth investigating.
  if (deduplicatedSignals.length < 8) {
    console.warn(
      `[Dedup] Portfolio collapsed to ${deduplicatedSignals.length} after deduplication ` +
      `(started with ${temporallyGroundedSignals.length}). ` +
      `Check if Gemini returned thematically concentrated signals this cycle.`
    );
    warnings.push(
      `DEDUP_COLLAPSE: ${temporallyGroundedSignals.length} signals reduced to ${deduplicatedSignals.length} after deduplication. ` +
      `Signal batch may be thematically concentrated.`
    );
  }


  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 4 — SORTING
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Portfolio Ranking');

  const rankedSignals = [...deduplicatedSignals]
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 5 — DIVERSITY PROTECTION
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Diversity Protection');

  const diversity =
    applyDiversityProtection(rankedSignals);

  const curatedPortfolio = diversity.portfolio;

  warnings.push(...diversity.report.warnings);

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 6 — MULTI-SIGNAL REASONING
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Reasoning Engine');

  const reasoningResult =
    await runReasoningEngine(curatedPortfolio);

  const reasoningClusters = reasoningResult.clusters;

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 7 — INTELLIGENCE GRAPH
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Intelligence Graph');

  const intelligenceGraph =
    buildIntelligenceGraph(
      reasoningResult,
      curatedPortfolio
    );

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 8 — SIGNAL PROPAGATION
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Signal Propagation');

  const propagationAnalysis =
    runSignalPropagation(intelligenceGraph);

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 9 — FORECAST ENGINE
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Forecast Engine');

  const forecastAnalysis =
    runForecastEngine(curatedPortfolio);

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 10 — EVOLUTION CALIBRATION
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Evolution Calibration');

  // Map memory to simpler snapshot for evolution engine
  const memorySnapshots: MemorySnapshot[] = memory.cycles.slice(-10).map(c => ({
    clusters: c.signals.map(s => ({
      cluster: s.thematicCluster,
      classification: (s.opportunityScore >= 85 ? 'Supercycle' : (s.opportunityScore >= 70 ? 'Structural' : 'Emerging')) as any
    }))
  }));

  const evolutionAnalysis = evolveIntelligence({
    currentForecasts: forecastAnalysis.clusters,
    historicalMemory: memorySnapshots
  });

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 11 — STRATEGIC PRIORITIZATION
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Strategic Prioritization');

  const priorityAnalysis = prioritizeIntelligence({
    forecasts: forecastAnalysis.clusters,
    evolutionAssessments: evolutionAnalysis.assessments
  });

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 12 — MEMORY INGESTION
  // ───────────────────────────────────────────────────────────────────────────

  pipelineStages.push('Memory Ingestion');

  const memoryState = ingestIntelligenceCycle(memory, curatedPortfolio);

  // ───────────────────────────────────────────────────────────────────────────
  // FINAL DIAGNOSTICS
  // ───────────────────────────────────────────────────────────────────────────

  const executionTimeMs = Date.now() - startedAt;

  const diagnostics: PipelineDiagnostics = {
    rawSignals: rawSignals.length,
    deduplicatedSignals: deduplicatedSignals.length,
    curatedSignals: curatedPortfolio.length,

    executionTimeMs,

    generatedAt: new Date().toISOString(),

    warnings,

    pipelineStages
  };

  // ───────────────────────────────────────────────────────────────────────────
  // FINAL INTELLIGENCE STATE
  // ───────────────────────────────────────────────────────────────────────────

  return {

    rawSignals,

    normalizedSignals,

    curatedPortfolio,

    diversity,

    reasoningClusters,

    intelligenceGraph,

    propagationAnalysis,

    forecastAnalysis,

    evolutionAnalysis,

    priorityAnalysis,

    memoryState,

    diagnostics,

    metadata: {
      pipelineVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      articleCount: articles.length
    }
  };
}
