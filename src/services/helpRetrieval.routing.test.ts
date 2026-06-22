/**
 * Unit tests for `searchKnowledgeBase` routing boundaries.
 *
 * Task 3.10 — routing boundary behavior.
 * _Requirements: 1.2, 1.3, 1.4, 1.5_
 *
 * These tests drive the local scorer to land exactly at and around the two
 * routing thresholds and verify the TOP_K truncation:
 *   - LOCAL_CONFIDENCE (0.55): score >= threshold  -> mode 'local'
 *   - SUGGEST_FLOOR    (0.20): SUGGEST_FLOOR <= score < LOCAL_CONFIDENCE
 *                              -> mode 'suggestions'
 *   - below SUGGEST_FLOOR (but > 0)              -> mode 'needs-llm'
 *   - result.topMatches.length is capped at TOP_K
 *
 * Scores are produced deterministically through the token-coverage tier of
 * `scoreEntry` (coverage = overlapping query tokens / total query tokens), so
 * the exact boundary values can be hit with simple integer fractions.
 */

import { describe, it, expect } from 'vitest';

import { searchKnowledgeBase } from './helpRetrieval';
import type { HelpEntry } from './helpTypes';
import { LOCAL_CONFIDENCE, SUGGEST_FLOOR, TOP_K } from './helpTypes';

/** Distinct, non-stopword query tokens: "wtok0 wtok1 ...". */
function tokenWords(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `wtok${i}`);
}

/**
 * Build a well-formed entry. Defaults use a symbol that never appears in the
 * coverage queries below, so the strong-signal tiers (symbol/alias) never
 * short-circuit and scoring stays in the token-coverage tier.
 */
function makeEntry(overrides: Partial<HelpEntry>): HelpEntry {
  return {
    id: 'entry',
    category: 'concept',
    title: 'Generic Entry',
    symbols: ['zzunusedsym'],
    aliases: [],
    body: 'placeholder',
    ...overrides,
  };
}

/**
 * Construct a query and a single-entry KB whose token-coverage score is exactly
 * `overlap / total`. The entry's body contains the first `overlap` of the
 * `total` distinct query tokens.
 */
function coverageCase(
  total: number,
  overlap: number,
): { query: string; kb: HelpEntry[] } {
  const tokens = tokenWords(total);
  const query = tokens.join(' ');
  const body = tokens.slice(0, overlap).join(' ');
  return { query, kb: [makeEntry({ id: 'cov', body })] };
}

