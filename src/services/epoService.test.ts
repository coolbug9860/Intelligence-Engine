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
import fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchEpoPatents, buildPublicationDateQuery } from './epoService';

const AUTH_URL = 'https://ops.epo.org/3.2/auth/accesstoken';

let cachePath: string;
let cooldownPath: string;
let weeklyPath: string;
let tokenPath: string;

/** Remove every EPO state file so a call starts from a clean slate. */
function freshState() {
  for (const p of [cachePath, cooldownPath, weeklyPath, tokenPath]) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

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
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  cachePath = path.join(os.tmpdir(), `epo-test-${tag}.json`);
  cooldownPath = path.join(os.tmpdir(), `epo-cooldown-${tag}.json`);
  weeklyPath = path.join(os.tmpdir(), `epo-weekly-${tag}.json`);
  tokenPath = path.join(os.tmpdir(), `epo-token-${tag}.json`);
  process.env.EPO_CACHE_PATH = cachePath;
  process.env.EPO_COOLDOWN_PATH = cooldownPath;
  process.env.EPO_WEEKLY_QUOTA_PATH = weeklyPath;
  process.env.EPO_TOKEN_PATH = tokenPath;
  process.env.EPO_WEEKLY_LIMIT = '100000'; // high by default; specific tests override
  process.env.EPO_CONSUMER_KEY = 'test-key';
  process.env.EPO_CONSUMER_SECRET = 'test-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  freshState();
  delete process.env.EPO_CACHE_PATH;
  delete process.env.EPO_COOLDOWN_PATH;
  delete process.env.EPO_WEEKLY_QUOTA_PATH;
  delete process.env.EPO_TOKEN_PATH;
  delete process.env.EPO_WEEKLY_LIMIT;
  delete process.env.EPO_CONSUMER_KEY;
  delete process.env.EPO_CONSUMER_SECRET;
});

