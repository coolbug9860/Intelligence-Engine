/**
 * titleCoherenceEngine.test.ts
 *
 * Deterministic guard that enforces title quality regardless of model compliance.
 * Covers the two live failure modes observed in production:
 *   - "Global Canadian …" / "Global India …" (double geography)
 *   - "… Investment Sentiment Market" / "… Policy Market" (event-as-subject)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  normalizeGeography,
  isEventSubject,
  applyTitleCoherence,
  EVENT_SUBJECT_SCORE_CAP,
} from './titleCoherenceEngine';
import type { ReportSuggestion } from '../types';

function suggestion(overrides: Partial<ReportSuggestion> = {}): ReportSuggestion {
  return {
    reportTitle: 'Global AI Data Center Cooling Solutions Market Size, Share & Forecast, 2026-2035',
    marketKeyword: 'global ai data center cooling solutions market',
    opportunityScore: 80,
    ...overrides,
  } as unknown as ReportSuggestion;
}

describe('normalizeGeography — geography-once enforcement', () => {
  it('should drop "Global" and convert a leading nationality adjective to a country noun', () => {
    expect(
      normalizeGeography('Global Canadian Bank Lending Policy Market Size, Share & Forecast, 2026-2035')
    ).toBe('Canada Bank Lending Policy Market Size, Share & Forecast, 2026-2035');
  });

  it('should drop "Global" when the subject already names a country noun', () => {
    expect(
      normalizeGeography('Global India Medical Equipment Direct Import Policy Market Size, Share & Forecast, 2026-2035')
    ).toBe('India Medical Equipment Direct Import Policy Market Size, Share & Forecast, 2026-2035');
  });

  it('should leave a legitimately Global title untouched (no second geography)', () => {
    const t = 'Global AI Data Center Cooling Solutions Market Size, Share & Forecast, 2026-2035';
    expect(normalizeGeography(t)).toBe(t);
  });

  it('should not touch a title that does not lead with Global', () => {
    const t = 'India Semiconductor for Defense Applications Market Size, Share & Forecast, 2026-2035';
    expect(normalizeGeography(t)).toBe(t);
  });

  it('should lowercase the result for marketKeyword form', () => {
    expect(
      normalizeGeography('global canadian bank lending policy market', true)
    ).toBe('canada bank lending policy market');
  });

  it('should handle a region token (drops Global, keeps region)', () => {
    expect(
      normalizeGeography('Global North America Grid Storage Market Size, Share & Forecast, 2026-2035')
    ).toBe('North America Grid Storage Market Size, Share & Forecast, 2026-2035');
  });
});

describe('isEventSubject — non-market subject detection', () => {
  it.each([
    'Global Cross-Sector Investment Sentiment Market Size, Share & Forecast, 2026-2035',
    'Global Consumer Product Inflation Easing Market Size, Share & Forecast, 2026-2035',
    'Global Reformation (Apparel Retailer) IPO Market Size, Share & Forecast, 2026-2035',
    'Canada Bank Lending Policy Market Size, Share & Forecast, 2026-2035',
    'Global Biotech M&A in Inflammatory Disease Market Size, Share & Forecast, 2026-2035',
  ])('should flag event/policy/macro subject: %s', (title) => {
    expect(isEventSubject(title)).toBe(true);
  });

  it.each([
    'Global AI Data Center Cooling Solutions Market Size, Share & Forecast, 2026-2035',
    'India Medical Equipment Market Size, Share & Forecast, 2026-2035',
    'Global Solid-State EV Battery Market Size, Share & Forecast, 2026-2035',
  ])('should NOT flag a genuine product/technology market: %s', (title) => {
    expect(isEventSubject(title)).toBe(false);
  });
});

describe('applyTitleCoherence — combined guard', () => {
  it('should fix geography and cap an event-subject title in one pass', () => {
    const result = applyTitleCoherence(suggestion({
      reportTitle: 'Global Canadian Bank Lending Policy Market Size, Share & Forecast, 2026-2035',
      marketKeyword: 'global canadian bank lending policy market',
      opportunityScore: 78,
    }));

    expect(result.reportTitle).toBe('Canada Bank Lending Policy Market Size, Share & Forecast, 2026-2035');
    expect(result.marketKeyword).toBe('canada bank lending policy market');
    expect(result.opportunityScore).toBe(EVENT_SUBJECT_SCORE_CAP); // capped from 78
  });

  it('should leave a clean product-market opportunity fully intact', () => {
    const input = suggestion({ opportunityScore: 82 });
    const result = applyTitleCoherence(input);

    expect(result.reportTitle).toBe(input.reportTitle);
    expect(result.marketKeyword).toBe(input.marketKeyword);
    expect(result.opportunityScore).toBe(82);
  });

  it('should not raise the score of an event-subject item already below the cap', () => {
    const result = applyTitleCoherence(suggestion({
      reportTitle: 'Global Investment Sentiment Market Size, Share & Forecast, 2026-2035',
      opportunityScore: 12,
    }));
    expect(result.opportunityScore).toBe(12); // min(12, 40) — never inflate
  });

  it('should fix geography even when the subject is a clean market (no cap)', () => {
    const result = applyTitleCoherence(suggestion({
      reportTitle: 'Global India Semiconductor Fabrication Market Size, Share & Forecast, 2026-2035',
      marketKeyword: 'global india semiconductor fabrication market',
      opportunityScore: 75,
    }));
    expect(result.reportTitle).toBe('India Semiconductor Fabrication Market Size, Share & Forecast, 2026-2035');
    expect(result.marketKeyword).toBe('india semiconductor fabrication market');
    expect(result.opportunityScore).toBe(75); // not an event subject → unchanged
  });
});

describe('Property: geography-once invariant', () => {
  it('should never leave a title that both leads with "Global" and names a country', () => {
    const countries = ['Canadian', 'India', 'Chinese', 'German', 'North America', 'Japan'];
    fc.assert(
      fc.property(
        fc.constantFrom(...countries),
        fc.constantFrom('Semiconductor', 'Medical Equipment', 'Grid Storage'),
        (geo, subject) => {
          const out = normalizeGeography(`Global ${geo} ${subject} Market Size, Share & Forecast, 2026-2035`);
          expect(/^global\b/i.test(out)).toBe(false);
        }
      )
    );
  });

  it('should never increase opportunityScore', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (score) => {
        const out = applyTitleCoherence(suggestion({
          reportTitle: 'Global Investment Sentiment Market Size, Share & Forecast, 2026-2035',
          opportunityScore: score,
        }));
        expect(out.opportunityScore as number).toBeLessThanOrEqual(score);
      })
    );
  });
});