describe('searchKnowledgeBase — routing boundaries', () => {
  // --- LOCAL_CONFIDENCE boundary (Requirement 1.2) -------------------------

  it('routes to local when the best score is exactly LOCAL_CONFIDENCE', () => {
    // 11 / 20 === 0.55 === LOCAL_CONFIDENCE.
    const { query, kb } = coverageCase(20, 11);

    const result = searchKnowledgeBase(query, kb);

    expect(result.confidence).toBeCloseTo(LOCAL_CONFIDENCE, 10);
    expect(result.mode).toBe('local');
    expect(result.answer).toBe(kb[0].body);
    expect(result.answer).not.toBeNull();
  });

  it('routes to suggestions just below LOCAL_CONFIDENCE (Requirement 1.3)', () => {
    // 10 / 20 === 0.50, which is >= SUGGEST_FLOOR but < LOCAL_CONFIDENCE.
    const { query, kb } = coverageCase(20, 10);

    const result = searchKnowledgeBase(query, kb);

    expect(result.confidence).toBeCloseTo(0.5, 10);
    expect(result.confidence).toBeLessThan(LOCAL_CONFIDENCE);
    expect(result.mode).toBe('suggestions');
    expect(result.answer).toBeNull();
  });

  // --- SUGGEST_FLOOR boundary (Requirements 1.3, 1.4) ----------------------

  it('routes to suggestions when the best score is exactly SUGGEST_FLOOR', () => {
    // 1 / 5 === 0.20 === SUGGEST_FLOOR.
    const { query, kb } = coverageCase(5, 1);

    const result = searchKnowledgeBase(query, kb);

    expect(result.confidence).toBeCloseTo(SUGGEST_FLOOR, 10);
    expect(result.mode).toBe('suggestions');
    expect(result.answer).toBeNull();
    expect(result.topMatches).toHaveLength(1);
  });

  it('routes to needs-llm just below SUGGEST_FLOOR (Requirement 1.4)', () => {
    // 1 / 6 ≈ 0.1667, which is > 0 but < SUGGEST_FLOOR.
    const { query, kb } = coverageCase(6, 1);

    const result = searchKnowledgeBase(query, kb);

    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(SUGGEST_FLOOR);
    expect(result.mode).toBe('needs-llm');
    expect(result.answer).toBeNull();
  });

  it('routes to needs-llm when no entry matches the query at all', () => {
    const kb = [makeEntry({ id: 'unmatched', body: 'completely different words' })];

    const result = searchKnowledgeBase('wtok0 wtok1 wtok2', kb);

    expect(result.confidence).toBe(0);
    expect(result.mode).toBe('needs-llm');
    expect(result.answer).toBeNull();
    expect(result.topMatches).toHaveLength(0);
  });

  // --- Strong-signal tiers route to local ----------------------------------

  it('routes to local for an exact symbol match (score 1.0)', () => {
    const kb = [makeEntry({ id: 'sym', symbols: ['opportunityScore'], body: 'the ranking metric' })];

    const result = searchKnowledgeBase('what does opportunityScore mean', kb);

    expect(result.confidence).toBe(1);
    expect(result.mode).toBe('local');
    expect(result.answer).toBe(kb[0].body);
  });

  it('routes to local for an alias match (score >= 0.85)', () => {
    const kb = [makeEntry({ id: 'alias', symbols: ['zzunusedsym'], aliases: ['ranking number'], body: 'the ranking metric' })];

    const result = searchKnowledgeBase('explain the ranking number please', kb);

    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.mode).toBe('local');
    expect(result.answer).toBe(kb[0].body);
  });

  // --- TOP_K truncation (Requirement 1.5) ----------------------------------

  it('returns at most TOP_K candidates when more than TOP_K entries match', () => {
    // 7 entries all share the single query token "shared" -> all score 1.0.
    const kb = Array.from({ length: TOP_K + 3 }, (_, i) =>
      makeEntry({ id: `m${i}`, body: `shared body number ${i}` }),
    );

    const result = searchKnowledgeBase('shared', kb);

    expect(kb.length).toBeGreaterThan(TOP_K);
    expect(result.topMatches).toHaveLength(TOP_K);
  });

  it('keeps the highest-scoring entries in descending order after truncation', () => {
    // Query of 4 distinct tokens; entries cover 4,3,2,1,1,1 of them ->
    // scores 1.0, 0.75, 0.5, 0.25, 0.25, 0.25. Truncation must keep the top 4.
    const tokens = tokenWords(4);
    const query = tokens.join(' ');
    const kb: HelpEntry[] = [
      makeEntry({ id: 'c4', body: tokens.slice(0, 4).join(' ') }), // 1.0
      makeEntry({ id: 'c3', body: tokens.slice(0, 3).join(' ') }), // 0.75
      makeEntry({ id: 'c2', body: tokens.slice(0, 2).join(' ') }), // 0.5
      makeEntry({ id: 'c1a', body: tokens.slice(0, 1).join(' ') }), // 0.25
      makeEntry({ id: 'c1b', body: tokens.slice(0, 1).join(' ') }), // 0.25
      makeEntry({ id: 'c1c', body: tokens.slice(0, 1).join(' ') }), // 0.25
    ];

    const result = searchKnowledgeBase(query, kb);

    expect(result.topMatches).toHaveLength(TOP_K);
    // Scores are non-increasing.
    const scores = result.topMatches.map((m) => m.score);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
    // The two highest, distinct scores survive truncation.
    expect(scores[0]).toBeCloseTo(1.0, 10);
    expect(scores[1]).toBeCloseTo(0.75, 10);
    expect(result.confidence).toBeCloseTo(1.0, 10);
    expect(result.mode).toBe('local');
  });
});
