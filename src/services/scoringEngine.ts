import { ReportSuggestion } from "../types";
import type { VerticalCalibration } from "./outcomeLedger";
import type { BlsReferenceTable } from "./blsReferenceService";

/**
 * Deterministic scoring engine for Kaiso Intelligence Hub.
 *
 * SCORING PHILOSOPHY — "prove it's real, then show me the money"
 * ──────────────────────────────────────────────────────────────────────────────
 * Kaiso sells the SAME syndicated report to many buyers, so the ranking must be
 * driven by COMMERCIAL VIABILITY (will this report sell?), not by how well-evidenced
 * the underlying trend is. Evidence still matters — but as a SAFETY GATE, not as the
 * thing that sorts winners.
 *
 * opportunityScore = commercialCore  ×  evidenceGate  ×  riskMultipliers
 *
 *   1. commercialCore (0–100) — THE DRIVER.
 *      A weighted blend of the six commercial factors the analysis model produces,
 *      weighted toward sell-ability (buyer willingness, quantifiability, search
 *      demand). This is what differentiates a $4k report buyers want from a
 *      well-documented topic nobody will pay for.
 *
 *   2. evidenceGate (0.45–1.0) — THE GATE (multiplier, never a booster).
 *      Built from confidence + source credibility. Strong evidence ≈ 1.0 (no
 *      penalty). Weak evidence pulls the score DOWN toward the PASS floor so an
 *      unproven idea cannot top the list on commercial promise alone. It can never
 *      push a commercially weak idea ABOVE its commercial ceiling.
 *
 *   3. riskMultipliers (≤1.0) — execution risk, regulatory hurdle, grounding.
 *
 * Net effect: among credible ideas, the most sellable rank highest; ideas that are
 * commercially strong but poorly evidenced get dampened into MONITOR/PASS territory.
 *
 * @param blsReference Optional, RESERVED macro reference table (Task 6 / Req 4.6, 4.7).
 *        Currently UNREAD — present only so future macro weighting can be wired in
 *        without changing call sites. Passing it does NOT change the output today.
 */
export function calculateOpportunityScore(
  suggestion: ReportSuggestion,
  calibration?: VerticalCalibration,
  blsReference?: BlsReferenceTable,
): ReportSuggestion {

  // ────────────────────────────────────────────────────────────────────────────
  // 1. COMMERCIAL CORE (0–100) — the primary ranking driver.
  // Built from the six commercial sub-scores (each 1–10) produced by the analysis
  // model, weighted toward what makes a syndicated report SELL. Each sub-score is
  // scaled ×10 to a 0–100 contribution.
  // ────────────────────────────────────────────────────────────────────────────
  const commercialWeights = {
    buyerWillingness:   0.30, // #1 signal: will a $100M+ enterprise pay $4k right now?
    quantifiability:    0.20, // can we credibly size the market? (report believability)
    seoSearchability:   0.20, // are buyers already searching this? (inbound demand)
    segmentability:     0.15, // can it be sliced into chapters? (justifies the price)
    cagrViability:      0.10, // is there a growth story buyers want?
    competitiveDensity: 0.05, // enough named players to profile (richness, more buyers)
  };

  // Fall back to the model's own composite, then a neutral 5, if any sub-score is
  // missing. geminiService defaults each of these to 5, so they are normally present.
  const fallback = suggestion.commercialViabilityScore ?? 5;
  const sub = {
    buyerWillingness:   suggestion.buyerWillingnessScore   ?? fallback,
    quantifiability:    suggestion.quantifiabilityScore    ?? fallback,
    seoSearchability:   suggestion.seoSearchabilityScore   ?? fallback,
    segmentability:     suggestion.segmentabilityScore     ?? fallback,
    cagrViability:      suggestion.cagrViabilityScore      ?? fallback,
    competitiveDensity: suggestion.competitiveDensityScore ?? fallback,
  };

  const commercialCore =
    (sub.buyerWillingness   * commercialWeights.buyerWillingness   * 10) +
    (sub.quantifiability    * commercialWeights.quantifiability    * 10) +
    (sub.seoSearchability   * commercialWeights.seoSearchability   * 10) +
    (sub.segmentability     * commercialWeights.segmentability     * 10) +
    (sub.cagrViability      * commercialWeights.cagrViability      * 10) +
    (sub.competitiveDensity * commercialWeights.competitiveDensity * 10);

  // ────────────────────────────────────────────────────────────────────────────
  // 2. EVIDENCE GATE (0.45–1.0) — a downward-only multiplier.
  // Combines confidence (evidence volume/quality, 1–10) and source credibility
  // (authority, 0–100). High evidence ≈ 1.0; weak evidence drags the score toward
  // the PASS floor. Range floor of 0.45 means even a commercially perfect (100) but
  // evidence-empty idea lands near 45 — borderline PASS — rather than topping the list.
  // ────────────────────────────────────────────────────────────────────────────
  const confidenceNorm  = Math.min(1, Math.max(0, (suggestion.confidenceScore ?? 5) / 10));
  const credibilityNorm = Math.min(1, Math.max(0, (suggestion.credibilityScore ?? 50) / 100));
  const evidenceQuality = (confidenceNorm * 0.6) + (credibilityNorm * 0.4);
  const evidenceGate    = 0.45 + (0.55 * evidenceQuality);

  // ────────────────────────────────────────────────────────────────────────────
  // 3. RISK MULTIPLIERS (≤1.0) — execution, regulatory, grounding dampeners.
  // ────────────────────────────────────────────────────────────────────────────
  let riskMultipliers = 1.0;

  if (suggestion.executionRisk === 'High') riskMultipliers *= 0.75;
  else if (suggestion.executionRisk === 'Medium') riskMultipliers *= 0.90;

  if (suggestion.regulatoryHurdle === 'Critical') riskMultipliers *= 0.70;
  else if (suggestion.regulatoryHurdle === 'Standard') riskMultipliers *= 0.85;

  // Grounding integrity: dampen if the model flagged a high inference ratio.
  const groundingIntegrity = 1.0 - (suggestion.inferenceRatio ?? 0) * 0.4;
  riskMultipliers *= groundingIntegrity;

  // ────────────────────────────────────────────────────────────────────────────
  // FINAL — commercial driver, gated by evidence, dampened by risk, then nudged
  // by REAL outcomes. The calibration multiplier (0.90–1.10) comes from the
  // ground-truth ledger's per-vertical sell-through rate; a missing key means a
  // vertical has not yet cleared the ≥3-outcome sample gate, so it stays neutral
  // at 1.0. Whitespace is intentionally NOT applied here (it is attached
  // post-pipeline and incorporated downstream in actionClassificationEngine).
  // ────────────────────────────────────────────────────────────────────────────
  const calibrationMultiplier = calibration?.[String(suggestion.vertical)] ?? 1.0;

  const adjustedScore = Math.round(
    commercialCore * evidenceGate * riskMultipliers * calibrationMultiplier
  );

  return {
    ...suggestion,
    opportunityScore: Math.max(0, Math.min(100, adjustedScore))
  };
}
