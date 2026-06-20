/**
 * ingestionAdapter.test.ts (Task 1.1)
 *
 * Feature: zero-cost-ingestion-layer — the single IngestionRecord → EDGARSignal seam.
 * Validates: Requirements 6.1, 6.3, 6.4, 6.6, 6.7, 6.8, 13.3
 *
 * Scope note: the 24h UTC lookback window is connector-level logic (Tasks 3/4/5/5.2)
 * and is covered by each connector's own suite — NOT here. The real EDGARSignal seam
 * has eight string fields and no numeric `sourceAuthority`; credibility is computed
 * downstream on ReportSuggestion. So these tests assert string integrity, not numerics.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { VERTICALS } from '../../types';
import { ingestionRecordToEdgarSignal, adaptRecords } from './ingestionAdapter';
import type {
  IngestionRecord,
  SourceSystem,
  ContentType,
} from './ingestionTypes';

const ALL_SOURCE_SYSTEMS: SourceSystem[] = [
  'RSS', 'NEWSAPI', 'EDGAR', 'SAM_GOV', 'EU_TED',
  'UK_FTS', 'UK_CONTRACTS_FINDER', 'US_FEDERAL_REGISTER', 'EU_EPO',
];

const ALL_CONTENT_TYPES: ContentType[] = [
  'news', 'regulatory_filing', 'procurement_notice', 'award_notice', 'epo_patent',
];

const REQUIRED_FIELDS: Array<keyof IngestionRecord> = [
  'source_system', 'content_type', 'headline', 'abstract',
  'source_url', 'tracking_timestamp', 'external_id',
];

/** A complete, valid baseline record (EU_EPO patent) to mutate per test. */
function validEpoRecord(overrides: Partial<IngestionRecord> = {}): IngestionRecord {
  return {
    source_system: 'EU_EPO',
    content_type: 'epo_patent',
    jurisdiction: 'EU',
    headline: 'Method for solid-state battery electrolyte deposition',
    abstract: 'A patent describing a novel deposition technique for solid-state cells.',
    source_url: 'https://ops.epo.org/3.2/rest-services/published-data/EP1234567',
    full_text_url: 'https://ops.epo.org/3.2/rest-services/published-data/EP1234567/fulltext',
    tracking_timestamp: '2026-06-19T08:00:00.000Z',
    external_id: 'EP1234567B1',
    vertical_hint: 'Energy',
    language: 'en',
    ...overrides,
  };
}

describe('ingestionRecordToEdgarSignal — field mapping', () => {
  it('should map every IngestionRecord field to its EDGARSignal counterpart', () => {
    const rec = validEpoRecord();

    const signal = ingestionRecordToEdgarSignal(rec);

    expect(signal).toEqual({
      title: rec.headline,
      filingType: rec.content_type, // 'epo_patent'
      companyName: rec.source_system, // 'EU_EPO'
      filingDate: rec.tracking_timestamp,
      excerpt: rec.abstract,
      url: rec.source_url,
      vertical: 'Energy',
      matchedKeyword: rec.external_id,
    });
  });

  it('should carry the epo_patent content_type through to filingType', () => {
    const signal = ingestionRecordToEdgarSignal(validEpoRecord());
    expect(signal.filingType).toBe('epo_patent');
    expect(signal.companyName).toBe('EU_EPO');
  });
});

describe('ingestionRecordToEdgarSignal — vertical fallback (Req 6.4)', () => {
  it('should use the vertical_hint when it is a known Kaiso vertical', () => {
    const signal = ingestionRecordToEdgarSignal(validEpoRecord({ vertical_hint: 'Semiconductor' }));
    expect(signal.vertical).toBe('Semiconductor');
  });

  it('should fall back to General when vertical_hint is null', () => {
    const signal = ingestionRecordToEdgarSignal(validEpoRecord({ vertical_hint: null }));
    expect(signal.vertical).toBe('General');
  });

  it('should fall back to General when vertical_hint is not a recognized vertical', () => {
    const signal = ingestionRecordToEdgarSignal(validEpoRecord({ vertical_hint: 'Atlantis' }));
    expect(signal.vertical).toBe('General');
  });
});

