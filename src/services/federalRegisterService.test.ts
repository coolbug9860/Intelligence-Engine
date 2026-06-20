/**
 * federalRegisterService.test.ts (Task 5.1 — built alongside Task 5)
 *
 * Feature: zero-cost-ingestion-layer — Federal Register connector + SAM watchlist source.
 * Validates: Requirements 8.1, 8.3, 8.4, 8.6, 9.1, 11.4
 *
 * Mocked-HTTP suite plus dedicated coverage of the solicitation/award ID extraction
 * (the sole SAM.gov lookup trigger).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fetchFederalRegisterNotices,
  extractSolicitationIds,
  buildFrDateRange,
} from './federalRegisterService';

let cachePath: string;

function frDocument(overrides: Record<string, unknown> = {}) {
  return {
    document_number: '2026-13245',
    title: 'Notice of Procurement for Advanced Semiconductor Inspection Systems',
    abstract: 'The agency announces a solicitation under reference W911NF-24-R-0001 for inspection systems.',
    html_url: 'https://www.federalregister.gov/documents/2026/06/18/2026-13245/notice',
    raw_text_url: 'https://www.federalregister.gov/documents/full_text/text/2026/06/18/2026-13245.txt',
    publication_date: '2026-06-18',
    type: 'Notice',
    ...overrides,
  };
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  cachePath = path.join(os.tmpdir(), `fr-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.FR_CACHE_PATH = cachePath;
  process.env.DATA_GOV_API_KEY = 'test-data-gov-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
  delete process.env.FR_CACHE_PATH;
  delete process.env.DATA_GOV_API_KEY;
});

describe('extractSolicitationIds — SAM lookup trigger (Req 8.4)', () => {
  it('should extract a dashed agency solicitation number from full text', () => {
    const text = 'Responses to solicitation W911NF-24-R-0001 are due by July.';
    expect(extractSolicitationIds(text)).toEqual(['W911NF-24-R-0001']);
  });

  it('should extract multiple distinct IDs and de-duplicate repeats', () => {
    const text =
      'See W911NF-24-R-0001 and award FA8750-23-R-1000. Reminder: W911NF-24-R-0001 closes soon.';
    expect(extractSolicitationIds(text)).toEqual(['W911NF-24-R-0001', 'FA8750-23-R-1000']);
  });

  it('should extract the compact HHS/NIH format', () => {
    const text = 'Contract 75N98024R00001 was referenced in the rule.';
    expect(extractSolicitationIds(text)).toEqual(['75N98024R00001']);
  });

  it('should return an empty array when no solicitation IDs are present', () => {
    expect(extractSolicitationIds('A general rule about widget labeling.')).toEqual([]);
  });

  it('should be resilient to empty / non-string input', () => {
    expect(extractSolicitationIds('')).toEqual([]);
    expect(extractSolicitationIds(undefined as unknown as string)).toEqual([]);
  });
});

describe('buildFrDateRange — rolling lookback in UTC (Req 9.1)', () => {
  it('should span the default 4-day window as YYYY-MM-DD in UTC', () => {
    const now = new Date('2026-06-19T08:00:00.000Z');
    expect(buildFrDateRange(now)).toEqual({ gte: '2026-06-15', lte: '2026-06-19' });
  });
});

describe('fetchFederalRegisterNotices — mapping (Req 8.1)', () => {
  it('should map an FR document into a unified IngestionRecord', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({ results: [frDocument()] }))));

    const [record] = await fetchFederalRegisterNotices();

    expect(record).toEqual({
      source_system: 'US_FEDERAL_REGISTER',
      content_type: 'regulatory_filing',
      jurisdiction: 'US',
      headline: 'Notice of Procurement for Advanced Semiconductor Inspection Systems',
      abstract: 'The agency announces a solicitation under reference W911NF-24-R-0001 for inspection systems.',
      source_url: 'https://www.federalregister.gov/documents/2026/06/18/2026-13245/notice',
      full_text_url: 'https://www.federalregister.gov/documents/full_text/text/2026/06/18/2026-13245.txt',
      tracking_timestamp: '2026-06-18T00:00:00.000Z',
      external_id: '2026-13245',
      vertical_hint: null,
      language: 'en',
    });
  });

  it('should fall back to html_url for full_text_url when raw_text_url is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({ results: [frDocument({ raw_text_url: undefined })] }))));

    const [record] = await fetchFederalRegisterNotices();

    expect(record.full_text_url).toBe('https://www.federalregister.gov/documents/2026/06/18/2026-13245/notice');
  });

  it('should skip documents missing a document_number or title', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
      results: [frDocument({ document_number: undefined }), frDocument({ document_number: '2026-99999' })],
    }))));

    const records = await fetchFederalRegisterNotices();

    expect(records.map((r) => r.external_id)).toEqual(['2026-99999']);
  });
});

describe('fetchFederalRegisterNotices — credentials & resilience (Req 8.3, 8.6)', () => {
  it('should return [] and not fetch when DATA_GOV_API_KEY is absent', async () => {
    delete process.env.DATA_GOV_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const records = await fetchFederalRegisterNotices();

    expect(records).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return [] without throwing on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response)));
    await expect(fetchFederalRegisterNotices()).resolves.toEqual([]);
  });

  it('should return [] without throwing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ENOTFOUND'))));
    await expect(fetchFederalRegisterNotices()).resolves.toEqual([]);
  });
});

describe('fetchFederalRegisterNotices — 24h cache round-trip (Req 11.4)', () => {
  it('should serve the second call from cache with no additional fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(ok({ results: [frDocument()] })));
    vi.stubGlobal('fetch', fetchSpy);

    const first = await fetchFederalRegisterNotices();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await fetchFederalRegisterNotices();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // served from cache
    expect(second).toEqual(first);
  });
});
