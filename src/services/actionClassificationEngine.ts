/**
 * actionClassificationEngine.ts
 *
 * Converts the multi-signal scoring system into a single, unambiguous
 * commissioning decision for each opportunity.
 *
 * OUTPUT:
 *   actionVerdict   — 'PUBLISH NOW' | 'MONITOR' | 'PASS'
 *   actionReason    — one plain-English sentence explaining the verdict
 *   actionScore     — 0–100 composite score used to derive verdict
 *   actionUrgency   — 'HIGH' | 'MEDIUM' | 'LOW'
 *
 * DECISION LOGIC:
 *
 *  PUBLISH NOW  — All three green lights:
 *    1. Whitespace: CONFIRMED_GAP or PARTIAL_COVERAGE (not COMMODITISED)
 *    2. Trend: not DECLINING. RISING/STABLE confirm demand; UNKNOWN/unavailable is
 *       allowed through because Google Trends is unreliable on cloud IPs and a
 *       confirmed decline is already caught by the PASS veto below.
 *    3. Opportunity score ≥ 68 (commercial-viability bar; see PUBLISH_SCORE_THRESHOLD)
 *
 *  PASS  — Any one hard veto:
 *    - whiteSpaceStatus is COMMODITISED
 *    - trendDirection is DECLINING
 *    - opportunityScore < 45
 *    - executionRisk is 'High' AND regulatoryHurdle is 'Critical' (double-blocked)
 *
 *  MONITOR  — Everything else. Signal exists but timing or coverage isn't right.
 *
 * URGENCY:
 *   HIGH   — marketExecutionWindow is 'Immediate (0-3M)' OR trendScore > 65
 *   MEDIUM — marketExecutionWindow is 'Strategic (6-12M)' OR trendScore 35–65
 *   LOW    — everything else
 */

import { ReportSuggestion } from '../types';

