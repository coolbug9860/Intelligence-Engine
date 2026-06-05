import { ReportSuggestion } from "../types";

/*
  Freshness Engine
  ----------------
  Purpose:
  - Apply deterministic time-decay scoring
  - Prioritize recent market intelligence
  - Reduce stale signal dominance
  - Improve urgency weighting

  Philosophy:
  Market intelligence loses commercial value over time.
  This engine applies predictable score decay
  based on signal age.
*/

function calculateAgeInHours(timestamp: number): number {

  const now = Date.now();

  const ageMs = now - timestamp;

  return ageMs / (1000 * 60 * 60);
}

function determineFreshnessModifier(ageHours: number): number {

  /*
    Time Decay Model
    ----------------

    0–24h     → 1.00  (no decay)
    1–3d      → 0.95
    3–7d      → 0.88
    7–14d     → 0.78
    14–30d    → 0.65
    30+d      → 0.45
  */

  if (ageHours <= 24) {
    return 1.0;
  }

  if (ageHours <= 72) {
    return 0.95;
  }

  if (ageHours <= 168) {
    return 0.88;
  }

  if (ageHours <= 336) {
    return 0.78;
  }

  if (ageHours <= 720) {
    return 0.65;
  }

  return 0.45;
}

function determineFreshnessLabel(ageHours: number): string {

  if (ageHours <= 24) {
    return "Real-Time";
  }

  if (ageHours <= 72) {
    return "Very Fresh";
  }

  if (ageHours <= 168) {
    return "Fresh";
  }

  if (ageHours <= 336) {
    return "Aging";
  }

  if (ageHours <= 720) {
    return "Stale";
  }

  return "Archival";
}

export function applyFreshnessScoring(
  suggestion: ReportSuggestion
): ReportSuggestion {

  const ageHours =
    calculateAgeInHours(suggestion.sourceArticleTimestamp);

  const freshnessModifier =
    determineFreshnessModifier(ageHours);

  const freshnessLabel =
    determineFreshnessLabel(ageHours);

  const adjustedOpportunityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        suggestion.opportunityScore * freshnessModifier
      )
    )
  );

  return {
    ...suggestion,

    opportunityScore: adjustedOpportunityScore,

    freshnessLabel
  };
}