describe('buildPublicationDateQuery — rolling lookback in UTC (Req 9.x)', () => {
  it('should build a pd-within clause spanning the default 7-day window in UTC', () => {
    const now = new Date('2026-06-19T08:00:00.000Z');
    expect(buildPublicationDateQuery(now)).toBe('pd within "20260612 20260619"');
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

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS FOR GUARDRAIL TESTS
// ─────────────────────────────────────────────────────────────────────────────

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** A response with an explicit status and optional headers (e.g. Retry-After). */
function statusResp(status: number, headers?: Record<string, string>, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers ? { get: (k: string) => headers[k.toLowerCase()] ?? null } : undefined,
    json: async () => body,
  } as unknown as Response;
}

/**
 * Build a fetch mock routed by URL, counting auth vs. search calls. Handlers
 * return a Promise<Response> (or reject) so any status/throw can be simulated.
 */
function makeFetch(handlers: {
  auth?: () => Promise<Response>;
  search?: () => Promise<Response>;
} = {}) {
  const calls = { auth: 0, search: 0 };
  const spy = vi.fn((url: string) => {
    if (url.startsWith(AUTH_URL)) {
      calls.auth += 1;
      return handlers.auth
        ? handlers.auth()
        : Promise.resolve(okJson({ access_token: 'tok-123', expires_in: '1199' }));
    }
    calls.search += 1;
    return handlers.search ? handlers.search() : Promise.resolve(okJson(singleDocResponse()));
  });
  return { spy, calls };
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ─────────────────────────────────────────────────────────────────────────────
// THROTTLE-TRIGGERED COOLDOWN (negative cache) — Req 13.2 hardening
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchEpoPatents — throttle cooldown on 429/403 (negative cache)', () => {
  it('writes a cooldown honoring Retry-After on a 429 search and returns []', async () => {
    const { spy } = makeFetch({ search: () => Promise.resolve(statusResp(429, { 'retry-after': '120' })) });
    vi.stubGlobal('fetch', spy);

    const before = Date.now();
    await expect(fetchEpoPatents()).resolves.toEqual([]);

    expect(fs.existsSync(cooldownPath)).toBe(true);
    const until = new Date(readJson(cooldownPath).until).getTime();
    // ~120s ahead (allow scheduling slack).
    expect(until - before).toBeGreaterThanOrEqual(110_000);
    expect(until - before).toBeLessThanOrEqual(130_000);
  });

  it('suppresses the NEXT call entirely while the cooldown is active (no retry storm)', async () => {
    const first = makeFetch({ search: () => Promise.resolve(statusResp(429, { 'retry-after': '300' })) });
    vi.stubGlobal('fetch', first.spy);
    await fetchEpoPatents();
    expect(first.calls.auth).toBe(1);
    expect(first.calls.search).toBe(1);

    // Second call: cooldown is active → short-circuit, ZERO upstream requests.
    const second = makeFetch({});
    vi.stubGlobal('fetch', second.spy);
    await expect(fetchEpoPatents()).resolves.toEqual([]);
    expect(second.calls.auth).toBe(0);
    expect(second.calls.search).toBe(0);
  });

  it('treats a 403 search as throttling and writes a cooldown', async () => {
    const { spy } = makeFetch({ search: () => Promise.resolve(statusResp(403)) });
    vi.stubGlobal('fetch', spy);
    await expect(fetchEpoPatents()).resolves.toEqual([]);
    expect(fs.existsSync(cooldownPath)).toBe(true);
  });

  it('defaults the cooldown to ~1 hour when Retry-After is absent', async () => {
    const { spy } = makeFetch({ search: () => Promise.resolve(statusResp(429)) });
    vi.stubGlobal('fetch', spy);

    const before = Date.now();
    await fetchEpoPatents();

    const until = new Date(readJson(cooldownPath).until).getTime();
    expect(until - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5_000);
    expect(until - before).toBeLessThanOrEqual(60 * 60 * 1000 + 5_000);
  });

  it('treats a 429 during AUTH as throttling, cools down, and skips the search', async () => {
    const { spy, calls } = makeFetch({ auth: () => Promise.resolve(statusResp(429, { 'retry-after': '60' })) });
    vi.stubGlobal('fetch', spy);

    await expect(fetchEpoPatents()).resolves.toEqual([]);
    expect(calls.auth).toBe(1);
    expect(calls.search).toBe(0); // never reached
    expect(fs.existsSync(cooldownPath)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT WEEKLY REQUEST BUDGET (hard-stop) — Req 13.x / Task 5.2
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchEpoPatents — weekly request budget hard-stop', () => {
  it('issues NO upstream request when the weekly budget is already exhausted', async () => {
    process.env.EPO_WEEKLY_LIMIT = '5';
    fs.writeFileSync(weeklyPath, JSON.stringify({ weekStart: new Date().toISOString(), count: 5 }));
    const { spy, calls } = makeFetch({});
    vi.stubGlobal('fetch', spy);

    await expect(fetchEpoPatents()).resolves.toEqual([]);
    expect(calls.auth).toBe(0);
    expect(calls.search).toBe(0);
  });

  it('blocks the search once auth consumes the last slot in the budget', async () => {
    process.env.EPO_WEEKLY_LIMIT = '1';
    const { spy, calls } = makeFetch({});
    vi.stubGlobal('fetch', spy);

    await expect(fetchEpoPatents()).resolves.toEqual([]);
    expect(calls.auth).toBe(1); // auth used the single slot
    expect(calls.search).toBe(0); // search hard-stopped
  });

  it('counts each upstream request against the persistent weekly counter', async () => {
    process.env.EPO_WEEKLY_LIMIT = '100';
    const { spy } = makeFetch({});
    vi.stubGlobal('fetch', spy);

    await fetchEpoPatents(); // auth + search = 2 requests
    expect(readJson(weeklyPath).count).toBe(2);
  });

  it('resets the counter when the weekly window has elapsed', async () => {
    process.env.EPO_WEEKLY_LIMIT = '3';
    // Stale window (8 days ago) at a huge count → must reset and allow the call.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(weeklyPath, JSON.stringify({ weekStart: eightDaysAgo, count: 999999 }));
    const { spy, calls } = makeFetch({});
    vi.stubGlobal('fetch', spy);

    const records = await fetchEpoPatents();
    expect(records).toHaveLength(1);
    expect(calls.auth + calls.search).toBe(2);
    expect(readJson(weeklyPath).count).toBe(2); // fresh window, two requests
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH TOKEN CACHING — Req 13.1 hardening
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchEpoPatents — OAuth token caching', () => {
  it('reuses the bearer token across cache-missing calls (auth once, search twice)', async () => {
    // Search 500 → no success-cache written, so the second call still searches,
    // but it must reuse the cached token rather than re-authenticating.
    const { spy, calls } = makeFetch({ search: () => Promise.resolve(statusResp(500)) });
    vi.stubGlobal('fetch', spy);

    await fetchEpoPatents();
    await fetchEpoPatents();

    expect(calls.auth).toBe(1); // token reused on the second call
    expect(calls.search).toBe(2);
    expect(fs.existsSync(tokenPath)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSE EDGE CASES — skip records lacking critical identifiers/titles
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchEpoPatents — parse edge cases (skip malformed documents)', () => {
  function bodyWithDocs(docs: unknown[]) {
    return { 'ops:world-patent-data': { 'exchange-documents': { 'exchange-document': docs } } };
  }

  it('skips a document missing @country', async () => {
    const doc = { '@doc-number': '111', '@kind': 'A1', 'bibliographic-data': { 'invention-title': [{ '@lang': 'en', $: 'T' }] } };
    vi.stubGlobal('fetch', makeFetch({ search: () => Promise.resolve(okJson(bodyWithDocs([doc]))) }).spy);
    await expect(fetchEpoPatents()).resolves.toEqual([]);
  });

  it('skips a document missing @doc-number', async () => {
    const doc = { '@country': 'EP', '@kind': 'A1', 'bibliographic-data': { 'invention-title': [{ '@lang': 'en', $: 'T' }] } };
    vi.stubGlobal('fetch', makeFetch({ search: () => Promise.resolve(okJson(bodyWithDocs([doc]))) }).spy);
    await expect(fetchEpoPatents()).resolves.toEqual([]);
  });

  it('skips a document with no usable title', async () => {
    const doc = { '@country': 'EP', '@doc-number': '111', '@kind': 'A1', 'bibliographic-data': {} };
    vi.stubGlobal('fetch', makeFetch({ search: () => Promise.resolve(okJson(bodyWithDocs([doc]))) }).spy);
    await expect(fetchEpoPatents()).resolves.toEqual([]);
  });

  it('keeps only the valid documents in a mixed batch', async () => {
    const valid = singleDocResponse()['ops:world-patent-data']['exchange-documents']['exchange-document'];
    const invalid = { '@doc-number': '999', 'bibliographic-data': {} }; // no country/title
    vi.stubGlobal('fetch', makeFetch({ search: () => Promise.resolve(okJson(bodyWithDocs([invalid, valid]))) }).spy);

    const records = await fetchEpoPatents();
    expect(records).toHaveLength(1);
    expect(records[0].external_id).toBe('EP1234567A1');
  });

  it('ignores a non-string @country (no non-string field leaks into the record)', async () => {
    const doc = { '@country': 49, '@doc-number': '111', '@kind': 'A1', 'bibliographic-data': { 'invention-title': [{ '@lang': 'en', $: 'T' }] } };
    vi.stubGlobal('fetch', makeFetch({ search: () => Promise.resolve(okJson(bodyWithDocs([doc]))) }).spy);
    await expect(fetchEpoPatents()).resolves.toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY-BASED — fuzz garbage OPS payloads: never throw; valid IngestionRecord[]
// ─────────────────────────────────────────────────────────────────────────────

function assertValidIngestionRecord(r: any): void {
  expect(r.source_system).toBe('EU_EPO');
  expect(r.content_type).toBe('epo_patent');
  expect(typeof r.jurisdiction).toBe('string');
  expect(r.jurisdiction.length).toBeGreaterThan(0);
  expect(typeof r.headline).toBe('string');
  expect(r.headline.length).toBeGreaterThan(0);
  expect(typeof r.abstract).toBe('string');
  expect(r.abstract.length).toBeGreaterThan(0);
  expect(r.abstract.length).toBeLessThanOrEqual(700);
  expect(typeof r.source_url).toBe('string');
  expect(r.source_url.startsWith('https://worldwide.espacenet.com/')).toBe(true);
  expect(typeof r.full_text_url).toBe('string');
  expect(typeof r.tracking_timestamp).toBe('string');
  expect(r.tracking_timestamp.length).toBeGreaterThan(0);
  expect(typeof r.external_id).toBe('string');
  expect(r.external_id.length).toBeGreaterThan(0);
  expect(r.vertical_hint).toBeNull();
  expect(typeof r.language).toBe('string');
  expect(r.language.length).toBeGreaterThan(0);
}

const arbText = fc.oneof(fc.record({ $: fc.string() }), fc.string(), fc.constant(undefined), fc.integer());
const arbTitleEntry = fc.record(
  { '@lang': fc.oneof(fc.constantFrom('en', 'de', 'fr'), fc.integer()), $: fc.string() },
  { requiredKeys: [] }
);
const arbDoc = fc.record(
  {
    '@country': fc.oneof(fc.constantFrom('EP', 'US', 'WO'), fc.string({ maxLength: 3 }), fc.constant(undefined), fc.integer()),
    '@doc-number': fc.oneof(fc.string({ maxLength: 8 }), fc.constant(undefined), fc.integer()),
    '@kind': fc.oneof(fc.constantFrom('A1', 'B1'), fc.constant(undefined), fc.integer()),
    'bibliographic-data': fc.oneof(
      fc.record(
        {
          'invention-title': fc.oneof(arbTitleEntry, fc.array(arbTitleEntry, { maxLength: 3 }), arbText, fc.constant(undefined)),
          'publication-reference': fc.oneof(
            fc.record({
              'document-id': fc.oneof(
                fc.record({ date: fc.record({ $: fc.oneof(fc.constantFrom('20260618', '2026'), fc.string()) }) }),
                fc.array(fc.record({ date: fc.record({ $: fc.string() }) }), { maxLength: 2 }),
                fc.constant(undefined)
              ),
            }),
            fc.anything()
          ),
        },
        { requiredKeys: [] }
      ),
      fc.anything()
    ),
    abstract: fc.oneof(
      fc.record(
        {
          '@lang': fc.constantFrom('en', 'de'),
          p: fc.oneof(fc.record({ $: fc.string() }), fc.array(fc.record({ $: fc.string() }), { maxLength: 3 })),
        },
        { requiredKeys: [] }
      ),
      fc.anything(),
      fc.constant(undefined)
    ),
  },
  { requiredKeys: [] }
);

const arbSearchBody = fc.oneof(
  arbDoc.map((d) => ({ 'ops:world-patent-data': { 'exchange-documents': { 'exchange-document': d } } })),
  fc.array(arbDoc, { maxLength: 5 }).map((ds) => ({ 'ops:world-patent-data': { 'exchange-documents': { 'exchange-document': ds } } })),
  fc.anything(),
  fc.constant(null)
);

describe('Property: fetchEpoPatents never throws and yields a valid IngestionRecord[]', () => {
  it('holds for arbitrary/garbage OPS payloads across many runs', async () => {
    process.env.EPO_WEEKLY_LIMIT = String(Number.MAX_SAFE_INTEGER);

    await fc.assert(
      fc.asyncProperty(arbSearchBody, async (body) => {
        freshState(); // independent state each run (no cache/cooldown/quota bleed)
        const { spy } = makeFetch({ search: () => Promise.resolve(okJson(body)) });
        vi.stubGlobal('fetch', spy);

        const records = await fetchEpoPatents();
        expect(Array.isArray(records)).toBe(true);
        for (const r of records) assertValidIngestionRecord(r);
      }),
      { numRuns: 400 }
    );
  });

  it('returns [] (never throws) when the search body cannot be parsed as JSON', async () => {
    process.env.EPO_WEEKLY_LIMIT = String(Number.MAX_SAFE_INTEGER);
    await fc.assert(
      fc.asyncProperty(fc.string(), async () => {
        freshState();
        const spy = vi.fn((url: string) => {
          if (url.startsWith(AUTH_URL)) return Promise.resolve(okJson({ access_token: 'tok', expires_in: '1199' }));
          return Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response);
        });
        vi.stubGlobal('fetch', spy);
        await expect(fetchEpoPatents()).resolves.toEqual([]);
      }),
      { numRuns: 50 }
    );
  });
});
