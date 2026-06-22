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
import fc from 'fast-check';
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

// ─────────────────────────────────────────────────────────────────────────────
// PARTIAL-PAYLOAD PARSER BRANCHES — previously robust-by-construction but untested
// ─────────────────────────────────────────────────────────────────────────────

/** Stub a single OK response wrapping `body`, returning the fetch spy. */
function stubOk(body: unknown) {
  const spy = vi.fn(() => Promise.resolve(ok(body)));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('fetchSamNoticeById — partial payload parser branches', () => {
  it('returns null when the payload has no title', async () => {
    stubOk({ opportunitiesData: [{ type: 'Solicitation', postedDate: '2026-06-18' }] });
    await expect(fetchSamNoticeById('NID-NOTITLE')).resolves.toBeNull();
  });

  it('returns null when the title is an empty string', async () => {
    stubOk({ opportunitiesData: [{ title: '', type: 'Solicitation', postedDate: '2026-06-18' }] });
    await expect(fetchSamNoticeById('NID-EMPTYTITLE')).resolves.toBeNull();
  });

  it('falls back to baseType when type is absent', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', baseType: 'Presolicitation', postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.noticeType).toBe('Presolicitation');
    expect(s?.title).toBe('X — Presolicitation');
  });

  it('defaults noticeType to "Notice" when both type and baseType are absent', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.noticeType).toBe('Notice');
  });

  it('uses organizationName when fullParentPathName is absent', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', organizationName: 'NASA', postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.agency).toBe('NASA');
  });

  it('uses department when only department is present', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', department: 'DOE', postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.agency).toBe('DOE');
  });

  it('defaults agency to "Unknown Agency" when no agency field is present', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.agency).toBe('Unknown Agency');
  });

  it('falls back to publishDate when postedDate is absent', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', publishDate: '2026-01-01', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.postedDate).toBe('2026-01-01');
  });

  it('falls back to publishDate when postedDate is an empty string (no `??` stickiness)', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', postedDate: '', publishDate: '2026-02-02', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.postedDate).toBe('2026-02-02');
  });

  it('uses the title as the excerpt when the description looks like a URL', async () => {
    stubOk({ opportunitiesData: [{ title: 'Radar', type: 'Solicitation', postedDate: '2026-06-18', description: 'https://example.gov/notice' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.excerpt).toBe('Radar');
  });

  it('uses the title as the excerpt when the description is a non-string', async () => {
    stubOk({ opportunitiesData: [{ title: 'Radar', type: 'Solicitation', postedDate: '2026-06-18', description: 12345 }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.excerpt).toBe('Radar');
  });

  it('strips HTML tags and collapses whitespace in the description excerpt', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', postedDate: '2026-06-18', description: '<p>Hello   <b>World</b></p>' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.excerpt).toBe('Hello World');
  });

  it('constructs a sam.gov URL when uiLink is absent (id encoded)', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID 9/9');
    expect(s?.url).toBe(`https://sam.gov/opp/${encodeURIComponent('NID 9/9')}/view`);
  });
});

describe('fetchSamNoticeById — malformed (non-string) field coercion (regression)', () => {
  it('defaults noticeType to "Notice" when type is a non-string (e.g. 0)', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 0, postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.noticeType).toBe('Notice');
    expect(typeof s?.noticeType).toBe('string');
  });

  it('ignores a non-string agency value and defaults to "Unknown Agency"', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', fullParentPathName: 42, postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.agency).toBe('Unknown Agency');
  });

  it('ignores a non-string uiLink and falls back to a constructed URL', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', uiLink: 7, postedDate: '2026-06-18', description: 'd' }] });
    const s = await fetchSamNoticeById('NID-7');
    expect(s?.url).toBe(`https://sam.gov/opp/${encodeURIComponent('NID-7')}/view`);
  });

  it('rejects a whitespace-only title (fail-fast identity guard)', async () => {
    stubOk({ opportunitiesData: [{ title: '   ', type: 'T', postedDate: '2026-06-18', description: 'd' }] });
    await expect(fetchSamNoticeById('NID')).resolves.toBeNull();
  });

  it('rejects a non-string title', async () => {
    stubOk({ opportunitiesData: [{ title: 123, type: 'T', postedDate: '2026-06-18', description: 'd' }] });
    await expect(fetchSamNoticeById('NID')).resolves.toBeNull();
  });
});

describe('fetchSamNoticeById — strict date requirement (fail-fast, NEW rule)', () => {
  it('returns null when both postedDate and publishDate are absent', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', description: 'd' }] });
    await expect(fetchSamNoticeById('NID-NODATE')).resolves.toBeNull();
  });

  it.each(['', '   ', '\t\n', '\u00a0'])('returns null when both dates are empty/whitespace (%p)', async (blank) => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', postedDate: blank, publishDate: blank, description: 'd' }] });
    await expect(fetchSamNoticeById('NID-BLANKDATE')).resolves.toBeNull();
  });

  it('still emits a signal when at least one date field is usable', async () => {
    stubOk({ opportunitiesData: [{ title: 'X', type: 'T', postedDate: '2026-03-03', description: 'd' }] });
    const s = await fetchSamNoticeById('NID');
    expect(s?.postedDate).toBe('2026-03-03');
  });
});

