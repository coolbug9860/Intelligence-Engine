/**
 * adzunaService.test.ts
 *
 * Feature: hiring-momentum ingestion stream (Adzuna).
 *
 * Mocked-HTTP suite: count→IngestionRecord synthesis, missing-credential skip,
 * empty-count skip, non-fatal failure paths, and the 24h cache round-trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchAdzunaHiringSignals } from './adzunaService';

let cachePath: string;

function okBody(count: number, results: any[] = []) {
  return { ok: true, status: 200, json: async () => ({ count, results }) } as Response;
}

/** A standard non-empty response reused across groups. */
function standardFetch() {
  return vi.fn(() =>
    Promise.resolve(
      okBody(1200, [
        { title: 'Process Engineer', company: { display_name: 'ABB' } },
        { title: 'Battery Scientist', company: { display_name: 'Tesla' } },
      ]),
    ),
  );
}

beforeEach(() => {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  cachePath = path.join(os.tmpdir(), `adzuna-test-${tag}.json`);
  process.env.ADZUNA_CACHE_PATH = cachePath;
  process.env.ADZUNA_APP_ID = 'test-id';
  process.env.ADZUNA_APP_KEY = 'test-key';
  delete process.env.ADZUNA_COUNTRY; // default 'us'
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    if (cachePath && fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch {
    /* ignore */
  }
  delete process.env.ADZUNA_CACHE_PATH;
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
});

describe('fetchAdzunaHiringSignals — synthesis', () => {
  it('synthesizes one hiring-momentum record per query group', async () => {
    vi.stubGlobal('fetch', standardFetch());

    const records = await fetchAdzunaHiringSignals();

    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.source_system).toBe('ADZUNA_JOBS');
      expect(r.content_type).toBe('hiring_signal');
      expect(r.jurisdiction).toBe('US');
      expect(r.full_text_url).toBeNull();
      expect(r.vertical_hint).toBeNull();
      expect(r.external_id.startsWith('adzuna-us-')).toBe(true);
      expect(r.headline).toContain('1,200');     // toLocaleString en-US
      expect(r.headline).toContain('active US');
      expect(r.abstract).toContain('ABB');        // top hirer folded in
    }
    // First group embeds its gate terms in the abstract.
    expect(records[0].abstract.toLowerCase()).toContain('semiconductor');
  });

  it('skips a group whose vacancy count is zero (no live hiring → no signal)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okBody(0, []))));
    await expect(fetchAdzunaHiringSignals()).resolves.toEqual([]);
  });
});

describe('fetchAdzunaHiringSignals — credentials & resilience', () => {
  it('returns [] and makes no request when credentials are absent', async () => {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const records = await fetchAdzunaHiringSignals();

    expect(records).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] without throwing on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 429, json: async () => ({}) } as Response)));
    await expect(fetchAdzunaHiringSignals()).resolves.toEqual([]);
  });

  it('returns [] without throwing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ENOTFOUND api.adzuna.com'))));
    await expect(fetchAdzunaHiringSignals()).resolves.toEqual([]);
  });
});

describe('fetchAdzunaHiringSignals — 24h cache round-trip', () => {
  it('serves the second call from cache with no additional fetches', async () => {
    const fetchSpy = standardFetch();
    vi.stubGlobal('fetch', fetchSpy);

    const first = await fetchAdzunaHiringSignals();
    expect(fetchSpy).toHaveBeenCalledTimes(3); // one per group

    const second = await fetchAdzunaHiringSignals();
    expect(fetchSpy).toHaveBeenCalledTimes(3); // unchanged — served from cache
    expect(second).toEqual(first);
  });
});
