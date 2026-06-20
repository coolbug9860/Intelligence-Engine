/**
 * epoService.test.ts (Task 5.3 — built alongside 5.2)
 *
 * Feature: zero-cost-ingestion-layer — EU EPO patent connector.
 * Validates: Requirements 13.1, 13.2, 13.3, 9.x, 11.4
 *
 * Mocked-HTTP suite: OAuth2 token acquisition, OPS biblio → IngestionRecord mapping,
 * 24h /tmp cache round-trip, lookback CQL, and non-fatal failure paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchEpoPatents, buildPublicationDateQuery } from './epoService';

const AUTH_URL = 'https://ops.epo.org/3.2/auth/accesstoken';

let cachePath: string;

function singleDocResponse() {
  return {
    'ops:world-patent-data': {
      'exchange-documents': {
        'exchange-document': {
          '@country': 'EP',
          '@doc-number': '1234567',
          '@kind': 'A1',
          'bibliographic-data': {
            'invention-title': [
              { '@lang': 'de', $: 'Verfahren zur Festkoerperbatterie' },
              { '@lang': 'en', $: 'Method for solid-state battery electrolyte deposition' },
            ],
            'publication-reference': {
              'document-id': [
                {
                  '@document-id-type': 'docdb',
                  country: { $: 'EP' },
                  'doc-number': { $: '1234567' },
                  kind: { $: 'A1' },
                  date: { $: '20260618' },
                },
              ],
            },
          },
          abstract: { '@lang': 'en', p: { $: 'A novel deposition technique for solid-state cells.' } },
        },
      },
    },
  };
}

function twoDocResponse() {
  const r = singleDocResponse();
  const first = r['ops:world-patent-data']['exchange-documents']['exchange-document'];
  const second = JSON.parse(JSON.stringify(first));
  second['@doc-number'] = '7654321';
  second['@kind'] = 'B1';
  (r['ops:world-patent-data']['exchange-documents'] as any)['exchange-document'] = [first, second];
  return r;
}

/** Routes auth vs. search by URL. */
function routedFetch(opts: {
  authOk?: boolean;
  searchOk?: boolean;
  searchBody?: unknown;
  searchReject?: boolean;
}) {
  const { authOk = true, searchOk = true, searchBody = singleDocResponse(), searchReject = false } = opts;
  return vi.fn((url: string) => {
    if (url.startsWith(AUTH_URL)) {
      return Promise.resolve({
        ok: authOk,
        status: authOk ? 200 : 401,
        json: async () => ({ access_token: 'tok-123', expires_in: '1199' }),
      } as Response);
    }
    if (searchReject) return Promise.reject(new Error('ENOTFOUND ops.epo.org'));
    return Promise.resolve({
      ok: searchOk,
      status: searchOk ? 200 : 500,
      json: async () => searchBody,
    } as Response);
  });
}

beforeEach(() => {
  cachePath = path.join(os.tmpdir(), `epo-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.EPO_CACHE_PATH = cachePath;
  process.env.EPO_CONSUMER_KEY = 'test-key';
  process.env.EPO_CONSUMER_SECRET = 'test-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
  delete process.env.EPO_CACHE_PATH;
  delete process.env.EPO_CONSUMER_KEY;
  delete process.env.EPO_CONSUMER_SECRET;
});

describe('buildPublicationDateQuery — rolling 24h UTC lookback (Req 9.x)', () => {
  it('should build a pd-within clause spanning the prior 24h in UTC', () => {
    const now = new Date('2026-06-19T08:00:00.000Z');
    expect(buildPublicationDateQuery(now)).toBe('pd within "20260618 20260619"');
  });
});

describe('fetchEpoPatents — mapping (Req 13.3)', () => {
  it('should transform an OPS biblio document into a unified IngestionRecord', async () => {
    vi.stubGlobal('fetch', routedFetch({}));

    const [record] = await fetchEpoPatents();

    expect(record).toEqual({
      source_system: 'EU_EPO',
      content_type: 'epo_patent',
      jurisdiction: 'EP',
      headline: 'Method for solid-state battery electrolyte deposition',
      abstract: 'A novel deposition technique for solid-state cells.',
      source_url: 'https://worldwide.espacenet.com/publicationDetails/biblio?CC=EP&NR=1234567&KC=A1',
      full_text_url: 'https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/EP.1234567.A1/description',
      tracking_timestamp: '2026-06-18T00:00:00.000Z',
      external_id: 'EP1234567A1',
      vertical_hint: null,
      language: 'en',
    });
  });

  it('should map an array of exchange-documents', async () => {
    vi.stubGlobal('fetch', routedFetch({ searchBody: twoDocResponse() }));

    const records = await fetchEpoPatents();

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.external_id)).toEqual(['EP1234567A1', 'EP7654321B1']);
  });

  it('should fall back to the title when no abstract is present', async () => {
    const body = singleDocResponse();
    delete (body['ops:world-patent-data']['exchange-documents']['exchange-document'] as any).abstract;
    vi.stubGlobal('fetch', routedFetch({ searchBody: body }));

    const [record] = await fetchEpoPatents();

    expect(record.abstract).toBe('Method for solid-state battery electrolyte deposition');
  });
});

describe('fetchEpoPatents — authentication (Req 13.1)', () => {
  it('should return [] and not call fetch when credentials are absent', async () => {
    delete process.env.EPO_CONSUMER_KEY;
    delete process.env.EPO_CONSUMER_SECRET;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const records = await fetchEpoPatents();

    expect(records).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return [] and not call search when auth fails', async () => {
    const fetchSpy = routedFetch({ authOk: false });
    vi.stubGlobal('fetch', fetchSpy);

    const records = await fetchEpoPatents();

    expect(records).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the auth attempt
  });
});

describe('fetchEpoPatents — resilience (Req 13.2)', () => {
  it('should return [] without throwing on a non-OK search response', async () => {
    vi.stubGlobal('fetch', routedFetch({ searchOk: false }));
    await expect(fetchEpoPatents()).resolves.toEqual([]);
  });

  it('should return [] without throwing on a network error', async () => {
    vi.stubGlobal('fetch', routedFetch({ searchReject: true }));
    await expect(fetchEpoPatents()).resolves.toEqual([]);
  });
});

describe('fetchEpoPatents — 24h cache round-trip (Req 11.4)', () => {
  it('should serve the second call from cache with no additional fetches', async () => {
    const fetchSpy = routedFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const first = await fetchEpoPatents();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // auth + search

    const second = await fetchEpoPatents();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // unchanged — served from cache
    expect(second).toEqual(first);
  });
});
