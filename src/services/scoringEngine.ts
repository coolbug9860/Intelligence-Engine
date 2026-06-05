import { ReportSuggestion } from "../types";

/**
 * Deterministic scoring engine for Kaiso Intelligence Hub.
 * Calculates a weighted opportunityScore (0-100) based on commercial logic.
 */
export function calculateOpportunityScore(suggestion: ReportSuggestion): ReportSuggestion {
  
  // HARDENING: Normalized weighted model to prevent additive drift
  const weights = {
    confidence: 0.35,
    credibility: 0.25,
    marketDensity: 0.20,
    salesPotential: 0.20
  };

  // 1. Normalize Inputs (0-100)
  const confidenceVal = (suggestion.confidenceScore / 10) * 100;
  const credibilityVal = suggestion.credibilityScore || 50;
  
  // Signal density: how many corroborating signals support this opportunity.
  // Use signalCount — geminiService populates it on every suggestion. The legacy
  // nexusArticlesCount field is never set by the analysis stage, so reading it made
  // this entire 20% component a constant (1 → 6.67) for every opportunity. Fall
  // back through both for safety. Cap at 15 for linear scaling, then log decay.
  const nexusCount = suggestion.signalCount ?? suggestion.nexusArticlesCount ?? 1;
  const marketDensityVal = nexusCount <= 15 
    ? (nexusCount / 15) * 100 
    : 100 + (Math.log(nexusCount - 14) * 5); 
  
  const salesMap = { 'High': 100, 'Medium': 65, 'Emerging': 40 };
  const salesVal = salesMap[suggestion.salesPotential] || 50;

  // 2. Weighted Base Calculation
  let baseScore = (
    (confidenceVal * weights.confidence) +
    (credibilityVal * weights.credibility) +
    (marketDensityVal * weights.marketDensity) +
    (salesVal * weights.salesPotential)
  );

  // 3. Multiplicative Risk Dampening (Strategic Hardening)
  let multipliers = 1.0;

  if (suggestion.executionRisk === 'High') multipliers *= 0.75;
  else if (suggestion.executionRisk === 'Medium') multipliers *= 0.90;

  if (suggestion.regulatoryHurdle === 'Critical') multipliers *= 0.70;
  else if (suggestion.regulatoryHurdle === 'Standard') multipliers *= 0.85;

  // Grounding Integrity Multiplier
  const groundingIntegrity = 1.0 - (suggestion.inferenceRatio || 0) * 0.4;
  multipliers *= groundingIntegrity;

  // 4. White Space — intentionally NOT applied here.
  // Whitespace data is attached post-pipeline (server.ts → enrichWithWhiteSpaceDetection),
  // which runs AFTER this scoring stage. At this point suggestion.whiteSpaceStatus is
  // always undefined, so the old ±8 adjustment was dead code that never fired.
  // Whitespace is incorporated downstream in actionClassificationEngine.computeActionScore
  // (±30/−20 on actionScore) — the score the final portfolio is actually ranked and
  // verdicted on. Applying a bonus here too would double-count whitespace in the
  // PUBLISH NOW threshold check (oppScore >= 62), so it is deliberately omitted.
  const adjustedScore = Math.round(baseScore * multipliers);

  return {
    ...suggestion,
    opportunityScore: Math.max(0, Math.min(100, adjustedScore))
  };
}
