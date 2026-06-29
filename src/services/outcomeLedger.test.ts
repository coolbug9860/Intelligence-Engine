/**
 * outcomeLedger.test.ts
 *
 * Feature: ground-truth feedback loop — stable identity + PENDING auto-seed.
 *
 * Covers the parts the auto-seed enhancement introduced:
 *   - stableOpportunityKey: deterministic, slugged, semantic identity.
 *   - seedPendingOutcomes: idempotent, never downgrades a resolved verdict,
 *     dedupes its input, skips identity-less items, single-write batching.
 *   - upsertVerdict: keys on the stable identity so a human verdict reconciles
 *     with an auto-seeded PENDING row instead of duplicating it.
 *
 * The ledger resolves LOCAL_LEDGER_PATH at module load, so each test sets a fresh
 * temp path and dynamically re-imports after vi.resetModules(). GITHUB_PAT is
 * cleared so persistence stays on the local-file path (never the GitHub API).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Ledger = typeof import('./outcomeLedger');

let ledgerPath: string;

async function loadLedger(): Promise<Ledger> {
  vi.resetModules();
  return import('./outcomeLedger');
}

beforeEach(() => {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ledgerPath = path.join(os.tmpdir(), `outcomes-test-${tag}.json`);
  process.env.OUTCOMES_FILE_PATH = ledgerPath;
  delete process.env.GITHUB_PAT; // force local-file persistence, never GitHub
});

afterEach(() => {
  try {
    if (ledgerPath && fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
  } catch {
    /* ignore */
  }
  delete process.env.OUTCOMES_FILE_PATH;
  vi.restoreAllMocks();
});

function read(): any[] {
  return JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
}

const seedItem = (over: Partial<import('./outcomeLedger').SeedInput> = {}) => ({
  vertical: 'Semiconductor' as any,
  marketKeyword: 'global ai semiconductor manufacturing market',
  reportTitle: 'Global AI Semiconductor Manufacturing Market',
  opportunityScoreAtSurface: 78,
  trendBaseline: 40,
  trendDirectionPredicted: 'RISING' as any,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('stableOpportunityKey', () => {
  it('slugs vertical and marketKeyword into a deterministic semantic key', async () => {
    const { stableOpportunityKey } = await loadLedger();
    expect(stableOpportunityKey('Semiconductor', 'global ai semiconductor manufacturing market'))
      .toBe('semiconductor::global-ai-semiconductor-manufacturing-market');
  });

  it('is case-insensitive and collapses punctuation/whitespace', async () => {
    const { stableOpportunityKey } = await loadLedger();
    const a = stableOpportunityKey('Health-Care', '  AI/ML  Diagnostics!! ');
    const b = stableOpportunityKey('health care', 'ai ml diagnostics');
    expect(a).toBe(b);
    expect(a).toBe('health-care::ai-ml-diagnostics');
  });

  it('yields "::" only when both inputs slug to empty', async () => {
    const { stableOpportunityKey } = await loadLedger();
    expect(stableOpportunityKey('', '')).toBe('::');
    expect(stableOpportunityKey('!!!', '   ')).toBe('::');
  });
});

describe('seedPendingOutcomes', () => {
  it('seeds a PENDING record for a new opportunity with snapshot fields', async () => {
    const { seedPendingOutcomes } = await loadLedger();

    const { seeded } = await seedPendingOutcomes([seedItem()]);

    expect(seeded).toBe(1);
    const records = read();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      opportunityId: 'semiconductor::global-ai-semiconductor-manufacturing-market',
      verdict: 'PENDING',
      opportunityScoreAtSurface: 78,
      trendBaseline: 40,
      trendDirectionPredicted: 'RISING',
    });
    expect(typeof records[0].surfacedAt).toBe('string');
    expect(records[0].trendChecks).toEqual([]);
  });

  it('is idempotent — re-seeding the same opportunity adds nothing', async () => {
    const { seedPendingOutcomes } = await loadLedger();

    await seedPendingOutcomes([seedItem()]);
    const { seeded } = await seedPendingOutcomes([seedItem()]);

    expect(seeded).toBe(0);
    expect(read()).toHaveLength(1);
  });

  it('never downgrades a resolved verdict back to PENDING', async () => {
    const { upsertVerdict, seedPendingOutcomes } = await loadLedger();

    await upsertVerdict({
      opportunityId: 'ignored-volatile-id',
      verdict: 'SOLD',
      vertical: 'Semiconductor' as any,
      marketKeyword: 'global ai semiconductor manufacturing market',
      reportTitle: 'Global AI Semiconductor Manufacturing Market',
    });
    const surfacedBefore = read()[0].surfacedAt;

    const { seeded } = await seedPendingOutcomes([seedItem()]);

    expect(seeded).toBe(0);
    const records = read();
    expect(records).toHaveLength(1);
    expect(records[0].verdict).toBe('SOLD');           // unchanged
    expect(records[0].surfacedAt).toBe(surfacedBefore); // not reset
  });

  it('dedupes duplicate keys within a single call', async () => {
    const { seedPendingOutcomes } = await loadLedger();

    const { seeded } = await seedPendingOutcomes([
      seedItem(),
      seedItem({ reportTitle: 'Different title, same key' }),
    ]);

    expect(seeded).toBe(1);
    expect(read()).toHaveLength(1);
  });

  it('skips items lacking semantic identity and returns 0 for an empty batch', async () => {
    const { seedPendingOutcomes } = await loadLedger();

    expect(await seedPendingOutcomes([])).toEqual({ seeded: 0 });
    const { seeded } = await seedPendingOutcomes([
      seedItem({ vertical: '' as any }),
      seedItem({ marketKeyword: '' }),
    ]);
    expect(seeded).toBe(0);
    expect(fs.existsSync(ledgerPath)).toBe(false); // no write attempted
  });
});

describe('upsertVerdict — stable identity reconciliation', () => {
  it('reconciles a human verdict with an auto-seeded PENDING row (no duplicate)', async () => {
    const { seedPendingOutcomes, upsertVerdict } = await loadLedger();

    await seedPendingOutcomes([seedItem()]);
    const seededSurfacedAt = read()[0].surfacedAt;

    const records = await upsertVerdict({
      opportunityId: 'sig-1782200932916-0', // volatile id is intentionally ignored
      verdict: 'SOLD',
      vertical: 'Semiconductor' as any,
      marketKeyword: 'global ai semiconductor manufacturing market',
      reportTitle: 'Global AI Semiconductor Manufacturing Market',
    });

    expect(records).toHaveLength(1);
    expect(records[0].opportunityId).toBe('semiconductor::global-ai-semiconductor-manufacturing-market');
    expect(records[0].verdict).toBe('SOLD');
    expect(records[0].surfacedAt).toBe(seededSurfacedAt); // preserved from the seed
    expect(records[0].trendBaseline).toBe(40);            // preserved from the seed
  });

  it('treats two different volatile ids with the same vertical+keyword as one record', async () => {
    const { upsertVerdict } = await loadLedger();

    await upsertVerdict({
      opportunityId: 'sig-1-0',
      verdict: 'COMMISSIONED',
      vertical: 'Fintech' as any,
      marketKeyword: 'embedded finance',
      reportTitle: 'Embedded Finance Market',
    });
    const records = await upsertVerdict({
      opportunityId: 'sig-2-3',
      verdict: 'SOLD',
      vertical: 'Fintech' as any,
      marketKeyword: 'embedded finance',
      reportTitle: 'Embedded Finance Market',
    });

    expect(records).toHaveLength(1);
    expect(records[0].verdict).toBe('SOLD');
  });
});
