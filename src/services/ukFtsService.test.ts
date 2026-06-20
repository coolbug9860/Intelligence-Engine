/**
 * ukFtsService.test.ts (Task 4.1 — built alongside Task 4)
 *
 * Feature: zero-cost-ingestion-layer — UK FTS / Contracts Finder OCDS connector.
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 9.3, 11.4
 *
 * Mocked-HTTP suite: OCDS release/record package flattening, per-endpoint source_system,
 * merge + single-endpoint-failure continuation, title/description mapping with fallback
 * + truncation, rolling 24h lookback, and /tmp cache round-trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchUkFtsNotices, buildUkDateRange } from './ukFtsService';

let cachePath: string;

function release(overrides: Record<string, unknown> = {}) {
  return {
    ocid: 'ocds-b5fd17-0001',
    id: 'rel-1',
    date: '2026-06-18T09:30:00Z',
    tender: {
      title: 'Cloud migration and cybersecurity services framework',
      description: 'A framework agreement for cloud migration and managed cybersecurity.',
      documents: [{ url: 'https://www.find-tender.service.gov.uk/doc/abc.pdf' }],
    },
    ...overrides,
  };
}

/** ReleasePackage (FTS shape). */
function releasePackage(releases: unknown[]) {
  return { releases };
}

/** RecordPackage (records[].compiledRelease). */
function recordPackage(releases: any[]) {
  return { records: releases.map((r) => ({ compiledRelease: r })) };
}

/** Contracts Finder search wrapper (results[].releasePackage). */
function cfSearchWrapper(releases: unknown[]) {
  return { results: [{ releasePackage: { releases } }] };
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}
function notOk(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as Response;
}

/** Route by hostname: find-tender vs contractsfinder. */
function routedFetch(opts: { fts?: () => Promise<Response>; cf?: () => Promise<Response> }) {
  return vi.fn((url: string) => {
    if (url.includes('find-tender')) return (opts.fts ?? (() => Promise.resolve(ok(releasePackage([])))))();
    return (opts.cf ?? (() => Promise.resolve(ok(releasePackage([])))))();
  });
}

