/**
 * Property-based test for the local retrieval scorer.
 *
 * Task 3.4 — Property 4: Score bounds.
 * **Validates: Requirements 3.4**
 *
 * Property 4 (design "Correctness Properties"):
 *   For all queries and entries, 0 <= scoreEntry(query, entry) <= 1.
 *
 * Strategy: generate arbitrary query strings and arbitrary well-formed
 * HelpEntry objects (honoring the validation rule that symbols + aliases are
 * together non-empty), and assert the returned score is always a finite number
 * within the inclusive range [0, 1].
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { scoreEntry } from './helpRetrieval';
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

/**
 * Arbitrary, well-formed HelpEntry. Mirrors the KB validation rules: non-empty
 * id/title/body and a non-empty union of symbols + aliases so the entry is
 * reachable by search. `sourceDoc` is optional.
 */
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
  // Enforce the "symbols + aliases together non-empty" validation rule.
  .filter((e) => e.symbols.length > 0 || e.aliases.length > 0);

describe('scoreEntry — Property 4: score bounds (Requirements 3.4)', () => {
  it('returns a finite score within [0, 1] for any query and entry', () => {
    fc.assert(
      fc.property(fc.string(), helpEntryArb, (query, entry) => {
        const score = scoreEntry(query, entry);
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }),
    );
  });
});
