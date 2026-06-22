/**
 * helpRetrieval.purity.property.test.ts (Task 3.9)
 *
 * Feature: in-app-help-search — property-based test for purity.
 * **Validates: Requirements 3.5**
 *
 * Property 5: Purity
 *   For all inputs, `searchKnowledgeBase` (and `scoreEntry`) do not mutate the
 *   knowledge base and return equal results for equal inputs (referential
 *   transparency).
 *
 * Strategy: generate arbitrary query strings and arbitrary well-formed KB
 * arrays. Deep-snapshot the kb (and each entry) before the call, invoke the
 * function, and assert (a) the kb array/entries are deep-equal to the snapshot
 * (no mutation) and (b) calling again with the same inputs yields a deep-equal
 * result (determinism / referential transparency).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { searchKnowledgeBase, scoreEntry } from './helpRetrieval';
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
 * Arbitrary, well-formed HelpEntry mirroring the KB validation rules: non-empty
 * id/title/body and a non-empty union of symbols + aliases. `sourceDoc` is
 * optional.
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
  .filter((e) => e.symbols.length > 0 || e.aliases.length > 0);

/** A non-empty knowledge base array of well-formed entries. */
const kbArb: fc.Arbitrary<HelpEntry[]> = fc.array(helpEntryArb, {
  minLength: 1,
  maxLength: 12,
});

/** Structural deep clone for before/after comparison (no shared references). */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Property 5: Purity (Requirements 3.5)', () => {
  it('searchKnowledgeBase does not mutate the kb array or its entries', () => {
    fc.assert(
      fc.property(fc.string(), kbArb, (query, kb) => {
        const before = deepClone(kb);
        searchKnowledgeBase(query, kb);
        // The kb array and every entry are unchanged after the call.
        expect(kb).toEqual(before);
      }),
    );
  });

  it('searchKnowledgeBase returns equal results for equal inputs (referential transparency)', () => {
    fc.assert(
      fc.property(fc.string(), kbArb, (query, kb) => {
        const first = searchKnowledgeBase(query, deepClone(kb));
        const second = searchKnowledgeBase(query, deepClone(kb));
        expect(first).toEqual(second);
      }),
    );
  });

  it('scoreEntry does not mutate the entry and is deterministic for equal inputs', () => {
    fc.assert(
      fc.property(fc.string(), helpEntryArb, (query, entry) => {
        const before = deepClone(entry);
        const first = scoreEntry(query, entry);
        const second = scoreEntry(query, entry);
        // No mutation of the entry and equal scores for equal inputs.
        expect(entry).toEqual(before);
        expect(first).toBe(second);
      }),
    );
  });

  it('searchKnowledgeBase leaves the real KNOWLEDGE_BASE unmodified across queries', () => {
    const before = deepClone(KNOWLEDGE_BASE);
    fc.assert(
      fc.property(fc.string(), (query) => {
        searchKnowledgeBase(query, KNOWLEDGE_BASE);
      }),
    );
    expect(KNOWLEDGE_BASE).toEqual(before);
  });
});
