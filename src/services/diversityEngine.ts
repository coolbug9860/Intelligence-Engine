/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Strategic Diversity Engine
 * src/services/diversityEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  ReportSuggestion,
  Vertical,
  StrategicPillar,
  VERTICALS
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface DiversityConfig {
  maxPerVertical: number;
  maxPerPillar: number;
  maxPerThematicCluster: number;
  maxPerSourceDomain: number;
  targetPortfolioSize: number;
  weakSignalReservedSlots: number;
}

export const DEFAULT_CONFIG: DiversityConfig = {
  maxPerVertical: 3,
  maxPerPillar: 3,
  maxPerThematicCluster: 2,
  maxPerSourceDomain: 4,
  targetPortfolioSize: 20,
  weakSignalReservedSlots: 4
};

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface DiversityReport {
  inputCount: number;
  outputCount: number;
  diversityScore: number;
  coveredVerticals: Vertical[];
  uncoveredVerticals: Vertical[];
  warnings: string[];
  phaseLog: string[];
}

export interface DiversityResult {
  portfolio: ReportSuggestion[];
  bench: ReportSuggestion[];
  report: DiversityReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const parts = hostname.split('.');
    return parts.length >= 2
      ? parts.slice(-2).join('.')
      : hostname;
  } catch {
    return 'unknown';
  }
}

function clusterKey(cluster: string): string {
  return cluster
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
}

