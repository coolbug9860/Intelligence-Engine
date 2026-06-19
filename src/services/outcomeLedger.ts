/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE OS — Ground-Truth Outcome Ledger
 * src/services/outcomeLedger.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SERVER-ONLY. This module touches `fs`, the GitHub Contents API, and
 * google-trends-api (via trendsService). It must NEVER be imported by browser
 * code. scoringEngine/orchestrator consume only the `VerticalCalibration` TYPE
 * from here via `import type`, which is erased at build time.
 *
 * PURPOSE
 * -------
 * Closes the feedback loop. Two kinds of truth land in one keyed ledger:
 *   1. COMMERCIAL TRUTH (human)  — did a surfaced opportunity get COMMISSIONED,
 *      SOLD, or PASSED? Recorded via the UI → POST /api/outcomes/verdict.
 *   2. TREND TRUTH (automatic)   — at 30/60/90 days after surfacing, re-poll
 *      Google Trends for the keyword and score the original direction call.
 *
 * From the commercial truth we derive a bounded per-vertical calibration
 * multiplier that nudges future scoring toward verticals that actually sell.
 *
 * STORAGE STRATEGY
 * ----------------
 *   • Production (NODE_ENV !== 'development' AND GITHUB_PAT set):
 *       read/write src/data/outcomes.json via the GitHub Contents API so the
 *       ledger is git-versioned and survives Render's ephemeral disk.
 *   • Development / missing GITHUB_PAT:
 *       read/write the local file directly.
 *
 * All writes pass through a single async write-lock queue (read-modify-write
 * inside the lock) so simultaneous verdict clicks cannot clobber each other or
 * collide on a stale GitHub blob SHA.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import { Vertical, StrategicPillar } from '../types';
import { fetchKeywordTrend, TrendDirection } from './trendsService';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type Verdict = 'PENDING' | 'COMMISSIONED' | 'SOLD' | 'PASSED';

export interface TrendCheck {
  checkpoint: 30 | 60 | 90;            // days after surfacedAt
  checkedAt: string;                   // ISO
  trendScore: number;                  // actual Google Trends value at checkpoint
  delta: number;                       // trendScore - trendBaseline
  actualDirection: 'RISING' | 'STABLE' | 'DECLINING';
  predictionCorrect: boolean;          // predicted direction vs actual
}

export interface OutcomeRecord {
  opportunityId: string;               // ReportSuggestion.id — primary key
  reportTitle: string;
  vertical: Vertical;
  marketKeyword: string;
  strategicPillar?: StrategicPillar;

  verdict: Verdict;
  verdictAt?: string;
  verdictNote?: string;

  surfacedAt: string;                  // when the human first acted on it
  opportunityScoreAtSurface?: number;  // score snapshot — lets us measure if our score predicted sales
  trendBaseline?: number;              // trendScore at surface time
  trendDirectionPredicted?: TrendDirection;
  trendChecks: TrendCheck[];
}

/** Bounded per-vertical multiplier map consumed by scoringEngine. */
export interface VerticalCalibration {
  [vertical: string]: number;          // 0.90–1.10
}