describe('ingestionRecordToEdgarSignal — excerpt truncation boundary (Req 6.8)', () => {
  it('should leave an abstract of exactly 700 chars unchanged', () => {
    const abstract = 'a'.repeat(700);
    const signal = ingestionRecordToEdgarSignal(validEpoRecord({ abstract }));
    expect(signal.excerpt).toHaveLength(700);
    expect(signal.excerpt).toBe(abstract);
  });

  it('should truncate an abstract of 701 chars to 700', () => {
    const abstract = 'b'.repeat(701);
    const signal = ingestionRecordToEdgarSignal(validEpoRecord({ abstract }));
    expect(signal.excerpt).toHaveLength(700);
    expect(signal.excerpt).toBe('b'.repeat(700));
  });

  it('should leave a short abstract unchanged', () => {
    const abstract = 'short summary';
    const signal = ingestionRecordToEdgarSignal(validEpoRecord({ abstract }));
    expect(signal.excerpt).toBe(abstract);
  });
});

describe('ingestionRecordToEdgarSignal — strict error handling (Req 6.7)', () => {
  for (const field of REQUIRED_FIELDS) {
    it(`should throw naming "${field}" when it is missing`, () => {
      const rec = validEpoRecord();
      delete (rec as unknown as Record<string, unknown>)[field];
      expect(() => ingestionRecordToEdgarSignal(rec)).toThrow(field as string);
    });

    it(`should throw naming "${field}" when it is an empty string`, () => {
      const rec = validEpoRecord({ [field]: '' } as Partial<IngestionRecord>);
      expect(() => ingestionRecordToEdgarSignal(rec)).toThrow(field as string);
    });

    it(`should throw naming "${field}" when it is whitespace only`, () => {
      const rec = validEpoRecord({ [field]: '   ' } as Partial<IngestionRecord>);
      expect(() => ingestionRecordToEdgarSignal(rec)).toThrow(field as string);
    });
  }

  it('should never emit a partial signal — it throws instead of returning', () => {
    const rec = validEpoRecord({ headline: '' });
    expect(() => ingestionRecordToEdgarSignal(rec)).toThrow();
  });

  it('should NOT throw when only the nullable fields are absent', () => {
    const rec = validEpoRecord({ vertical_hint: null, full_text_url: null });
    expect(() => ingestionRecordToEdgarSignal(rec)).not.toThrow();
  });
});

describe('adaptRecords — batch', () => {
  it('should map every record and preserve order', () => {
    const records = [
      validEpoRecord({ external_id: 'EP1' }),
      validEpoRecord({ external_id: 'EP2', source_system: 'EU_TED', content_type: 'procurement_notice' }),
    ];

    const signals = adaptRecords(records);

    expect(signals).toHaveLength(2);
    expect(signals[0].matchedKeyword).toBe('EP1');
    expect(signals[1].matchedKeyword).toBe('EP2');
    expect(signals[1].filingType).toBe('procurement_notice');
  });

  it('should return an empty array for empty input', () => {
    expect(adaptRecords([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property-based — strict data-type integrity across ALL five source systems
// ─────────────────────────────────────────────────────────────────────────────

/** Arbitrary non-empty, non-whitespace string. */
const nonEmptyStr = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => `x${s}`);

const validRecordArb: fc.Arbitrary<IngestionRecord> = fc.record({
  source_system: fc.constantFrom(...ALL_SOURCE_SYSTEMS),
  content_type: fc.constantFrom(...ALL_CONTENT_TYPES),
  jurisdiction: nonEmptyStr,
  headline: nonEmptyStr,
  abstract: fc.string({ minLength: 1, maxLength: 1000 }).map((s) => `x${s}`),
  source_url: nonEmptyStr,
  full_text_url: fc.option(nonEmptyStr, { nil: null }),
  tracking_timestamp: nonEmptyStr,
  external_id: nonEmptyStr,
  vertical_hint: fc.option(fc.constantFrom(...VERTICALS, 'NotAVertical'), { nil: null }),
  language: nonEmptyStr,
});

describe('Property: every valid record maps to a structurally valid EDGARSignal', () => {
  it('should produce eight non-empty string fields for any source system', () => {
    fc.assert(
      fc.property(validRecordArb, (rec) => {
        const signal = ingestionRecordToEdgarSignal(rec);
        for (const value of Object.values(signal)) {
          expect(typeof value).toBe('string');
          expect((value as string).length).toBeGreaterThan(0);
        }
      })
    );
  });

  it('should always keep excerpt at or below 700 chars', () => {
    fc.assert(
      fc.property(validRecordArb, (rec) => {
        const signal = ingestionRecordToEdgarSignal(rec);
        expect(signal.excerpt.length).toBeLessThanOrEqual(700);
      })
    );
  });

  it('should always resolve vertical to a known vertical or General', () => {
    const allowed = new Set<string>([...VERTICALS, 'General']);
    fc.assert(
      fc.property(validRecordArb, (rec) => {
        const signal = ingestionRecordToEdgarSignal(rec);
        expect(allowed.has(signal.vertical)).toBe(true);
      })
    );
  });
});
