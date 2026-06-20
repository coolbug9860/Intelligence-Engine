/**
 * titleCoherenceEngine.ts
 *
 * Deterministic post-LLM guard for report-title/keyword quality.
 *
 * The analysis model (gemini-2.5-flash-lite) does not reliably obey the prompt's
 * title rules, so this engine ENFORCES them in code — independent of model compliance:
 *
 *   1. GEOGRAPHY-ONCE (auto-fix): a title must not carry two geographies. When a
 *      title leads with "Global" AND also names a country/region/nationality, the
 *      leading "Global" is dropped and a nationality adjective is normalized to its
 *      country noun (e.g. "Global Canadian Bank … Market" → "Canada Bank … Market").
 *
 *   2. EVENT-SUBJECT (cap-and-keep): a syndicated report subject must be a MARKET,
 *      not an event. Titles whose subject is an event/policy/macro concept
 *      (M&A, IPO, "sentiment", "inflation", "policy", …) cannot be safely rewritten
 *      deterministically, so the opportunity is kept but its opportunityScore is
 *      capped into PASS range so it can never surface as PUBLISH/MONITOR-high.
 *
 * Pure and side-effect-free except for console.warn diagnostics. No types.ts change
 * (reuses opportunityScore), no Gemini/model change.
 */

import { ReportSuggestion } from "../types";

/** opportunityScore ceiling for event-subject (non-market) titles — keeps them in PASS range. */
export const EVENT_SUBJECT_SCORE_CAP = 40;

/** Nationality / demonym adjective → canonical country (or region) noun. */
const NATIONALITY_TO_COUNTRY: Record<string, string> = {
  canadian: "Canada",
  american: "United States",
  indian: "India",
  chinese: "China",
  japanese: "Japan",
  korean: "South Korea",
  german: "Germany",
  french: "France",
  british: "United Kingdom",
  european: "Europe",
  australian: "Australia",
  brazilian: "Brazil",
  mexican: "Mexico",
  italian: "Italy",
  spanish: "Spain",
  russian: "Russia",
  saudi: "Saudi Arabia",
  emirati: "United Arab Emirates",
};

/** Country / region / nationality tokens that count as "geography is already present". */
const GEO_TOKENS: string[] = [
  // nationalities (also keys above)
  ...Object.keys(NATIONALITY_TO_COUNTRY),
  // country / region nouns
  "canada", "india", "china", "japan", "korea", "south korea", "germany", "france",
  "united kingdom", "europe", "european union", "australia", "brazil", "mexico",
  "italy", "spain", "russia", "saudi arabia", "united arab emirates", "united states",
  "asia", "asia pacific", "north america", "latin america", "south america",
  "middle east", "africa", "southeast asia", "gcc", "apac", "emea",
];

/**
 * Event / policy / macro tokens that signal the title's SUBJECT is not a market.
 * Matched as whole words/phrases. Conservative but non-destructive (cap-and-keep),
 * so a rare false positive only downranks — it never deletes.
 */
const EVENT_SUBJECT_TOKENS: string[] = [
  "m&a", "merger", "mergers", "acquisition", "acquisitions", "ipo", "buyout",
  "funding round", "venture funding", "investment sentiment", "sentiment",
  "inflation", "deflation", "interest rate", "lending policy", "monetary policy",
  "fiscal policy", "import policy", "export policy", "trade policy", "policy",
  "sanctions", "tariff", "tariffs", "earnings", "bankruptcy", "layoffs",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAnyWord(haystackLower: string, tokens: string[]): boolean {
  return tokens.some((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, "i").test(haystackLower));
}

/**
 * Enforce geography-once. Only acts when the string LEADS with "Global" and also
 * names another geography; otherwise returns the input unchanged.
 * `lowercaseResult` is used for marketKeyword (all-lowercase by contract).
 */
export function normalizeGeography(text: string, lowercaseResult = false): string {
  if (!text) return text;
  const leadGlobal = /^\s*global\s+/i;
  if (!leadGlobal.test(text)) return text;

  const rest = text.replace(leadGlobal, "");
  if (!containsAnyWord(rest.toLowerCase(), GEO_TOKENS)) {
    return text; // legitimate "Global" — no second geography present
  }

  const words = rest.split(/\s+/);
  const firstKey = words[0]?.toLowerCase().replace(/[^a-z]/g, "");
  if (firstKey && NATIONALITY_TO_COUNTRY[firstKey]) {
    words[0] = NATIONALITY_TO_COUNTRY[firstKey]; // "Canadian" → "Canada"
  }
  const result = words.join(" ");
  return lowercaseResult ? result.toLowerCase() : result;
}

/** True when the title/keyword subject is an event/policy/macro concept, not a market. */
export function isEventSubject(text: string): boolean {
  if (!text) return false;
  return containsAnyWord(text.toLowerCase(), EVENT_SUBJECT_TOKENS);
}

/**
 * Apply the deterministic coherence guard to one suggestion:
 *  - rewrite reportTitle + marketKeyword to satisfy geography-once,
 *  - cap opportunityScore for event-subject (non-market) titles.
 * Returns a new object; never throws.
 */
export function applyTitleCoherence(suggestion: ReportSuggestion): ReportSuggestion {
  const originalTitle = suggestion.reportTitle ?? "";
  const originalKeyword = suggestion.marketKeyword ?? "";

  const reportTitle = normalizeGeography(originalTitle);
  const marketKeyword = normalizeGeography(originalKeyword, true);

  if (reportTitle !== originalTitle) {
    console.warn(`[TitleCoherence] Geography normalized: "${originalTitle}" → "${reportTitle}"`);
  }

  let opportunityScore = suggestion.opportunityScore;
  if (isEventSubject(reportTitle) || isEventSubject(marketKeyword)) {
    const capped = Math.min(opportunityScore ?? 0, EVENT_SUBJECT_SCORE_CAP);
    if (capped !== opportunityScore) {
      console.warn(
        `[TitleCoherence] Event-subject title capped to ${capped} (was ${opportunityScore}): "${reportTitle}"`
      );
    }
    opportunityScore = capped;
  }

  return { ...suggestion, reportTitle, marketKeyword, opportunityScore };
}
