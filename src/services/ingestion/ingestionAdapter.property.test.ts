/**
 * ingestionAdapter.property.test.ts (Task 1.1 — property-based hardening)
 *
 * Feature: zero-cost-ingestion-layer — the single, SOURCE-AGNOSTIC
 * IngestionRecord → EDGARSignal seam (`ingestionAdapter.ts`).
 *
 * This file pushes fast-check to the limits on the adapter's pure contract.
 * It deliberately scopes ONLY to adapter behavior — connector-specific concerns
 * (SAM.gov partial-payload lookups, EPO free-tier allowance guardrails, the 24h
 * lookback windows) live in their own suites (samGovService.test.ts,
 * epoService.test.ts, tedService.test.ts, …) and are NOT exercised here.
 *
 * Validated invariants (universally quantified over fuzzed IngestionRecords):
 *  - Source-agnostic totality: a record with all 7 required fields non-empty
 *    maps successfully for EVERY one of the 9 `source_system` values — the
 *    adapter never branches on, nor drops, any valid source's payload.
 *  - Lossless field passthrough under hostile input (Unicode anomalies, control
 *    chars, RTL overrides, injection-style and path-traversal payloads, emoji,
 *    extreme lengths): the eight EDGARSignal fields equal their record sources.
 *  - Excerpt boundary: `excerpt === abstract.slice(0, 700)`, always a prefix,
 *    length === min(|abstract|, 700), exhaustively stressed around 700.
 *  - Vertical resolution: result is always a known Kaiso vertical or 'General';
 *    a known hint is preserved, null/unrecognized collapses to 'General'.
 *  - Strict validation: any required field that is empty/whitespace throws an
 *    Error naming that field — no partial EDGARSignal is ever emitted.
 *  - Purity & determinism: equal inputs → deep-equal outputs; the input record
 *    is never mutated.
 *  - Batch totality: `adaptRecords` preserves count and order (1:1), so no valid
 *    payload is dropped or reordered.
 *
 * Validates: Requirements 6.3, 6.4, 6.6, 6.7, 6.8
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

/** The adapter's excerpt ceiling (mirrors MAX_EXCERPT_LENGTH in the adapter). */
const MAX_EXCERPT_LENGTH = 700;

/** All 9 source systems — the adapter must treat every one identically. */
const ALL_SOURCE_SYSTEMS: readonly SourceSystem[] = [
  'RSS',
  'NEWSAPI',
  'EDGAR',
  'SAM_GOV',
  'EU_TED',
  'UK_FTS',
  'UK_CONTRACTS_FINDER',
  'US_FEDERAL_REGISTER',
  'EU_EPO',
];

const ALL_CONTENT_TYPES: readonly ContentType[] = [
  'news',
  'regulatory_filing',
  'procurement_notice',
  'award_notice',
  'epo_patent',
];

/** The 7 fields the adapter requires to be present, non-empty, non-whitespace. */
const REQUIRED_FIELDS: ReadonlyArray<keyof IngestionRecord> = [
  'source_system',
  'content_type',
  'headline',
  'abstract',
  'source_url',
  'tracking_timestamp',
  'external_id',
];

// ── Hostile-input arbitraries ────────────────────────────────────────────────

/** Known nasty literals: injection, traversal, control, RTL, BOM, astral, emoji. */
const MALICIOUS_LITERALS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE signals;--",
  '${process.env.SECRET}',
  '{{7*7}}',
  '../../../../etc/passwd',
  '..\\..\\windows\\system32',
  '%00%0a%0d',
  '\u0000\u0001\u0002\u0007', // NUL + control chars (NOT stripped by trim)
  '\u202Egnp.exe', // right-to-left override
  '\uFEFF\uFFFE', // BOM / non-character
  '𝕏𝕐𝕑 𝔘𝔫𝔦𝔠𝔬𝔡𝔢', // astral-plane (surrogate pairs)
  '👨‍👩‍👧‍👦🧬⚛️', // ZWJ emoji sequence
  'Ｆｕｌｌｗｉｄｔｈ',
  '\t\n\r mixed \f\v whitespace inside ',
];

/** A broad "dangerous" string: unicode, control, literals, and long variants. */
const dangerousStr: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.string({ unit: 'grapheme' }), // full-unicode graphemes incl. astral plane
  fc.string({ unit: 'binary' }), // raw 16-bit units incl. lone surrogates
  fc.constantFrom(...MALICIOUS_LITERALS),
  fc.string({ minLength: 1024, maxLength: 4096 }), // extreme length
);

/**
 * A required string field: an arbitrary hostile payload guaranteed non-empty
 * after trim() by prefixing a stable non-whitespace sentinel. This lets us fuzz
 * malicious *content* while staying on the adapter's success path (so we can
 * assert lossless passthrough). The sentinel is part of the value, so exact
 * equality assertions still hold.
 */
