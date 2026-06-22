/**
 * Property-based test for the local retrieval router's candidate cap.
 *
 * Task 3.8 — Property 6: TopK bound.
 * **Validates: Requirements 1.5**
 *
 * Property 6 (design "Correctness Properties"):
 *   For all queries, searchKnowledgeBase(query, kb).topMatches.length <= TOP_K.
 *
 * Strategy: exercise searchKnowledgeBase against knowledge bases that are
 * deliberately larger than TOP_K (so truncation is actually triggered), using
 * both the real KNOWLEDGE_BASE and randomly generated well-formed entry arrays.
 * Generators bias toward queries that match many entries (e.g. shared tokens
 * and real symbols) to maximise the number of positive-scoring candidates, then
 * assert the returned candidate list never exceeds TOP_K.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { searchKnowledgeBase } from './helpRetrieval';
import { TOP_K } from './helpTypes';
import type { HelpCategory, HelpEntry } from './helpTypes';
import { KNOWLEDGE_BASE } from '../data/helpKnowledgeBase';

const HELP_CATEGORIES: HelpCategory[] = [
  'metric',
  'section',
  'verdict',
  'pillar',
  'vertical',
  'pipeline-stage',
  'concept',
];

/**
 * Arbitrary, well-formed HelpEntry honoring the KB validation rule that
 * symbols + aliases together are non-empty. Token vocabulary is intentionally
 * small so generated entries frequently share tokens with generated queries,
 * producing many positive-scoring candidates that force TOP_K truncation.
 */
const wordArb = fc.constantFrom(
  'score', 'verdict', 'pillar', 'vertical', 'gate', 'risk', 'trend',
  'whitespace', 'evidence', 'signal', 'commercial', 'market', 'publish',
);

const helpEntryArb: fc.Arbitrary<HelpEntry> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    category: fc.constantFrom(...HELP_CATEGORIES),
    title: fc.string({ minLength: 1 }),
    symbols: fc.array(wordArb),
    aliases: fc.array(wordArb),
    body: fc
      .array(wordArb, { minLength: 1 })
      .map((tokens) => tokens.join(' ')),
    sourceDoc: fc.option(fc.string(), { nil: undefined }),
  })
  .filter((e) => e.symbols.length > 0 || e.aliases.length > 0);

/** Knowledge bases larger than TOP_K so the cap is genuinely exercised. */
const largeKbArb: fc.Arbitrary<HelpEntry[]> = fc.array(helpEntryArb, {
  minLength: TOP_K + 1,
  maxLength: TOP_K + 20,
});

/** Queries biased toward the shared vocabulary so many entries match. */
const matchyQueryArb: fc.Arbitrary<string> = fc
  .array(wordArb, { minLength: 0, maxLength: 6 })
  .map((tokens) => tokens.join(' '));

describe('searchKnowledgeBase — Property 6: TopK bound (Requirements 1.5)', () => {
  it('never returns more than TOP_K candidates for generated large KBs', () => {
    fc.assert(
      fc.property(matchyQueryArb, largeKbArb, (query, kb) => {
        const result = searchKnowledgeBase(query, kb);
        expect(result.topMatches.length).toBeLessThanOrEqual(TOP_K);
      }),
    );
  });

  it('never returns more than TOP_K candidates for arbitrary string queries', () => {
    fc.assert(
      fc.property(fc.string(), largeKbArb, (query, kb) => {
        const result = searchKnowledgeBase(query, kb);
        expect(result.topMatches.length).toBeLessThanOrEqual(TOP_K);
      }),
    );
  });

  it('never exceeds TOP_K against the real KNOWLEDGE_BASE', () => {
    // The curated KB has far more than TOP_K entries, so high-overlap queries
    // would surface many candidates without the cap.
    expect(KNOWLEDGE_BASE.length).toBeGreaterThan(TOP_K);
    fc.assert(
      fc.property(matchyQueryArb, (query) => {
        const result = searchKnowledgeBase(query, KNOWLEDGE_BASE);
        expect(result.topMatches.length).toBeLessThanOrEqual(TOP_K);
      }),
    );
  });
});
