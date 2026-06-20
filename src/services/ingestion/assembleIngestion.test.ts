/**
 * assembleIngestion.test.ts (Task 8.1)
 *
 * Feature: zero-cost-ingestion-layer — Phase-0 assembly integration tests.
 * Validates: Requirements 1.2, 1.6, 5.6, 5.7, 6.5, 6.6, 8.4
 *
 * Exercises the extracted `assembleCombinedSignals` core (no Express, no network):
 * fan-out resilience (partial success / total failure), SAM-ID precision (distinct
 * lookups + quota cap), and the EDGARSignal[] output invariant.
 *
 * All test records use full_text_url: null so the real keyword gate runs with zero
 * network calls (lazy fetch is only triggered for a non-null URL).
 */

import { describe, it, expect, vi } from 'vitest';
import { assembleCombinedSignals } from './assembleIngestion';
import type { IngestionRecord, SourceSystem } from './ingestionTypes';
import type { SamSignal } from '../samGovService';
import type { EDGARSignal } from '../../types';

/** A gate-MATCHING record (contains 'semiconductor') with no full_text_url. */
function rec(source: SourceSystem, externalId: string, overrides: Partial<IngestionRecord> = {}): IngestionRecord {
  return {
    source_system: source,
    content_type: source === 'EU_EPO' ? 'epo_patent' : 'procurement_notice',
    jurisdiction: 'EU',
    headline: 'Semiconductor inspection systems procurement',
    abstract: 'A semiconductor-related opportunity.',
    source_url: `https://example.org/${externalId}`,
    full_text_url: null,
    tracking_timestamp: '2026-06-18T00:00:00.000Z',
    external_id: externalId,
    vertical_hint: null,
    language: 'en',
    ...overrides,
  };
}

function edgar(id: string): EDGARSignal {
  return {
    title: `EDGAR ${id}`, filingType: '10-K', companyName: 'ACME', filingDate: '2026-06-18',
    excerpt: 'semiconductor filing', url: `https://sec.gov/${id}`, vertical: 'Semiconductor', matchedKeyword: id,
  };
}

function samSignal(id: string): SamSignal {
  return {
    title: `Notice ${id} — Solicitation`, noticeType: 'Solicitation', agency: 'DoD',
    postedDate: '2026-06-18', excerpt: 'radar', url: `https://sam.gov/opp/${id}/view`,
    vertical: 'General', matchedKeyword: id,
  };
}

/** Default lookup: always resolves a signal. */
const alwaysFound = async (id: string) => samSignal(id);
/** Default empty-source params. */
function base() {
  return {
    rssArticleCount: 0,
    edgarSignals: [] as EDGARSignal[],
    tedRecords: [] as IngestionRecord[],
    ukFtsRecords: [] as IngestionRecord[],
    fedRegRecords: [] as IngestionRecord[],
    epoRecords: [] as IngestionRecord[],
    rejectedCount: 0,
    samLookup: vi.fn(alwaysFound),
  };
}

describe('assembleCombinedSignals — fan-out resilience (Req 1.2, 1.6)', () => {
  it('should complete with valid signals from the remaining 3 when 2 connectors are empty', async () => {
    const result = await assembleCombinedSignals({
      ...base(),
      edgarSignals: [edgar('E1')],
      tedRecords: [rec('EU_TED', 'T1')],
      ukFtsRecords: [],        // simulated-empty connector #1
      fedRegRecords: [],       // simulated-empty connector #2
      epoRecords: [rec('EU_EPO', 'P1')],
      rejectedCount: 1,        // one hard rejection upstream
    });

    expect(result.status).toBe('PARTIAL_SUCCESS');
    // EDGAR (1) + TED (1) + EPO (1) all survive into the combined output.
    expect(result.combinedSignals.map((s) => s.matchedKeyword)).toEqual(['E1', 'T1', 'P1']);
  });

  it('should report TOTAL_FAILURE only when every source AND rss is empty', async () => {
    const result = await assembleCombinedSignals(base());
    expect(result.status).toBe('TOTAL_FAILURE');
    expect(result.combinedSignals).toEqual([]);
  });

  it('should report FULL_SUCCESS when all five external sources return data', async () => {
    const result = await assembleCombinedSignals({
      ...base(),
      edgarSignals: [edgar('E1')],
      tedRecords: [rec('EU_TED', 'T1')],
      ukFtsRecords: [rec('UK_FTS', 'U1')],
      fedRegRecords: [rec('US_FEDERAL_REGISTER', 'F1')],
      epoRecords: [rec('EU_EPO', 'P1')],
    });
    expect(result.status).toBe('FULL_SUCCESS');
  });

  it('should stay PARTIAL (not total) when only rss carried data', async () => {
    const result = await assembleCombinedSignals({ ...base(), rssArticleCount: 12 });
    expect(result.status).toBe('PARTIAL_SUCCESS');
  });

  it('should not let a non-matching record reach the output (gate filters it)', async () => {
    const result = await assembleCombinedSignals({
      ...base(),
      tedRecords: [rec('EU_TED', 'MATCH'), rec('EU_TED', 'SKIP', { headline: 'unrelated gossip', abstract: 'nothing' })],
    });
    expect(result.combinedSignals.map((s) => s.matchedKeyword)).toEqual(['MATCH']);
  });
});