const requiredDangerousField: fc.Arbitrary<string> = dangerousStr.map(
  (s) => `x${s}`
);

/** vertical_hint: known verticals, junk strings, empty, or null. */
const verticalHintArb: fc.Arbitrary<string | null> = fc.option(
  fc.oneof(
    fc.constantFrom(...VERTICALS),
    fc.constantFrom('Atlantis', 'general', 'GENERAL', '<xss>', '', '   ')
  ),
  { nil: null }
);

/** A fully-valid (adapter-mappable) record with hostile content in every field. */
const validHostileRecordArb: fc.Arbitrary<IngestionRecord> = fc.record({
  source_system: fc.constantFrom(...ALL_SOURCE_SYSTEMS),
  content_type: fc.constantFrom(...ALL_CONTENT_TYPES),
  jurisdiction: fc.oneof(dangerousStr, fc.constant('')), // ignored by adapter
  headline: requiredDangerousField,
  abstract: requiredDangerousField,
  source_url: requiredDangerousField,
  full_text_url: fc.option(dangerousStr, { nil: null }), // ignored by adapter
  tracking_timestamp: requiredDangerousField,
  external_id: requiredDangerousField,
  vertical_hint: verticalHintArb,
  language: fc.oneof(dangerousStr, fc.constant('')), // ignored by adapter
});

/** Whitespace/empty alphabet that the adapter must reject for required fields. */
const whitespaceOrEmptyArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', '\u2028'),
  maxLength: 8,
});

const KNOWN_VERTICALS = new Set<string>(VERTICALS);

// ── Properties ───────────────────────────────────────────────────────────────

describe('Property: source-agnostic totality across all 9 source systems', () => {
  it('maps a valid record successfully for EVERY source_system value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_SOURCE_SYSTEMS),
        validHostileRecordArb,
        (sourceSystem, base) => {
          const rec: IngestionRecord = { ...base, source_system: sourceSystem };
          const signal = ingestionRecordToEdgarSignal(rec);
          // The source system is carried verbatim — never branched on or dropped.
          expect(signal.companyName).toBe(sourceSystem);
          // And the result is a structurally valid (8 non-empty strings) signal.
          for (const value of Object.values(signal)) {
            expect(typeof value).toBe('string');
            expect((value as string).length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 800 }
    );
  });

  it('covers all 9 source systems explicitly (no value left unexercised)', () => {
    for (const sourceSystem of ALL_SOURCE_SYSTEMS) {
      const rec: IngestionRecord = {
        source_system: sourceSystem,
        content_type: 'news',
        jurisdiction: 'US',
        headline: 'h',
        abstract: 'a',
        source_url: 'https://example.test/x',
        full_text_url: null,
        tracking_timestamp: '2026-06-22T00:00:00.000Z',
        external_id: `id-${sourceSystem}`,
        vertical_hint: null,
        language: 'en',
      };
      const signal = ingestionRecordToEdgarSignal(rec);
      expect(signal.companyName).toBe(sourceSystem);
      expect(signal.matchedKeyword).toBe(`id-${sourceSystem}`);
    }
  });
});

describe('Property: lossless field passthrough under hostile input', () => {
  it('maps the eight EDGARSignal fields exactly from their record sources', () => {
    fc.assert(
      fc.property(validHostileRecordArb, (rec) => {
        const signal = ingestionRecordToEdgarSignal(rec);
        expect(signal.title).toBe(rec.headline);
        expect(signal.filingType).toBe(rec.content_type);
        expect(signal.companyName).toBe(rec.source_system);
        expect(signal.filingDate).toBe(rec.tracking_timestamp);
        expect(signal.url).toBe(rec.source_url);
        expect(signal.matchedKeyword).toBe(rec.external_id);
        // excerpt is the (possibly truncated) abstract; vertical handled below.
        expect(rec.abstract.startsWith(signal.excerpt)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it('produces exactly the documented EDGARSignal key set (no extra/leaked fields)', () => {
    fc.assert(
      fc.property(validHostileRecordArb, (rec) => {
        const signal = ingestionRecordToEdgarSignal(rec);
        expect(Object.keys(signal).sort()).toEqual(
          [
            'companyName',
            'excerpt',
            'filingDate',
            'filingType',
            'matchedKeyword',
            'title',
            'url',
            'vertical',
          ].sort()
        );
      }),
      { numRuns: 200 }
    );
  });
});

describe('Property: excerpt 700-char boundary stress', () => {
  it('always equals abstract.slice(0,700), is a prefix, len === min(|abstract|,700)', () => {
    fc.assert(
      fc.property(
        // Lengths densely sampled around the 700 boundary and well beyond it.
        fc.integer({ min: 1, max: 1500 }),
        fc.constantFrom('a', '€', '🧬', '𝕏', '\u0000'),
        (len, fill) => {
          const abstract = fill.repeat(len);
          const rec: IngestionRecord = {
            source_system: 'EU_TED',
            content_type: 'procurement_notice',
            jurisdiction: 'EU',
            headline: 'boundary-stress',
            abstract,
            source_url: 'https://example.test/x',
            full_text_url: null,
            tracking_timestamp: '2026-06-22T00:00:00.000Z',
            external_id: 'bnd-1',
            vertical_hint: null,
            language: 'en',
          };
          const { excerpt } = ingestionRecordToEdgarSignal(rec);
          expect(excerpt).toBe(abstract.slice(0, MAX_EXCERPT_LENGTH));
          expect(abstract.startsWith(excerpt)).toBe(true);
          expect(excerpt.length).toBe(
            Math.min(abstract.length, MAX_EXCERPT_LENGTH)
          );
          expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH);
        }
      ),
      { numRuns: 800 }
    );
  });

  it('preserves abstracts at or below 700 chars verbatim', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 700 }), (len) => {
        const abstract = 'z'.repeat(len);
        const { excerpt } = ingestionRecordToEdgarSignal({
          source_system: 'RSS',
          content_type: 'news',
          jurisdiction: 'US',
          headline: 'h',
          abstract,
          source_url: 'https://example.test/x',
          full_text_url: null,
          tracking_timestamp: '2026-06-22T00:00:00.000Z',
          external_id: 'id',
          vertical_hint: null,
          language: 'en',
        });
        expect(excerpt).toBe(abstract);
      }),
      { numRuns: 300 }
    );
  });
});