/** Payload accepted by upsertVerdict (required fields are always sent by the UI). */
export interface VerdictInput {
  opportunityId: string;
  verdict: Verdict;
  vertical: Vertical;
  marketKeyword: string;
  reportTitle: string;
  strategicPillar?: StrategicPillar;
  opportunityScoreAtSurface?: number;
  trendBaseline?: number;
  trendDirectionPredicted?: TrendDirection;
  verdictNote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_LEDGER_PATH =
  process.env.OUTCOMES_FILE_PATH ??
  path.join(process.cwd(), 'src', 'data', 'outcomes.json');

const GITHUB_PAT = process.env.GITHUB_PAT ?? '';
const GITHUB_OWNER = process.env.GITHUB_REPO_OWNER ?? 'coolbug9860';
const GITHUB_REPO = process.env.GITHUB_REPO_NAME ?? 'Intelligence-Engine';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const GITHUB_LEDGER_PATH = process.env.GITHUB_LEDGER_PATH ?? 'src/data/outcomes.json';

/** Use GitHub persistence only outside development AND when a PAT is configured. */
function useGitHub(): boolean {
  return process.env.NODE_ENV !== 'development' && Boolean(GITHUB_PAT);
}

// Calibration rules
const MIN_SAMPLE = 3;          // a vertical needs ≥3 resolved outcomes to deviate from 1.0
const MULT_MIN = 0.9;
const MULT_MAX = 1.1;
const WIN_VALUE: Record<Verdict, number | null> = {
  SOLD: 1,         // win
  COMMISSIONED: 0.5, // half-win
  PASSED: 0,       // loss
  PENDING: null,   // ignored
};

// Trend re-check rules
const DAY_MS = 86_400_000;
const CHECKPOINTS: Array<30 | 60 | 90> = [30, 60, 90];
const MAX_CHECKS_PER_SWEEP = 5;   // bound Google Trends calls per run (rate-limit safety)
const STABLE_DELTA = 8;           // |delta| below this is treated as STABLE

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC WRITE-LOCK QUEUE
//
// Every mutation chains onto the previous one so read-modify-write stays atomic
// across concurrent requests. Rejections are swallowed at the chain level (each
// caller still gets its own resolved/rejected promise) so one failed write does
// not deadlock the queue.
// ─────────────────────────────────────────────────────────────────────────────

let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = writeChain.then(op, op);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL FILE I/O
// ─────────────────────────────────────────────────────────────────────────────

function localRead(): OutcomeRecord[] {
  try {
    if (!fs.existsSync(LOCAL_LEDGER_PATH)) return [];
    const raw = fs.readFileSync(LOCAL_LEDGER_PATH, 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[Ledger] Local read failed, returning empty:', err);
    return [];
  }
}

function localWrite(records: OutcomeRecord[]): void {
  fs.mkdirSync(path.dirname(LOCAL_LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LOCAL_LEDGER_PATH, JSON.stringify(records, null, 2), 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// GITHUB CONTENTS API I/O
// ─────────────────────────────────────────────────────────────────────────────

interface GitHubLedgerState {
  records: OutcomeRecord[];
  sha: string | null;   // null when the file does not yet exist on the branch
}

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${GITHUB_PAT}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'KaisoIntelligenceOS',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghGet(): Promise<GitHubLedgerState> {
  const url =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}` +
    `/contents/${GITHUB_LEDGER_PATH}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

  const res = await fetch(url, { headers: ghHeaders() });

  if (res.status === 404) return { records: [], sha: null };
  if (!res.ok) {
    throw new Error(`[Ledger] GitHub GET failed: ${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();
  const decoded = Buffer.from(data.content ?? '', 'base64').toString('utf-8').trim();
  const parsed = decoded ? JSON.parse(decoded) : [];
  return {
    records: Array.isArray(parsed) ? parsed : [],
    sha: typeof data.sha === 'string' ? data.sha : null,
  };
}

async function ghPut(
  records: OutcomeRecord[],
  sha: string | null,
  message: string
): Promise<void> {
  const url =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}` +
    `/contents/${GITHUB_LEDGER_PATH}`;

  const body = {
    message,
    content: Buffer.from(JSON.stringify(records, null, 2), 'utf-8').toString('base64'),
    branch: GITHUB_BRANCH,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`[Ledger] GitHub PUT failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: READ
// ─────────────────────────────────────────────────────────────────────────────

export async function readLedger(): Promise<OutcomeRecord[]> {
  if (useGitHub()) {
    try {
      return (await ghGet()).records;
    } catch (err) {
      console.warn('[Ledger] GitHub read failed, falling back to local file:', err);
      return localRead();
    }
  }
  return localRead();
}

/**
 * Read-modify-write through the write lock. For GitHub the blob SHA is fetched
 * fresh INSIDE the lock, so the PUT always targets the latest version.
 */
function persist(
  mutator: (records: OutcomeRecord[]) => OutcomeRecord[],
  message: string
): Promise<OutcomeRecord[]> {
  return enqueueWrite(async () => {
    if (useGitHub()) {
      const { records, sha } = await ghGet();
      const next = mutator(records);
      await ghPut(next, sha, message);
      return next;
    }
    const records = localRead();
    const next = mutator(records);
    localWrite(next);
    return next;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: UPSERT VERDICT (commercial truth)
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertVerdict(input: VerdictInput): Promise<OutcomeRecord[]> {
  const now = new Date().toISOString();

  return persist((records) => {
    const idx = records.findIndex((r) => r.opportunityId === input.opportunityId);

    if (idx >= 0) {
      // Update the verdict on an existing record; preserve surfacedAt, baseline,
      // and accumulated trendChecks so trend validation history is never lost.
      const existing = records[idx];
      records[idx] = {
        ...existing,
        verdict: input.verdict,
        verdictAt: now,
        verdictNote: input.verdictNote ?? existing.verdictNote,
      };
      return records;
    }

    // First time we have seen this opportunity — seed a record and capture the
    // trend baseline so the automatic loop can score the direction call later.
    records.push({
      opportunityId: input.opportunityId,
      reportTitle: input.reportTitle,
      vertical: input.vertical,
      marketKeyword: input.marketKeyword,
      strategicPillar: input.strategicPillar,
      verdict: input.verdict,
      verdictAt: now,
      verdictNote: input.verdictNote,
      surfacedAt: now,
      opportunityScoreAtSurface: input.opportunityScoreAtSurface,
      trendBaseline: input.trendBaseline,
      trendDirectionPredicted: input.trendDirectionPredicted,
      trendChecks: [],
    });
    return records;
  }, `chore(ledger): verdict ${input.verdict} for ${input.opportunityId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: TREND RE-CHECKS (automatic truth)
//
// Finds (record, checkpoint) pairs that are due and not yet recorded, re-polls
// Google Trends OUTSIDE the write lock (slow network), then commits the results
// in a single locked write. Bounded to MAX_CHECKS_PER_SWEEP per call to respect
// Google Trends rate limits. Designed to be fired on each daily pipeline run.
// ─────────────────────────────────────────────────────────────────────────────

export async function runDueTrendChecks(): Promise<{ checked: number }> {
  const records = await readLedger();
  const now = Date.now();

  const due: Array<{ id: string; checkpoint: 30 | 60 | 90 }> = [];
  for (const r of records) {
    if (!r.marketKeyword || r.trendBaseline === undefined) continue;
    const ageDays = (now - new Date(r.surfacedAt).getTime()) / DAY_MS;
    for (const cp of CHECKPOINTS) {
      const alreadyChecked = r.trendChecks.some((c) => c.checkpoint === cp);
      if (ageDays >= cp && !alreadyChecked) {
        due.push({ id: r.opportunityId, checkpoint: cp });
      }
    }
  }

  if (!due.length) return { checked: 0 };

  const batch = due.slice(0, MAX_CHECKS_PER_SWEEP);
  const completed = new Map<string, { id: string; checkpoint: 30 | 60 | 90; check: TrendCheck }>();

  for (const { id, checkpoint } of batch) {
    const rec = records.find((r) => r.opportunityId === id);
    if (!rec) continue;

    const trend = await fetchKeywordTrend(rec.marketKeyword);
    if (!trend) continue; // non-fatal: retried on a future sweep

    const baseline = rec.trendBaseline ?? 0;
    const delta = trend.trendScore - baseline;
    const actualDirection: TrendCheck['actualDirection'] =
      delta >= STABLE_DELTA ? 'RISING' : delta <= -STABLE_DELTA ? 'DECLINING' : 'STABLE';

    completed.set(`${id}:${checkpoint}`, {
      id,
      checkpoint,
      check: {
        checkpoint,
        checkedAt: new Date().toISOString(),
        trendScore: trend.trendScore,
        delta,
        actualDirection,
        predictionCorrect: rec.trendDirectionPredicted === actualDirection,
      },
    });
  }

  if (!completed.size) return { checked: 0 };

  await persist((recs) => {
    for (const { id, checkpoint, check } of completed.values()) {
      const r = recs.find((x) => x.opportunityId === id);
      if (r && !r.trendChecks.some((c) => c.checkpoint === checkpoint)) {
        r.trendChecks.push(check);
      }
    }
    return recs;
  }, `chore(ledger): trend checkpoint sweep (${completed.size} checks)`);

  return { checked: completed.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: VERTICAL CALIBRATION (commercial truth → scoring multiplier)
//
// SOLD = 1 (win), COMMISSIONED = 0.5 (half-win), PASSED = 0 (loss), PENDING
// ignored. A vertical needs ≥ MIN_SAMPLE resolved outcomes before its multiplier
// deviates from neutral; otherwise it is omitted (scoringEngine treats a missing
// key as 1.0). The success rate maps linearly onto a clamped 0.90–1.10 band so
// real outcomes nudge ranking without ever dominating the commercial core.
// ─────────────────────────────────────────────────────────────────────────────

export async function computeVerticalCalibration(): Promise<VerticalCalibration> {
  const records = await readLedger();

  const agg: Record<string, { sum: number; count: number }> = {};
  for (const r of records) {
    const value = WIN_VALUE[r.verdict];
    if (value === null || value === undefined) continue; // PENDING / unknown
    const key = String(r.vertical);
    if (!agg[key]) agg[key] = { sum: 0, count: 0 };
    agg[key].sum += value;
    agg[key].count += 1;
  }

  const calibration: VerticalCalibration = {};
  for (const [vertical, { sum, count }] of Object.entries(agg)) {
    if (count < MIN_SAMPLE) continue; // below sample gate → stays neutral (1.0)
    const successRate = sum / count; // 0..1
    const multiplier = MULT_MIN + successRate * (MULT_MAX - MULT_MIN);
    calibration[vertical] = Math.max(
      MULT_MIN,
      Math.min(MULT_MAX, parseFloat(multiplier.toFixed(4)))
    );
  }

  return calibration;
}