describe('assembleCombinedSignals — SAM precision (Req 5.7, 8.4)', () => {
  it('should look up only DISTINCT solicitation IDs across multiple FedReg notices', async () => {
    const samLookup = vi.fn(alwaysFound);
    const fed1 = rec('US_FEDERAL_REGISTER', 'F1', {
      abstract: 'semiconductor rule referencing W911NF-24-R-0001 and FA8750-23-R-1000.',
    });
    const fed2 = rec('US_FEDERAL_REGISTER', 'F2', {
      abstract: 'semiconductor rule again citing W911NF-24-R-0001.', // duplicate ID
    });

    const result = await assembleCombinedSignals({ ...base(), fedRegRecords: [fed1, fed2], samLookup });

    expect(result.watchlistIds).toEqual(['W911NF-24-R-0001', 'FA8750-23-R-1000']);
    expect(samLookup).toHaveBeenCalledTimes(2); // distinct only — not 3
  });

  it('should cap SAM signals at the daily quota when the lookup starts returning null', async () => {
    // Simulate a 10/day quota inside the injected lookup: first 10 succeed, rest null.
    let spent = 0;
    const quotaLookup = vi.fn(async (id: string) => (spent++ < 10 ? samSignal(id) : null));

    // One FedReg notice referencing 15 distinct solicitation IDs.
    const ids = Array.from({ length: 15 }, (_, i) => `W911NF-24-R-${String(1000 + i)}`);
    const fed = rec('US_FEDERAL_REGISTER', 'F1', {
      abstract: `semiconductor rule referencing ${ids.join(' ')}.`,
    });

    const result = await assembleCombinedSignals({ ...base(), fedRegRecords: [fed], samLookup: quotaLookup });

    expect(result.watchlistIds).toHaveLength(15);
    expect(result.samSignalCount).toBe(10); // capped by the quota-exhausting lookup
  });

  it('should make zero SAM lookups when no FedReg notice references an ID', async () => {
    const samLookup = vi.fn(alwaysFound);
    await assembleCombinedSignals({
      ...base(),
      fedRegRecords: [rec('US_FEDERAL_REGISTER', 'F1', { abstract: 'a semiconductor rule with no solicitation reference' })],
      samLookup,
    });
    expect(samLookup).not.toHaveBeenCalled();
  });
});

describe('assembleCombinedSignals — EDGARSignal[] invariant (Req 6.5, 6.6)', () => {
  it('should output a pure EDGARSignal[] with the existing 8-field shape and ordering', async () => {
    const result = await assembleCombinedSignals({
      ...base(),
      edgarSignals: [edgar('E1')],
      tedRecords: [rec('EU_TED', 'T1')],
      fedRegRecords: [rec('US_FEDERAL_REGISTER', 'F1', { abstract: 'semiconductor rule W911NF-24-R-0001' })],
    });

    // EDGAR first, then adapted ingestion, then adapted SAM.
    expect(result.combinedSignals.map((s) => s.matchedKeyword)).toEqual(['E1', 'T1', 'F1', 'W911NF-24-R-0001']);

    const EXPECTED_KEYS = ['title', 'filingType', 'companyName', 'filingDate', 'excerpt', 'url', 'vertical', 'matchedKeyword'];
    for (const signal of result.combinedSignals) {
      expect(Object.keys(signal).sort()).toEqual([...EXPECTED_KEYS].sort());
      for (const value of Object.values(signal)) {
        expect(typeof value).toBe('string');
      }
    }
  });
});