function computeDiversityScore(
  distribution: Map<Vertical, number>
): number {

  const counts = Array.from(distribution.values()).filter(v => v > 0);

  if (counts.length <= 1) return 0;

  const total = counts.reduce((a, b) => a + b, 0);

  let concentration = 0;

  for (const count of counts) {
    const share = count / total;
    concentration += share * share;
  }

  const diversity = (1 - concentration) * 100;

  return Math.round(
    Math.max(0, Math.min(100, diversity))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function applyDiversityProtection(
  candidates: ReportSuggestion[],
  config: Partial<DiversityConfig> = {}
): DiversityResult {

  const cfg = {
    ...DEFAULT_CONFIG,
    ...config
  };

  const phaseLog: string[] = [];
  const warnings: string[] = [];

  if (!candidates.length) {
    return {
      portfolio: [],
      bench: [],
      report: {
        inputCount: 0,
        outputCount: 0,
        diversityScore: 0,
        coveredVerticals: [],
        uncoveredVerticals: [...VERTICALS],
        warnings: [],
        phaseLog: ['No candidates received']
      }
    };
  }

  // IMPORTANT:
  // Entire engine now uses opportunityScore
  // instead of confidenceScore.

  const sortedCandidates = [...candidates].sort(
    (a, b) => b.opportunityScore - a.opportunityScore
  );

  const portfolio: ReportSuggestion[] = [];
  const bench: ReportSuggestion[] = [];

  const verticalMap = new Map<Vertical, number>();
  const pillarMap = new Map<StrategicPillar, number>();
  const clusterMap = new Map<string, number>();
  const domainMap = new Map<string, number>();

  const primarySlots =
    cfg.targetPortfolioSize - cfg.weakSignalReservedSlots;

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 1 — DYNAMIC DIVERSITY SELECTION (SOFT-THRESHOLD)
  // ───────────────────────────────────────────────────────────────────────────

  phaseLog.push(
    `Phase 1: Selecting top ${cfg.targetPortfolioSize} signals using soft-threshold logic.`
  );

  const remaining = [...sortedCandidates];

  while (portfolio.length < cfg.targetPortfolioSize && remaining.length > 0) {
    
    // Re-evaluate each candidate based on current portfolio saturation
    let bestCandidateIdx = -1;
    let highestAdjustedScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const verticalCount = verticalMap.get(c.vertical) ?? 0;
      const pillarCount = pillarMap.get(c.strategicPillar) ?? 0;
      const cluster = clusterKey(c.thematicCluster);
      const clusterCount = clusterMap.get(cluster) ?? 0;
      const domain = extractDomain(c.sourceArticleUrl);
      const domainCount = domainMap.get(domain) ?? 0;

      // Calculate Saturation Penalties (Soft-Thresholds)
      let penalty = 1.0;
      
      // Vertical Saturation: Linear decay after threshold
      if (verticalCount >= cfg.maxPerVertical) {
        penalty *= Math.pow(0.5, (verticalCount - cfg.maxPerVertical) + 1);
      }

      // Pillar Saturation
      if (pillarCount >= cfg.maxPerPillar) {
        penalty *= 0.7;
      }

      // Thematic Cluster Saturation (Heavy penalty for redundancy)
      if (clusterCount >= cfg.maxPerThematicCluster) {
        penalty *= 0.4;
      }

      // Source Domain Anti-Monopoly
      if (domainCount >= cfg.maxPerSourceDomain) {
        penalty *= 0.3;
      }

      const adjustedScore = c.opportunityScore * penalty;

      if (adjustedScore > highestAdjustedScore) {
        highestAdjustedScore = adjustedScore;
        bestCandidateIdx = i;
      }
    }

    if (bestCandidateIdx === -1) break;

    const selected = remaining.splice(bestCandidateIdx, 1)[0];
    portfolio.push(selected);

    // Update Saturation Maps
    verticalMap.set(selected.vertical, (verticalMap.get(selected.vertical) ?? 0) + 1);
    pillarMap.set(selected.strategicPillar, (pillarMap.get(selected.strategicPillar) ?? 0) + 1);
    clusterMap.set(clusterKey(selected.thematicCluster), (clusterMap.get(clusterKey(selected.thematicCluster)) ?? 0) + 1);
    domainMap.set(extractDomain(selected.sourceArticleUrl), (domainMap.get(extractDomain(selected.sourceArticleUrl)) ?? 0) + 1);
  }

  bench.push(...remaining);

  phaseLog.push(
    `Phase 1 complete: ${portfolio.length} signals selected through soft-thresholding.`
  );


  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 2 — WEAK SIGNAL RESCUE
  // ───────────────────────────────────────────────────────────────────────────

  const uncoveredVerticals = VERTICALS.filter(v =>
    !portfolio.some(p => p.vertical === v)
  );

  if (uncoveredVerticals.length > 0) {

    phaseLog.push(
      `Phase 2: Weak signal rescue for ${uncoveredVerticals.length} uncovered verticals.`
    );

    for (const vertical of uncoveredVerticals) {

      if (portfolio.length >= cfg.targetPortfolioSize) {
        break;
      }

      const rescueCandidate = sortedCandidates.find(
        c =>
          c.vertical === vertical &&
          !portfolio.some(p => p.id === c.id)
      );

      if (!rescueCandidate) {
        continue;
      }

      portfolio.push(rescueCandidate);

      phaseLog.push(
        `Rescued vertical "${vertical}" with score ${rescueCandidate.opportunityScore}.`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 3 — FINAL SORTING
  // ───────────────────────────────────────────────────────────────────────────

  portfolio.sort(
    (a, b) => b.opportunityScore - a.opportunityScore
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REPORTING
  // ───────────────────────────────────────────────────────────────────────────

  const finalVerticalMap = new Map<Vertical, number>();

  for (const item of portfolio) {
    finalVerticalMap.set(
      item.vertical,
      (finalVerticalMap.get(item.vertical) ?? 0) + 1
    );
  }

  const coveredVerticals = VERTICALS.filter(
    v => (finalVerticalMap.get(v) ?? 0) > 0
  );

  const uncoveredFinal = VERTICALS.filter(
    v => (finalVerticalMap.get(v) ?? 0) === 0
  );

  const diversityScore =
    computeDiversityScore(finalVerticalMap);

  if (diversityScore < 40) {
    warnings.push(
      'Portfolio diversity is low. Consider expanding RSS coverage.'
    );
  }

  if (uncoveredFinal.length > 5) {
    warnings.push(
      `${uncoveredFinal.length} verticals have zero coverage.`
    );
  }

  phaseLog.push(
    `Final portfolio generated with diversity score ${diversityScore}/100.`
  );

  return {
    portfolio,
    bench,
    report: {
      inputCount: candidates.length,
      outputCount: portfolio.length,
      diversityScore,
      coveredVerticals,
      uncoveredVerticals: uncoveredFinal,
      warnings,
      phaseLog
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export function curatePortfolio(
  candidates: ReportSuggestion[],
  config?: Partial<DiversityConfig>
): ReportSuggestion[] {

  return applyDiversityProtection(
    candidates,
    config
  ).portfolio;
}
