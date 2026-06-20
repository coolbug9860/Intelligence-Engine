/**
 * samGovService.test.ts (Task 7)
 *
 * Feature: zero-cost-ingestion-layer — SAM.gov demotion to a surgical by-ID lookup.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.7
 *
 * Confirms the mass keyword sweep is gone, the by-ID lookup is rate-limited by a
 * persistent 10/day quota gate, and every failure mode degrades to a non-fatal null.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchSamNoticeById, fetchSamGovSignals } from './samGovService';

let quotaPath: string;

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Advanced Radar Systems',
    type: 'Solicitation',
    fullParentPathName: 'DEPT OF DEFENSE',
    postedDate: '2026-06-18',
    description: 'Procurement of next-generation radar inspection systems.',
    uiLink: 'https://sam.gov/opp/abc123/view',
    ...overrides,
  };
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  quotaPath = path.join(os.tmpdir(), `sam-quota-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.SAMGOV_QUOTA_PATH = quotaPath;
  process.env.SAM_GOV_API_KEY = 'test-sam-key';
  delete process.env.SAMGOV_DAILY_LIMIT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    if (fs.existsSync(quotaPath)) fs.unlinkSync(quotaPath);
  } catch { /* ignore */ }
  delete process.env.SAMGOV_QUOTA_PATH;
  delete process.env.SAM_GOV_API_KEY;
});

function writeQuota(count: number) {
  fs.writeFileSync(quotaPath, JSON.stringify({ date: new Date().toISOString().slice(0, 10), count }), 'utf-8');
}

describe('fetchSamGovSignals — deprecated discovery stub (Req 5.1)', () => {
  it('should return [] and perform no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchSamGovSignals(['semiconductor', 'medical devices']);

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchSamNoticeById — guards (Req 5.3)', () => {
  it.each(['', '   ', null, undefined])('should return null and not fetch for invalid id %p', async (id) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchSamNoticeById(id as unknown as string);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return null and not fetch when SAM_GOV_API_KEY is absent', async () => {
    delete process.env.SAM_GOV_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchSamNoticeById('W911NF-24-R-0001');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchSamNoticeById — successful lookup (Req 5.2, 5.5)', () => {
  it('should issue exactly one request and return an unchanged-shape SamSignal', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(ok({ opportunitiesData: [opportunity()] })));
    vi.stubGlobal('fetch', fetchSpy);

    const signal = await fetchSamNoticeById('NID-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(signal).toEqual({
      title: 'Advanced Radar Systems — Solicitation',
      noticeType: 'Solicitation',
      agency: 'DEPT OF DEFENSE',
      postedDate: '2026-06-18',
      excerpt: 'Procurement of next-generation radar inspection systems.',
      url: 'https://sam.gov/opp/abc123/view',
      vertical: 'General',
      matchedKeyword: 'NID-1',
    });
  });

  it('should cap the excerpt at 700 characters', async () => {
    const long = opportunity({ description: 'y'.repeat(900) });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({ opportunitiesData: [long] }))));

    const signal = await fetchSamNoticeById('NID-2');

    expect(signal?.excerpt).toHaveLength(700);
  });
});

describe('fetchSamNoticeById — resilience (Req 5.4)', () => {
  it('should return null without throwing on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response)));
    await expect(fetchSamNoticeById('NID-3')).resolves.toBeNull();
  });

  it('should return null without throwing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNRESET'))));
    await expect(fetchSamNoticeById('NID-4')).resolves.toBeNull();
  });

  it('should abort and return null when the request exceeds the 10s timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_res, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))))
      )
    );

    const pending = fetchSamNoticeById('NID-5');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBeNull();
  });
});

describe('fetchSamNoticeById — daily quota gate (Req 5.7)', () => {
  it('should return null and NOT fetch once the daily quota is exhausted', async () => {
    writeQuota(10); // already at the 10/day limit
    const fetchSpy = vi.fn(() => Promise.resolve(ok({ opportunitiesData: [opportunity()] })));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchSamNoticeById('NID-OVER');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should increment the persistent quota on each request and block past the limit', async () => {
    process.env.SAMGOV_DAILY_LIMIT = '3';
    const fetchSpy = vi.fn(() => Promise.resolve(ok({ opportunitiesData: [opportunity()] })));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchSamNoticeById('A');
    await fetchSamNoticeById('B');
    await fetchSamNoticeById('C');
    const fourth = await fetchSamNoticeById('D'); // over the limit

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fourth).toBeNull();
    const persisted = JSON.parse(fs.readFileSync(quotaPath, 'utf-8'));
    expect(persisted.count).toBe(3);
  });

  it('should count a failed request against the daily budget (protective reservation)', async () => {
    process.env.SAMGOV_DAILY_LIMIT = '2';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));

    await fetchSamNoticeById('A'); // fails but is still counted
    const persisted = JSON.parse(fs.readFileSync(quotaPath, 'utf-8'));
    expect(persisted.count).toBe(1);
  });
});