export type ActionVerdict = 'PUBLISH NOW' | 'MONITOR' | 'PASS';
export type ActionUrgency = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ActionClassification {
  actionVerdict: ActionVerdict;
  actionReason: string;
  actionScore: number;    // 0–100 composite
  actionUrgency: ActionUrgency;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE SCORE
// Combines opportunityScore (already computed by scoringEngine) with
// whitespace and trend signals into a single 0–100 action score.
// ─────────────────────────────────────────────────────────────────────────────

function computeActionScore(s: ReportSuggestion): number {
  const base = s.opportunityScore ?? 50;

  // Whitespace component (0–30 bonus)
  const wsBonus =
    s.whiteSpaceStatus === 'CONFIRMED_GAP'    ? 30 :
    s.whiteSpaceStatus === 'PARTIAL_COVERAGE' ? 15 :
    s.whiteSpaceStatus === 'COMMODITISED'     ? -20 :
    0; // UNKNOWN — no adjustment

  // Trend component. Trimmed from ±20/+5 to ±10/+3 because real search demand now
  // also flows into opportunityScore (the actionScore BASE) via search-demand
  // grounding — so a large bonus here would double-count demand. The DECLINING
  // hard-veto lives in computeVerdict, independent of this sort bonus.
  const trendBonus =
    s.trendDirection === 'RISING'   ? 10 :
    s.trendDirection === 'STABLE'   ? 3  :
    s.trendDirection === 'DECLINING'? -10 :
    0; // UNKNOWN

  // Execution window component
  const windowBonus =
    s.marketExecutionWindow === 'Immediate (0-3M)'  ? 10 :
    s.marketExecutionWindow === 'Strategic (6-12M)' ? 5  :
    0;

  const raw = base + wsBonus + trendBonus + windowBonus;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ─────────────────────────────────────────────────────────────────────────────
// URGENCY
// ─────────────────────────────────────────────────────────────────────────────

function computeUrgency(s: ReportSuggestion): ActionUrgency {
  if (
    s.marketExecutionWindow === 'Immediate (0-3M)' ||
    (s.trendScore != null && s.trendScore > 65)
  ) return 'HIGH';

  if (
    s.marketExecutionWindow === 'Strategic (6-12M)' ||
    (s.trendScore != null && s.trendScore >= 35)
  ) return 'MEDIUM';

  return 'LOW';
}

// ─────────────────────────────────────────────────────────────────────────────
// VERDICT + REASON
// ─────────────────────────────────────────────────────────────────────────────

// PUBLISH NOW score gate. Raised from 62 → 68 after the EDGAR source-authority fix
// lifted the evidence gate uniformly: with commercial value now driving the spread,
// 62 promoted ~8 of 9 opportunities. 68 restores selectivity to a top slate (~4-5).
// Env-overridable (PUBLISH_SCORE_THRESHOLD) so the value can be re-tuned from the
// Render dashboard without a redeploy; falls back to 68 if unset/invalid.
const PUBLISH_SCORE_THRESHOLD = (() => {
  const n = Number(process.env.PUBLISH_SCORE_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? n : 68;
})();

// PASS floor — below this, commercial signal is too weak to commission.
const PASS_SCORE_FLOOR = 45;

function computeVerdict(
  s: ReportSuggestion,
  actionScore: number
): { verdict: ActionVerdict; reason: string } {

  const oppScore   = s.opportunityScore ?? 50;
  const ws         = s.whiteSpaceStatus;
  const trend      = s.trendDirection;
  const doubleBlocked =
    s.executionRisk === 'High' && s.regulatoryHurdle === 'Critical';

  // ── HARD VETO → PASS ────────────────────────────────────────────────────
  if (ws === 'COMMODITISED') {
    const names = s.whiteSpaceCompetitors?.join(', ') || 'multiple publishers';
    return {
      verdict: 'PASS',
      reason: `Already covered by ${names} — publishing now invites direct price competition with no differentiation advantage.`,
    };
  }

  if (trend === 'DECLINING') {
    return {
      verdict: 'PASS',
      reason: `Google Trends shows declining search interest — buyer urgency is contracting and the market window may be closing.`,
    };
  }

  if (oppScore < PASS_SCORE_FLOOR) {
    return {
      verdict: 'PASS',
      reason: `Opportunity score of ${oppScore} is below the commercial viability floor — insufficient evidence of buyer demand or segmentability.`,
    };
  }

  if (doubleBlocked) {
    return {
      verdict: 'PASS',
      reason: `High execution risk combined with critical regulatory hurdle makes this too risky to commission without further validation.`,
    };
  }

  // ── PUBLISH NOW ─────────────────────────────────────────────────────────
  const wsGreen  = ws === 'CONFIRMED_GAP' || ws === 'PARTIAL_COVERAGE';
  // No explicit trend gate here. A DECLINING trend is already a hard veto above
  // (→ PASS), so by this point the trend is RISING, STABLE, UNKNOWN, or null —
  // none of which should block PUBLISH NOW. We intentionally do NOT require a
  // positive trend: Google Trends is blocked/rate-limited on cloud IPs (Render)
  // and returns UNKNOWN most of the time, so demoting on UNKNOWN was hiding genuine
  // Confirmed-Gap opportunities for an infrastructure reason, not a market one.
  // The PUBLISH NOW reason still says "trend data unavailable" when applicable, so
  // the reviewer knows the trend is unverified.
  const scoreOk  = oppScore >= PUBLISH_SCORE_THRESHOLD;

  if (wsGreen && scoreOk) {
    const competitorCount = s.whiteSpaceCompetitors?.length ?? 0;
    const wsPhrase =
      ws === 'CONFIRMED_GAP'
        ? 'no major publishers have this title'
        : `only ${competitorCount} competing publisher${competitorCount === 1 ? '' : 's'} cover this niche`;
    const trendPhrase =
      trend === 'RISING'
        ? `search interest is rising (${s.trendScore ?? '—'})`
        : trend === 'STABLE'
        ? 'search interest is stable'
        : 'trend data unavailable';
    return {
      verdict: 'PUBLISH NOW',
      reason: `First-mover conditions met — ${wsPhrase}, ${trendPhrase}, and opportunity score is ${oppScore}.`,
    };
  }

  // ── MONITOR (default) ───────────────────────────────────────────────────
  const monitorReasons: string[] = [];

  if (!wsGreen) {
    if (ws === 'UNKNOWN') monitorReasons.push('competitor coverage could not be verified');
    else monitorReasons.push('partial competitor coverage detected');
  }
  if (!scoreOk) {
    monitorReasons.push(`opportunity score of ${oppScore} is below the publish threshold of ${PUBLISH_SCORE_THRESHOLD}`);
  }
  if (trend === 'UNKNOWN' || trend == null) {
    monitorReasons.push('trend direction is unclear');
  }

  const reason =
    monitorReasons.length > 0
      ? `Signal present but ${monitorReasons.join(' and ')} — revisit next cycle.`
      : `Not all green lights confirmed — monitor for signal strengthening.`;

  return { verdict: 'MONITOR', reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * classifyAction()
 *
 * Takes a scored ReportSuggestion (with whitespace + trend data attached)
 * and returns an ActionClassification. Non-destructive — returns a new
 * object with the four action fields added.
 */
export function classifyAction(s: ReportSuggestion): ReportSuggestion {
  const actionScore  = computeActionScore(s);
  const actionUrgency = computeUrgency(s);
  const { verdict, reason } = computeVerdict(s, actionScore);

  return {
    ...s,
    actionVerdict: verdict,
    actionReason:  reason,
    actionScore,
    actionUrgency,
  };
}

/**
 * classifyPortfolio()
 *
 * Runs classifyAction over every suggestion and returns the portfolio
 * sorted by actionScore descending so PUBLISH NOW items always surface first.
 */
export function classifyPortfolio(suggestions: ReportSuggestion[]): ReportSuggestion[] {
  return suggestions
    .map(classifyAction)
    .sort((a, b) => {
      // PUBLISH NOW first, then MONITOR, then PASS
      const order: Record<ActionVerdict, number> = { 'PUBLISH NOW': 0, 'MONITOR': 1, 'PASS': 2 };
      const aOrder = order[(a as any).actionVerdict as ActionVerdict] ?? 1;
      const bOrder = order[(b as any).actionVerdict as ActionVerdict] ?? 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same verdict, sort by actionScore
      return ((b as any).actionScore ?? 0) - ((a as any).actionScore ?? 0);
    });
}
