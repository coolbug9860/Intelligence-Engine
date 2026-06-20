/**
 * tedService.test.ts (Task 3.1 — built alongside Task 3)
 *
 * Feature: zero-cost-ingestion-layer — EU TED procurement connector.
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 9.2, 11.4
 *
 * Mocked-HTTP suite: nested/multilingual TED notice → IngestionRecord flattening,
 * rolling 24h lookback query, /tmp cache round-trip, and non-fatal failure paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchTedNotices, buildTedQuery } from './tedService';

let cachePath: string;

function notice(overrides: Record<string, unknown> = {}) {
  return {
    ND: '123456-2026',
    TI: [
      { language: 'DEU', value: 'Lieferung von Halbleiter-Testgeraeten' },
      { language: 'ENG', value: 'Supply of advanced semiconductor testing equipment' },
    ],
    DS: [{ language: 'ENG', value: 'Open procedure for the supply and maintenance of testing rigs.' }],
    PD: '20260618',
    CY: ['DE'],
    links: { html: { ENG: 'https://ted.europa.eu/en/notice/-/detail/123456-2026' } },
    ...overrides,
  };
}

function searchResponse(notices: unknown[]) {
  return { notices, totalNoticeCount: notices.length };
}

function okFetch(body: unknown) {
  return vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response));
}

beforeEach(() => {
  cachePath = path.join(os.tmpdir(), `ted-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.TED_CACHE_PATH = cachePath;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
  delete process.env.TED_CACHE_PATH;
});

describe('buildTedQuery — rolling 24h UTC lookback (Req 9.2)', () => {
  it('should build a PD range spanning the prior 24h in UTC', () => {
    const now = new Date('2026-06-19T08:00:00.000Z');
    expect(buildTedQuery(now)).toBe('PD>=20260618 AND PD<=20260619');
  });
});

describe('fetchTedNotices — nested/multilingual mapping (Req 2.2)', () => {
  it('should flatten a nested TED notice into a unified IngestionRecord, preferring English', async () => {
    vi.stubGlobal('fetch', okFetch(searchResponse([notice()])));

    const [record] = await fetchTedNotices();

    expect(record).toEqual({
      source_system: 'EU_TED',
      content_type: 'procurement_notice',
      jurisdiction: 'DE',
      headline: 'Supply of advanced semiconductor testing equipment',
      abstract: 'Open procedure for the supply and maintenance of testing rigs.',
      source_url: 'https://ted.europa.eu/en/notice/-/detail/123456-2026',
      full_text_url: 'https://ted.europa.eu/en/notice/-/detail/123456-2026',
      tracking_timestamp: '2026-06-18T00:00:00.000Z',
      external_id: '123456-2026',
      vertical_hint: null,
      language: 'en',
    });
  });

  it('should fall back to the title when no description is present', async () => {
    vi.stubGlobal('fetch', okFetch(searchResponse([notice({ DS: undefined })])));

    const [record] = await fetchTedNotices();

    expect(record.abstract).toBe('Supply of advanced semiconductor testing equipment');
  });

  it('should synthesize a detail URL when links carry no http value', async () => {
    vi.stubGlobal('fetch', okFetch(searchResponse([notice({ links: {} })])));

    const [record] = await fetchTedNotices();

    expect(record.source_url).toBe('https://ted.europa.eu/en/notice/-/detail/123456-2026');
  });

  it('should map multiple notices', async () => {
    const second = notice({ ND: '999999-2026' });
    vi.stubGlobal('fetch', okFetch(searchResponse([notice(), second])));

    const records = await fetchTedNotices();

    expect(records.map((r) => r.external_id)).toEqual(['123456-2026', '999999-2026']);
  });

  it('should skip notices missing an ID or title and keep the valid ones', async () => {
    const bad = notice({ ND: undefined });
    vi.stubGlobal('fetch', okFetch(searchResponse([bad, notice({ ND: '222222-2026' })])));

    const records = await fetchTedNotices();

    expect(records).toHaveLength(1);
    expect(records[0].external_id).toBe('222222-2026');
  });
});

describe('fetchTedNotices — resilience (Req 2.3)', () => {
  it('should return [] without throwing on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => ({}) } as Response)));
    await expect(fetchTedNotices()).resolves.toEqual([]);
  });

  it('should return [] without throwing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ETIMEDOUT'))));
    await expect(fetchTedNotices()).resolves.toEqual([]);
  });
});

describe('fetchTedNotices — 24h cache round-trip (Req 2.4, 2.5, 11.4)', () => {
  it('should serve the second call from cache with no additional fetch', async () => {
    const fetchSpy = okFetch(searchResponse([notice()]));
    vi.stubGlobal('fetch', fetchSpy);

    const first = await fetchTedNotices();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await fetchTedNotices();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // served from cache
    expect(second).toEqual(first);
  });
});