beforeEach(() => {
  cachePath = path.join(os.tmpdir(), `ukfts-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.UKFTS_CACHE_PATH = cachePath;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
  delete process.env.UKFTS_CACHE_PATH;
});

describe('buildUkDateRange — rolling 24h UTC lookback (Req 9.3)', () => {
  it('should span exactly the prior 24h as ISO timestamps', () => {
    const now = new Date('2026-06-19T08:00:00.000Z');
    expect(buildUkDateRange(now)).toEqual({
      updatedFrom: '2026-06-18T08:00:00.000Z',
      updatedTo: '2026-06-19T08:00:00.000Z',
    });
  });
});

describe('fetchUkFtsNotices — OCDS mapping (Req 3.2, 3.4)', () => {
  it('should map a Find a Tender ReleasePackage with source_system UK_FTS', async () => {
    vi.stubGlobal('fetch', routedFetch({ fts: () => Promise.resolve(ok(releasePackage([release()]))) }));

    const records = await fetchUkFtsNotices();

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      source_system: 'UK_FTS',
      content_type: 'procurement_notice',
      jurisdiction: 'GB',
      headline: 'Cloud migration and cybersecurity services framework',
      abstract: 'A framework agreement for cloud migration and managed cybersecurity.',
      source_url: 'https://www.find-tender.service.gov.uk/doc/abc.pdf',
      full_text_url: 'https://www.find-tender.service.gov.uk/doc/abc.pdf',
      tracking_timestamp: '2026-06-18T09:30:00.000Z',
      external_id: 'ocds-b5fd17-0001',
      vertical_hint: null,
      language: 'en',
    });
  });

  it('should parse a RecordPackage (records[].compiledRelease)', async () => {
    vi.stubGlobal('fetch', routedFetch({ fts: () => Promise.resolve(ok(recordPackage([release({ ocid: 'rec-1' })]))) }));

    const records = await fetchUkFtsNotices();

    expect(records.map((r) => r.external_id)).toContain('rec-1');
  });

  it('should parse a Contracts Finder results wrapper with source_system UK_CONTRACTS_FINDER', async () => {
    vi.stubGlobal('fetch', routedFetch({
      cf: () => Promise.resolve(ok(cfSearchWrapper([release({ ocid: 'cf-1' })]))),
    }));

    const records = await fetchUkFtsNotices();

    const cf = records.find((r) => r.external_id === 'cf-1');
    expect(cf?.source_system).toBe('UK_CONTRACTS_FINDER');
  });

  it('should merge records from both endpoints', async () => {
    vi.stubGlobal('fetch', routedFetch({
      fts: () => Promise.resolve(ok(releasePackage([release({ ocid: 'fts-1' })]))),
      cf: () => Promise.resolve(ok(releasePackage([release({ ocid: 'cf-1' })]))),
    }));

    const records = await fetchUkFtsNotices();

    expect(records.map((r) => r.external_id).sort()).toEqual(['cf-1', 'fts-1']);
  });

  it('should fall back to the title when description is missing and truncate to 700', async () => {
    const longTitle = 'X'.repeat(900);
    const rel = release({ tender: { title: longTitle } });
    vi.stubGlobal('fetch', routedFetch({ fts: () => Promise.resolve(ok(releasePackage([rel]))) }));

    const [record] = await fetchUkFtsNotices();

    expect(record.abstract).toHaveLength(700);
  });

  it('should skip releases missing ocid or title', async () => {
    const bad = release({ ocid: undefined, id: undefined });
    const good = release({ ocid: 'good-1' });
    vi.stubGlobal('fetch', routedFetch({ fts: () => Promise.resolve(ok(releasePackage([bad, good]))) }));

    const records = await fetchUkFtsNotices();

    expect(records.map((r) => r.external_id)).toEqual(['good-1']);
  });
});

describe('fetchUkFtsNotices — resilience (Req 3.5, 3.7)', () => {
  it('should continue with the other endpoint when one fails', async () => {
    vi.stubGlobal('fetch', routedFetch({
      fts: () => Promise.resolve(ok(releasePackage([release({ ocid: 'fts-only' })]))),
      cf: () => Promise.reject(new Error('ECONNREFUSED')),
    }));

    const records = await fetchUkFtsNotices();

    expect(records.map((r) => r.external_id)).toEqual(['fts-only']);
  });

  it('should return [] without throwing when both endpoints fail', async () => {
    vi.stubGlobal('fetch', routedFetch({
      fts: () => Promise.resolve(notOk(503)),
      cf: () => Promise.reject(new Error('timeout')),
    }));

    await expect(fetchUkFtsNotices()).resolves.toEqual([]);
  });

  it('should NOT write a cache when both endpoints fail (allows retry)', async () => {
    vi.stubGlobal('fetch', routedFetch({
      fts: () => Promise.resolve(notOk(500)),
      cf: () => Promise.resolve(notOk(500)),
    }));

    await fetchUkFtsNotices();

    expect(fs.existsSync(cachePath)).toBe(false);
  });
});

describe('fetchUkFtsNotices — 24h cache round-trip (Req 3.8, 11.4)', () => {
  it('should serve the second call from cache with no additional fetches', async () => {
    const fetchSpy = routedFetch({ fts: () => Promise.resolve(ok(releasePackage([release()]))) });
    vi.stubGlobal('fetch', fetchSpy);

    const first = await fetchUkFtsNotices();
    const callsAfterFirst = fetchSpy.mock.calls.length; // 2 endpoints
    expect(callsAfterFirst).toBe(2);

    const second = await fetchUkFtsNotices();
    expect(fetchSpy.mock.calls.length).toBe(2); // unchanged — served from cache
    expect(second).toEqual(first);
  });
});
