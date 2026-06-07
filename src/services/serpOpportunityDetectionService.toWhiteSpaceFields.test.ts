/**
 * serpOpportunityDetectionService.toWhiteSpaceFields.test.ts (Tasks 5.7*, 5.8*, 5.9*, 5.10)
 *
 * Property 13: Class-to-status mapping is total and single-valued (R10.1–10.6).
 * Property 14: Classified suggestions carry the full output contract (R10.7).
 * Property 11: Contributing signal types are recorded (R3.8).
 * Plus edge unit test: missing/unrecognized class maps to UNKNOWN (R10.6).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  toWhiteSpaceFields,
  extractSignals,
  countCompetitors,
  applyRubric,
  SCORING_RUBRIC,
  type Classification,
  type SerpResponse,
  type SerpOrganicResult,
} from './serpOpportunityDetectionService';
import type { OpportunityClass } from '../types';

const EXPECTED_STATUS: Record<OpportunityClass, string> = {
  GREEN: 'CONFIRMED_GAP',
  YELLOW: 'PARTIAL_COVERAGE',
  RED: 'COMMODITISED',
};
const CONTRACT_VALUES = ['CONFIRMED_GAP', 'PARTIAL_COVERAGE', 'COMMODITISED', 'UNKNOWN'];

describe('Property 13: class-to-status mapping is total and single-valued', () => {
  it('maps each class to exactly one status; unrecognized → UNKNOWN', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<OpportunityClass>('GREEN', 'YELLOW', 'RED'),
        fc.integer({ min: 0, max: 100 }),
        (cls, score) => {
          const result = toWhiteSpaceFields({ opportunityClass: cls, score, reason: 'gap' }, [], []);
          expect(result.whiteSpaceStatus).toBe(EXPECTED_STATUS[cls]);
          expect(CONTRACT_VALUES).toContain(result.whiteSpaceStatus);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 14: classified suggestions carry the full output contract', () => {
  it('defines all five contract fields for a non-UNKNOWN classification', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<OpportunityClass>('GREEN', 'YELLOW', 'RED'),
        fc.array(fc.domain(), { maxLength: 6 }),
        (cls, domains) => {
          const classification: Classification = { opportunityClass: cls, score: 50, reason: 'partial' };
          const f = toWhiteSpaceFields(classification, domains, ['ORGANIC']);
          expect(f.whiteSpaceStatus).not.toBe('UNKNOWN');
          expect(typeof f.whiteSpaceScore).toBe('number');
          expect(typeof f.whiteSpaceLabel).toBe('string');
          expect(Array.isArray(f.whiteSpaceCompetitors)).toBe(true);
          expect(typeof f.whiteSpaceGapReason).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 11: contributing signal types are recorded', () => {
  it('whiteSpaceSignals equals the signal types extracted from the response', () => {
    const competitor = (n: number): SerpOrganicResult => ({
      title: 'Widget Market Size Report',
      link: `https://pub${n}.com/industry-report/widgets`,
      domain: `pub${n}.com`,
    });
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 8 }), (ids) => {
        const resp: SerpResponse = { keyword: 'widget', organic: ids.map(competitor), ads: [], aiOverviewSources: [] };
        const extraction = extractSignals(resp, 'widget', SCORING_RUBRIC);
        const { count, domains } = countCompetitors(extraction, SCORING_RUBRIC);
        const classification = applyRubric(count, extraction.signalTypesPresent, SCORING_RUBRIC);
        const f = toWhiteSpaceFields(classification, domains, extraction.signalTypesPresent);
        expect(f.whiteSpaceSignals).toEqual(extraction.signalTypesPresent);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Edge (5.10): missing/unrecognized class maps to UNKNOWN', () => {
  it('returns UNKNOWN for undefined classification', () => {
    expect(toWhiteSpaceFields(undefined, [], []).whiteSpaceStatus).toBe('UNKNOWN');
  });
  it('returns UNKNOWN for an unrecognized class value', () => {
    const bogus = { opportunityClass: 'PURPLE', score: 0, reason: 'unknown' } as unknown as Classification;
    expect(toWhiteSpaceFields(bogus, [], []).whiteSpaceStatus).toBe('UNKNOWN');
  });
});
