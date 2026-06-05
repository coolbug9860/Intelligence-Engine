import { ReportSuggestion } from "../types";

/*
  Deduplication Engine
  --------------------
  Purpose:
  - Suppress semantically overlapping opportunities
  - Preserve the strongest commercial signal
  - Reduce dashboard noise
  - Prevent opportunity score inflation

  Current Strategy:
  - Deterministic overlap detection
  - No embeddings/vector DB yet
  - Lightweight + production-safe
*/

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter(word => word.length > 2);
}

function calculateKeywordOverlap(a: string[], b: string[]): number {

  const setA = new Set(a);
  const setB = new Set(b);

  const intersection = [...setA].filter(word => setB.has(word));

  const overlap =
    intersection.length /
    Math.max(setA.size, setB.size);

  return overlap;
}

function isSemanticallySimilar(
  a: ReportSuggestion,
  b: ReportSuggestion
): boolean {

  // Strong deterministic anchors
  const sameVertical =
    a.vertical === b.vertical;

  const samePillar =
    a.strategicPillar === b.strategicPillar;

  // "Emerging Markets" is the fallback value assigned when Gemini returns a
  // null or empty thematicCluster (see geminiService.ts). Two signals that
  // both fell back to this value are NOT in the same cluster — they are
  // unknowns. Treating them as matching caused a 10→5 dedup collapse in
  // EDGAR-heavy sessions where Gemini omitted thematicCluster for all results.
  const FALLBACK_CLUSTER = normalizeText("Emerging Markets");
  const aCluster = normalizeText(a.thematicCluster);
  const bCluster = normalizeText(b.thematicCluster);
  const sameCluster =
    aCluster !== FALLBACK_CLUSTER &&
    bCluster !== FALLBACK_CLUSTER &&
    aCluster === bCluster;

  // Text comparison
  const titleOverlap = calculateKeywordOverlap(
    tokenize(a.reportTitle),
    tokenize(b.reportTitle)
  );

  const keywordOverlap = calculateKeywordOverlap(
    tokenize(a.marketKeyword),
    tokenize(b.marketKeyword)
  );

  /*
    Deduplication Rules
    -------------------
    Suppress if:
    - Same cluster + same pillar + high title overlap
    OR
    - Very high keyword overlap
  */

  if (
    sameCluster &&
    samePillar &&
    titleOverlap >= 0.55
  ) {
    return true;
  }

  if (
    sameVertical &&
    keywordOverlap >= 0.75
  ) {
    return true;
  }

  return false;
}

function chooseStrongerSignal(
  a: ReportSuggestion,
  b: ReportSuggestion
): ReportSuggestion {

  // Priority:
  // 1. Higher opportunity score
  // 2. Higher credibility
  // 3. Higher nexus convergence

  if (a.opportunityScore > b.opportunityScore) {
    return a;
  }

  if (b.opportunityScore > a.opportunityScore) {
    return b;
  }

  if (a.credibilityScore > b.credibilityScore) {
    return a;
  }

  if (b.credibilityScore > a.credibilityScore) {
    return b;
  }

  if (a.nexusArticlesCount > b.nexusArticlesCount) {
    return a;
  }

  return b;
}

export function deduplicateSuggestions(
  suggestions: ReportSuggestion[]
): ReportSuggestion[] {

  const finalSuggestions: ReportSuggestion[] = [];

  for (const current of suggestions) {

    let duplicateFound = false;

    for (let i = 0; i < finalSuggestions.length; i++) {

      const existing = finalSuggestions[i];

      if (isSemanticallySimilar(current, existing)) {

        duplicateFound = true;

        finalSuggestions[i] =
          chooseStrongerSignal(current, existing);

        break;
      }
    }

    if (!duplicateFound) {
      finalSuggestions.push(current);
    }
  }

  return finalSuggestions;
}
