/**
 * keywordGate.test.ts (Task 2.1)
 *
 * Feature: zero-cost-ingestion-layer — the zero-LLM cost-protection gate.
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.7
 *
 * The gate is the firewall protecting the $0/month budget: matchRecord must be a
 * pure, network-free predicate, and enrichFullText must fire ONLY for matches and
 * fail soft. These tests lock those guarantees.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  matchRecord,
  enrichFullText,
  runKeywordGateAndEnrich,
  GATE_KEYWORDS,
} from './keywordGate';
import type { IngestionRecord } from './ingestionTypes';

function record(overrides: Partial<IngestionRecord> = {}): IngestionRecord {
  return {
    source_system: 'EU_EPO',
    content_type: 'epo_patent',
    jurisdiction: 'EU',
    headline: 'A neutral headline with no signal terms',
    abstract: 'A neutral abstract.',
    source_url: 'https://example.org/doc',
    full_text_url: null,
    tracking_timestamp: '2026-06-19T08:00:00.000Z',
    external_id: 'ID-0',
    vertical_hint: null,
    language: 'en',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GATE_KEYWORDS', () => {
  it('should contain exactly 42 unique keywords', () => {
    expect(GATE_KEYWORDS).toHaveLength(42);
    expect(new Set(GATE_KEYWORDS).size).toBe(42);
  });
});

describe('matchRecord — gate purity (Req 7.1)', () => {
  it('should perform zero network calls', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    matchRecord(record({ headline: 'New semiconductor fab announced' }));
    matchRecord(record({ headline: 'nothing relevant here' }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should be synchronous and return a boolean', () => {
    const result = matchRecord(record({ headline: 'battery breakthrough' }));
    expect(typeof result).toBe('boolean');
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('should be deterministic — same input yields same output', () => {
    const rec = record({ headline: 'cybersecurity funding round' });
    expect(matchRecord(rec)).toBe(matchRecord(rec));
  });

  it('should match against both headline and abstract', () => {
    expect(matchRecord(record({ headline: 'plain', abstract: 'about hydrogen fuel' }))).toBe(true);
    expect(matchRecord(record({ headline: 'about hydrogen fuel', abstract: 'plain' }))).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(matchRecord(record({ headline: 'SEMICONDUCTOR shortage' }))).toBe(true);
  });
});

describe('matchRecord — false-positive prevention (word boundaries)', () => {
  it('should match the standalone keyword "grid"', () => {
    expect(matchRecord(record({ headline: 'grid modernization program' }))).toBe(true);
  });

  it('should NOT match "grid" inside "gridlock"', () => {
    expect(matchRecord(record({ headline: 'Urban gridlock worsens downtown', abstract: '' }))).toBe(false);
  });

  it('should NOT match "battery" inside "batterylife"', () => {
    expect(matchRecord(record({ headline: 'batterylife optimization tips', abstract: '' }))).toBe(false);
  });

  it('should return false for a record with no keyword', () => {
    expect(matchRecord(record())).toBe(false);
  });
});

describe('runKeywordGateAndEnrich — order & subset preservation (Req 7.5, 7.6)', () => {
  it('should return only matching records in their original order', async () => {
    const records = [
      record({ external_id: 'A', headline: 'semiconductor news' }),    // match
      record({ external_id: 'B', headline: 'celebrity gossip' }),       // no
      record({ external_id: 'C', headline: 'hydrogen plant opens' }),   // match
      record({ external_id: 'D', headline: 'weather report' }),         // no
      record({ external_id: 'E', headline: 'battery gigafactory' }),    // match
    ];

    const result = await runKeywordGateAndEnrich(records);

    expect(result.map((r) => r.external_id)).toEqual(['A', 'C', 'E']);
  });

  it('should return an empty array for empty input without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runKeywordGateAndEnrich([]);

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return an empty array when nothing matches, with no fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runKeywordGateAndEnrich([record({ headline: 'no signal' })]);

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should NOT trigger a fetch for non-matching records (Req 7.4)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => 'body' });
    vi.stubGlobal('fetch', fetchSpy);

    await runKeywordGateAndEnrich([
      record({ external_id: 'match', headline: 'semiconductor', full_text_url: 'https://x/1' }),
      record({ external_id: 'skip', headline: 'irrelevant', full_text_url: 'https://x/2' }),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://x/1', expect.anything());
  });

  it('property: output is an ordered subset of the input', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { maxLength: 20 }), async (flags) => {
        const records = flags.map((isMatch, i) =>
          record({
            external_id: `R${i}`,
            headline: isMatch ? 'semiconductor update' : 'unrelated chatter',
          })
        );
        const result = await runKeywordGateAndEnrich(records);
        const expected = records.filter((_, i) => flags[i]).map((r) => r.external_id);
        expect(result.map((r) => r.external_id)).toEqual(expected);
      })
    );
  });
});

describe('enrichFullText — resilience & timeouts (Req 7.7)', () => {
  it('should enrich a matched record on a successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'LONG BODY' }));

    const result = await enrichFullText(record({ full_text_url: 'https://x/full' }));

    expect(result.enrichmentCompleted).toBe(true);
    expect(result.fullText).toBe('LONG BODY');
  });

  it('should no-op (not completed) when full_text_url is null, without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await enrichFullText(record({ full_text_url: null }));

    expect(result.enrichmentCompleted).toBe(false);
    expect(result.fullText).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return enrichmentCompleted:false on a non-OK response without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }));

    const result = await enrichFullText(record({ full_text_url: 'https://x/full' }));

    expect(result.enrichmentCompleted).toBe(false);
    expect(result.fullText).toBeUndefined();
  });

  it('should return enrichmentCompleted:false on a network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const result = await enrichFullText(record({ full_text_url: 'https://x/full' }));

    expect(result.enrichmentCompleted).toBe(false);
  });

  it('should abort and fail soft when the fetch exceeds the 10s timeout', async () => {
    vi.useFakeTimers();
    // fetch that only settles when its abort signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
      )
    );

    const pending = enrichFullText(record({ full_text_url: 'https://x/slow' }));
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result.enrichmentCompleted).toBe(false);
    expect(result.fullText).toBeUndefined();
  });

  it('should not crash the batch when one matched record fails to enrich', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/ok')
          ? Promise.resolve({ ok: true, text: async () => 'BODY' } as Response)
          : Promise.reject(new Error('boom'))
      )
    );

    const result = await runKeywordGateAndEnrich([
      record({ external_id: 'good', headline: 'semiconductor', full_text_url: 'https://x/ok' }),
      record({ external_id: 'bad', headline: 'hydrogen', full_text_url: 'https://x/fail' }),
    ]);

    expect(result.map((r) => r.external_id)).toEqual(['good', 'bad']);
    expect(result[0].enrichmentCompleted).toBe(true);
    expect(result[1].enrichmentCompleted).toBe(false);
  });
});
