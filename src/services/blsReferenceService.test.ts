/**
 * blsReferenceService.test.ts (Task 6)
 *
 * Feature: zero-cost-ingestion-layer — decoupled BLS reference layer.
 * Validates: Requirements 4.2, 4.3, 4.4, 10.1, 10.2, 10.3, 10.5, 11.4
 *
 * Mocked-HTTP suite: series→vertical mapping, YoY computation, lookup, cache round-trip,
 * and last-good-cache / empty-table fallback on failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getBlsReferenceTable, lookupSectorReference } from './blsReferenceService';

let cachePath: string;

function series(seriesID: string, latest: number, priorYear: number) {
  return {
    seriesID,
    data: [
      { year: '2026', period: 'M05', periodName: 'May', value: String(latest) },
      { year: '2025', period: 'M05', periodName: 'May', value: String(priorYear) },
    ],
  };
}

function blsOk(seriesResults: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'REQUEST_SUCCEEDED', Results: { series: seriesResults } }),
  } as Response;
}

beforeEach(() => {
  cachePath = path.join(os.tmpdir(), `bls-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.BLS_CACHE_PATH = cachePath;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
  delete process.env.BLS_CACHE_PATH;
  delete process.env.BLS_API_KEY;
});

describe('getBlsReferenceTable — series → vertical mapping (Req 10.1, 10.2, 10.3)', () => {
  it('should key the configured PPI series to their Kaiso sectors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(blsOk([
      series('PCU334413334413', 110, 100),
      series('PCU325412325412', 105, 100),
    ]))));

    const table = await getBlsReferenceTable();

    const semi = lookupSectorReference(table, 'Semiconductor');
    const pharma = lookupSectorReference(table, 'Healthcare');

    expect(semi?.ppiIndex).toBe(110);
    expect(semi?.ppiYoyPct).toBe(10); // (110-100)/100*100
    expect(pharma?.ppiIndex).toBe(105);
    expect(pharma?.ppiYoyPct).toBe(5);
  });

  it('should exclude series that are not in the configured map (Req 10.5)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(blsOk([
      series('PCU999999999999', 200, 100), // unmapped
      series('PCU334413334413', 110, 100),
    ]))));

    const table = await getBlsReferenceTable();

    expect(Object.keys(table)).toEqual(['Semiconductor']);
  });
});

describe('lookupSectorReference — absence (Req 4.4)', () => {
  it('should return undefined for a vertical not in the table', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(blsOk([series('PCU334413334413', 110, 100)]))));
    const table = await getBlsReferenceTable();
    expect(lookupSectorReference(table, 'Aerospace')).toBeUndefined();
  });
});

describe('getBlsReferenceTable — resilience (Req 4.3)', () => {
  it('should return an empty table when the request fails and no cache exists', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ETIMEDOUT'))));
    await expect(getBlsReferenceTable()).resolves.toEqual({});
  });

  it('should return an empty table on a non-success BLS status with no cache', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ status: 'REQUEST_NOT_PROCESSED', Results: {} }),
    } as Response)));
    await expect(getBlsReferenceTable()).resolves.toEqual({});
  });

  it('should fall back to the last good cache when a later refresh fails', async () => {
    // First call succeeds and writes cache.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(blsOk([series('PCU334413334413', 110, 100)]))));
    const good = await getBlsReferenceTable();

    // Force the cache to look stale so the next call attempts a refresh.
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    raw.fetchedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(cachePath, JSON.stringify(raw), 'utf-8');

    // Now the refresh fails — should return the last good table, not empty.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const fallback = await getBlsReferenceTable();

    expect(fallback).toEqual(good);
  });
});

describe('getBlsReferenceTable — 24h cache round-trip (Req 11.4)', () => {
  it('should serve the second call from cache with no additional fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(blsOk([series('PCU334413334413', 110, 100)])));
    vi.stubGlobal('fetch', fetchSpy);

    const first = await getBlsReferenceTable();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await getBlsReferenceTable();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});
