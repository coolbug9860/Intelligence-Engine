/**
 * helpRetrieval.normalize.test.ts (Task 3.2)
 *
 * Feature: in-app-help-search — unit tests for the pure `normalize` tokenizer.
 * Validates: Requirements 2.1, 2.3
 *
 * `normalize` lowercases, strips punctuation to token boundaries, removes
 * stopwords, and returns [] for empty/whitespace input. These tests lock those
 * four behaviors with concrete examples.
 */

import { describe, it, expect } from 'vitest';
import { normalize } from './helpRetrieval';

describe('normalize', () => {
  describe('punctuation stripping (Req 2.1)', () => {
    it('treats punctuation as a token boundary', () => {
      // "pass?" -> "pass"; commas/periods separate without merging tokens.
      expect(normalize('signal, growth. pass?')).toEqual([
        'signal',
        'growth',
        'pass',
      ]);
    });

    it('collapses runs of symbols into a single boundary', () => {
      expect(normalize('alpha---beta!!!gamma')).toEqual([
        'alpha',
        'beta',
        'gamma',
      ]);
    });

    it('keeps alphanumerics including digits', () => {
      expect(normalize('Q4 revenue $100M')).toEqual(['q4', 'revenue', '100m']);
    });

    it('drops a token made entirely of punctuation', () => {
      expect(normalize('--- !!! ???')).toEqual([]);
    });
  });

  describe('case normalization (Req 2.1)', () => {
    it('lowercases all tokens', () => {
      expect(normalize('GROWTH Signal Momentum')).toEqual([
        'growth',
        'signal',
        'momentum',
      ]);
    });

    it('produces identical output regardless of input casing', () => {
      expect(normalize('Healthcare VERTICAL')).toEqual(
        normalize('healthcare vertical'),
      );
    });
  });

  describe('stopword removal (Req 2.1)', () => {
    it('removes common stopwords and question filler', () => {
      // "what", "does", "the", "mean" are stopwords; "growth signal" remains.
      expect(normalize('What does the growth signal mean?')).toEqual([
        'growth',
        'signal',
      ]);
    });

    it('returns [] when every token is a stopword', () => {
      expect(normalize('what is the')).toEqual([]);
    });
  });

  describe('empty / whitespace input (Req 2.3)', () => {
    it('returns [] for an empty string', () => {
      expect(normalize('')).toEqual([]);
    });

    it('returns [] for whitespace-only input', () => {
      expect(normalize('   \t\n  ')).toEqual([]);
    });
  });

  describe('purity (Req 2.1)', () => {
    it('returns equal results for equal inputs', () => {
      expect(normalize('Momentum & Risk')).toEqual(normalize('Momentum & Risk'));
    });
  });
});