describe('Property: vertical resolution invariant (Req 6.4)', () => {
  it('always resolves to a known Kaiso vertical or General', () => {
    const allowed = new Set<string>([...VERTICALS, 'General']);
    fc.assert(
      fc.property(validHostileRecordArb, (rec) => {
        const { vertical } = ingestionRecordToEdgarSignal(rec);
        expect(allowed.has(vertical)).toBe(true);
      }),
      { numRuns: 600 }
    );
  });

  it('preserves a known hint and collapses null/unrecognized to General', () => {
    fc.assert(
      fc.property(validHostileRecordArb, (rec) => {
        const { vertical } = ingestionRecordToEdgarSignal(rec);
        if (rec.vertical_hint && KNOWN_VERTICALS.has(rec.vertical_hint)) {
          expect(vertical).toBe(rec.vertical_hint);
        } else {
          expect(vertical).toBe('General');
        }
      }),
      { numRuns: 600 }
    );
  });
});

describe('Property: strict validation rejects empty/whitespace required fields (Req 6.7)', () => {
  it('throws an Error naming any required field set to empty/whitespace', () => {
    fc.assert(
      fc.property(
        validHostileRecordArb,
        fc.constantFrom(...REQUIRED_FIELDS),
        whitespaceOrEmptyArb,
        (base, field, blank) => {
          const rec = { ...base, [field]: blank } as IngestionRecord;
          let threw: Error | null = null;
          try {
            ingestionRecordToEdgarSignal(rec);
          } catch (e) {
            threw = e as Error;
          }
          // No partial signal: it must have thrown, naming the offending field.
          expect(threw).toBeInstanceOf(Error);
          expect(threw!.message).toContain(field);
        }
      ),
      { numRuns: 600 }
    );
  });

  it('throws naming any required field that is entirely absent', () => {
    fc.assert(
      fc.property(
        validHostileRecordArb,
        fc.constantFrom(...REQUIRED_FIELDS),
        (base, field) => {
          const rec = { ...base };
          delete (rec as unknown as Record<string, unknown>)[field];
          expect(() => ingestionRecordToEdgarSignal(rec)).toThrow(
            field as string
          );
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('Property: purity & determinism', () => {
  it('returns deep-equal output for equal input and never mutates the record', () => {
    fc.assert(
      fc.property(validHostileRecordArb, (rec) => {
        const snapshot = structuredClone(rec);
        const a = ingestionRecordToEdgarSignal(rec);
        const b = ingestionRecordToEdgarSignal(rec);
        expect(a).toEqual(b);
        // Input is untouched (no in-place normalization/truncation leaks back).
        expect(rec).toEqual(snapshot);
      }),
      { numRuns: 600 }
    );
  });
});

describe('Property: adaptRecords batch totality (no dropped/reordered payloads)', () => {
  it('preserves count and order 1:1 across arbitrary valid batches', () => {
    fc.assert(
      fc.property(
        fc.array(validHostileRecordArb, { maxLength: 50 }),
        (records) => {
          const signals = adaptRecords(records);
          expect(signals).toHaveLength(records.length);
          for (let i = 0; i < records.length; i += 1) {
            expect(signals[i].matchedKeyword).toBe(records[i].external_id);
            expect(signals[i].companyName).toBe(records[i].source_system);
            expect(signals[i].title).toBe(records[i].headline);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('returns an empty array for an empty batch', () => {
    expect(adaptRecords([])).toEqual([]);
  });
});
