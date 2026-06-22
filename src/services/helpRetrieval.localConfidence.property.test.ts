/**
 * Property-based test for local-confidence soundness of the retrieval router.
 *
 * Task 3.7 — Property 2: Local-confidence soundness.
 * **Validates: Requirements 1.2**
 *
 * Property 2 (design "Correctness Properties"):
 *   For all queries, mode === 'local' => answer !== null AND
 *   confidence >= LOCAL_CONFIDENCE.
 *
 * Strategy: drive `searchKnowledgeBase` with three families of input so the
 * `local` branch is actually exercised, then assert the implication holds:
 *   1. Arbitrary free-text queries against the real KNOWLEDGE_BASE.
 *   2. Symbol/alias/title-seeded queries against the real KNOWLEDGE_BASE
 *      (these reliably clear LOCAL_CONFIDENCE, so `local` is hit often).
 *   3. Arbitrary queries against generated well-formed KB arrays.
 * In every case, whenever the router returns `local`, its answer must be
 * non-null and its confidence at least LOCAL_CONFIDENCE.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { searchKnowledgeBase } from './helpRetrieval';
import { KNOWLEDGE_BASE } from '../data/helpKnowledgeBase';
import { LOCAL_CONFIDENCE } from './helpTypes';
import type { HelpCategory, HelpEntry } from './helpTypes';

const HELP_CATEGORIES: HelpCategory[] = [
  'metric',
  'section',
  'verdict',
  'pillar',
  'vertical',
  'pipeline-stage',
  'concept',
];

/** Well-formed HelpEntry arbitrary (symbols + aliases together non-empty). */
const helpEntryArb: fc.Arbitrary<HelpEntry> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    category: fc.constantFrom(...HELP_CATEGORIES),
    title: fc.string({ minLength: 1 }),
    symbols: fc.array(fc.string()),
    aliases: fc.array(fc.string()),
    body: fc.string({ minLength: 1 }),
    sourceDoc: fc.option(fc.string(), { nil: undefined }),
  })
  .filter((e) => e.symbols.length > 0 || e.aliases.length > 0);

/** Words drawn from a real KB entry to seed queries that likely hit `local`. */
const seedTokens: string[] = KNOWLEDGE_BASE.flatMap((e) => [
  ...e.symbols,
  ...e.aliases,
  e.title,
]).filter((t) => t.trim().length > 0);

/** The Property 2 implication, checked on a single result. */
function assertLocalSoundness(result: ReturnType<typeof searchKnowledgeBase>): void {
  if (result.mode === 'local') {
    expect(result.answer).not.toBeNull();
    expect(result.confidence).toBeGreaterThanOrEqual(LOCAL_CONFIDENCE);
  }
}

describe('searchKnowledgeBase — Property 2: local-confidence soundness (Requirements 1.2)', () => {
  it('local mode implies non-null answer and confidence >= LOCAL_CONFIDENCE (arbitrary queries, real KB)', () => {
    fc.assert(
      fc.property(fc.string(), (query) => {
        assertLocalSoundness(searchKnowledgeBase(query, KNOWLEDGE_BASE));
      }),
    );
  });

  it('holds for symbol/alias/title-seeded queries that exercise the local branch', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...seedTokens),
        fc.string(),
        (seed, suffix) => {
          const result = searchKnowledgeBase(`${seed} ${suffix}`, KNOWLEDGE_BASE);
          assertLocalSoundness(result);
        },
      ),
    );
  });

  it('holds for arbitrary queries against generated knowledge bases', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.array(helpEntryArb, { minLength: 1, maxLength: 12 }),
        (query, kb) => {
          assertLocalSoundness(searchKnowledgeBase(query, kb));
        },
      ),
    );
  });
});
