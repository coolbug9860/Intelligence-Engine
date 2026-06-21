/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE HUB — Council Review Engine (advisory-only)
 * src/services/councilEngine.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * Inspired by Karpathy's "LLM Council" deliberation pattern, but Gemini-only and
 * cost-aware. For BORDERLINE opportunities (actionVerdict === 'MONITOR'), it asks
 * Gemini to deliberate from two independent perspectives and then synthesize:
 *
 *   - Skeptic  → is this genuinely differentiated, or already commoditised?
 *   - Buyer    → would a $100M+ enterprise actually pay $4,000–$8,000 for it?
 *   - Chairman → one-line synthesis weighing both, plus an advisory 0–10 score.
 *
 * COST CONTROL
 * ------------
 * All three perspectives are produced in a SINGLE structured Gemini call per
 * opportunity (not three round-trips), and only MONITOR-verdict items are
 * reviewed — clear PUBLISH/PASS items are skipped entirely.
 *
 * SAFETY
 * ------
 * ADVISORY ONLY. This engine NEVER mutates opportunityScore, confidenceScore,
 * actionVerdict, or any field the downstream pipeline reads. It only attaches an
 * additive `councilReview` annotation. Any failure (parse, timeout, quota) leaves
 * the opportunity completely unchanged.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Type } from "@google/genai";
import { ReportSuggestion } from "../types";
import { keyManager } from "./geminiService";

// Local model + timeout constants. Defined here (never in geminiService.ts) so
// this engine does not alter any existing model settings. flash-lite keeps the
// per-item cost low — this is an advisory second opinion, not the primary score.
const COUNCIL_MODEL = "gemini-2.5-flash-lite";
const COUNCIL_TIMEOUT_MS = 30000;

// Hard cap on how many borderline items we review per cycle, so a large MONITOR
// batch can never produce an unbounded number of billable calls.
const MAX_REVIEWS_PER_CYCLE = 6;

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL LLM TYPES (not exported, never cross the engine boundary)
// ─────────────────────────────────────────────────────────────────────────────

interface CouncilEnvelope {
  skepticNote: string;
  buyerNote: string;
  chairmanVerdict: string;
  suggestedConfidence: number; // 0–10, advisory only
}

const COUNCIL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    skepticNote: { type: Type.STRING },
    buyerNote: { type: Type.STRING },
    chairmanVerdict: { type: Type.STRING },
    suggestedConfidence: { type: Type.NUMBER },
  },
  required: ["skepticNote", "buyerNote", "chairmanVerdict", "suggestedConfidence"],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Council review timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function buildCouncilPrompt(s: ReportSuggestion): string {
  // Project only the fields the reviewers need. Keeps the prompt small/cheap.
  const facts = {
    reportTitle: s.reportTitle,
    marketKeyword: s.marketKeyword,
    vertical: s.vertical,
    trigger: s.trigger ?? "",
    rationale: s.b2bCommercialRationale ?? s.rationale ?? "",
    estimatedCAGRRange: s.estimatedCAGRRange ?? "",
    whiteSpaceStatus: s.whiteSpaceStatus ?? "UNKNOWN",
    knownCompetitors: s.whiteSpaceCompetitors ?? [],
    currentVerdict: s.actionVerdict ?? "",
    currentVerdictReason: s.actionReason ?? "",
  };

  return [
    "You are a 3-member investment council reviewing a borderline syndicated-research",
    "opportunity for Kaiso Research & Consulting. Kaiso sells syndicated B2B market",
    "reports priced at $4,000–$8,000 to large enterprises ($100M+ revenue).",
    "",
    "Deliberate from THREE independent roles, then return STRICT JSON only:",
    "",
    '  1. skepticNote — As a hard-nosed skeptic, judge differentiation. Is this',
    "     genuinely under-served, or already commoditised by existing report",
    "     publishers? Cite the known competitors if relevant. One or two sentences.",
    "",
    '  2. buyerNote — As a prospective enterprise buyer, judge willingness to pay',
    "     $4k–$8k. Who exactly buys it and why? Is the budget justified? One or two",
    "     sentences.",
    "",
    '  3. chairmanVerdict — Weigh the skeptic and buyer into ONE decisive sentence.',
    "",
    '  4. suggestedConfidence — A 0–10 number (one decimal allowed) reflecting the',
    "     council's confidence this is worth publishing. ADVISORY ONLY.",
    "",
    "Be concise and concrete. No markdown, no preamble, JSON only.",
    "",
    "OPPORTUNITY:",
    JSON.stringify(facts, null, 2),
  ].join("\n");
}

async function reviewOne(s: ReportSuggestion): Promise<CouncilEnvelope | null> {
  const prompt = buildCouncilPrompt(s);

  const call = keyManager.call((client, keyMasked) => {
    console.info(`[Council] Reviewing "${s.marketKeyword}" via ${COUNCIL_MODEL}. [${keyMasked}]`);
    return client.models.generateContent({
      model: COUNCIL_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: COUNCIL_SCHEMA as any,
      },
    });
  });

  const response = await withTimeout(call, COUNCIL_TIMEOUT_MS);

  // `.text` is a getter in current @google/genai, a method in older SDKs.
  const responseAny = response as any;
  const raw =
    typeof responseAny.text === "function" ? await responseAny.text() : responseAny.text;
  let text = (raw ?? "").trim();
  if (!text) return null;
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n/i, "").replace(/\n```$/g, "");
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const env = parsed as Partial<CouncilEnvelope>;
    if (
      typeof env.skepticNote !== "string" ||
      typeof env.buyerNote !== "string" ||
      typeof env.chairmanVerdict !== "string"
    ) {
      return null;
    }
    const conf = Number(env.suggestedConfidence);
    return {
      skepticNote: env.skepticNote.trim(),
      buyerNote: env.buyerNote.trim(),
      chairmanVerdict: env.chairmanVerdict.trim(),
      suggestedConfidence: Number.isFinite(conf) ? Math.max(0, Math.min(10, conf)) : 0,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — advisory-only, fault-tolerant, never mutates scoring fields
// ─────────────────────────────────────────────────────────────────────────────

export async function runCouncilReview(
  portfolio: ReportSuggestion[]
): Promise<ReportSuggestion[]> {
  if (!portfolio?.length) return portfolio;

  // Borderline = MONITOR. These are the only items where a second opinion adds
  // value; clear PUBLISH/PASS verdicts are skipped to control cost.
  const borderlineIds = new Set(
    portfolio
      .filter((s) => s.actionVerdict === "MONITOR")
      .slice(0, MAX_REVIEWS_PER_CYCLE)
      .map((s) => s.id)
  );

  if (borderlineIds.size === 0) {
    console.info("[Council] No borderline (MONITOR) opportunities this cycle — skipped.");
    return portfolio;
  }

  let reviewed = 0;

  // Sequential by design: bounded batch, avoids hammering the shared key pool.
  const result: ReportSuggestion[] = [];
  for (const s of portfolio) {
    if (!borderlineIds.has(s.id)) {
      result.push(s);
      continue;
    }
    try {
      const review = await reviewOne(s);
      if (review) {
        reviewed++;
        result.push({ ...s, councilReview: review });
      } else {
        result.push(s); // parse/empty → leave unchanged
      }
    } catch (err) {
      console.warn(
        `[Council] Review failed for "${s.marketKeyword}" — leaving unchanged: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      result.push(s);
    }
  }

  console.info(`[Council] Advisory review complete — ${reviewed}/${borderlineIds.size} annotated.`);
  return result;
}