describe('fetchSamNoticeById — response envelope handling', () => {
  it('parses opportunitiesData given as a bare object (not an array)', async () => {
    stubOk({ opportunitiesData: opportunity() });
    const s = await fetchSamNoticeById('NID');
    expect(s?.title).toBe('Advanced Radar Systems — Solicitation');
  });

  it('parses a raw opportunity object at the top level (no envelope)', async () => {
    stubOk(opportunity());
    const s = await fetchSamNoticeById('NID');
    expect(s?.title).toBe('Advanced Radar Systems — Solicitation');
  });

  it('returns null when opportunitiesData is an empty array', async () => {
    stubOk({ opportunitiesData: [] });
    await expect(fetchSamNoticeById('NID')).resolves.toBeNull();
  });

  it('returns null when the response body is null', async () => {
    stubOk(null);
    await expect(fetchSamNoticeById('NID')).resolves.toBeNull();
  });

  it('returns null without throwing when response.json() throws (malformed JSON body)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    } as unknown as Response)));
    await expect(fetchSamNoticeById('NID')).resolves.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY-BASED — fuzz garbage payloads: never throw; null or a VALID SamSignal
// ─────────────────────────────────────────────────────────────────────────────

/** Assert a returned SamSignal is completely valid (every field well-formed). */
function assertValidSamSignal(s: unknown, noticeId: string): void {
  expect(s).not.toBeNull();
  const sig = s as Record<string, unknown>;
  expect(Object.keys(sig).sort()).toEqual(
    ['agency', 'excerpt', 'matchedKeyword', 'noticeType', 'postedDate', 'title', 'url', 'vertical'].sort()
  );
  for (const v of Object.values(sig)) expect(typeof v).toBe('string');
  // Non-empty guarantees from the parser's defaults / required fields.
  expect((sig.title as string).length).toBeGreaterThan(0);
  expect((sig.noticeType as string).length).toBeGreaterThan(0);
  expect((sig.agency as string).length).toBeGreaterThan(0);
  expect((sig.url as string).length).toBeGreaterThan(0);
  expect(sig.vertical).toBe('General');
  expect(sig.matchedKeyword).toBe(noticeId);
  // The NEW strict rule: a surfaced signal always carries a usable date.
  expect((sig.postedDate as string).trim().length).toBeGreaterThan(0);
  // Excerpt is bounded (may legitimately be empty after tag/whitespace cleaning).
  expect((sig.excerpt as string).length).toBeLessThanOrEqual(700);
}

/** Arbitrary opportunity with randomly-typed, randomly-present keys. */
const arbOpportunity = fc.record(
  {
    title: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    type: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
    baseType: fc.oneof(fc.string(), fc.constant(null)),
    fullParentPathName: fc.oneof(fc.string(), fc.constant(null)),
    organizationName: fc.oneof(fc.string(), fc.constant(null)),
    department: fc.oneof(fc.string(), fc.constant(null)),
    postedDate: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
    publishDate: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
    description: fc.oneof(fc.string(), fc.integer(), fc.object(), fc.constant(null)),
    uiLink: fc.oneof(fc.string(), fc.constant(null)),
  },
  { requiredKeys: [] }
);

/** Arbitrary response body: envelope variants plus total garbage. */
const arbBody = fc.oneof(
  arbOpportunity.map((op) => ({ opportunitiesData: [op] })),
  arbOpportunity.map((op) => ({ opportunitiesData: op })),
  arbOpportunity,
  fc.constant({ opportunitiesData: [] }),
  fc.constant(null),
  fc.anything(),
);

describe('Property: fetchSamNoticeById never throws and yields null or a valid SamSignal', () => {
  it('holds for arbitrary/garbage payloads across many runs', async () => {
    // Large budget so the persistent daily quota never interferes with fuzzing.
    process.env.SAMGOV_DAILY_LIMIT = String(Number.MAX_SAFE_INTEGER);

    await fc.assert(
      fc.asyncProperty(
        arbBody,
        fc.string().map((s) => `id-${s}`), // guaranteed non-empty → reaches the parser
        async (body, noticeId) => {
          vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok(body))));
          const result = await fetchSamNoticeById(noticeId);
          if (result !== null) assertValidSamSignal(result, noticeId);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('returns null (never throws) when response.json rejects, for any non-empty id', async () => {
    process.env.SAMGOV_DAILY_LIMIT = String(Number.MAX_SAFE_INTEGER);
    await fc.assert(
      fc.asyncProperty(fc.string().map((s) => `id-${s}`), async (noticeId) => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
          ok: true,
          status: 200,
          json: async () => { throw new Error('malformed'); },
        } as unknown as Response)));
        await expect(fetchSamNoticeById(noticeId)).resolves.toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
