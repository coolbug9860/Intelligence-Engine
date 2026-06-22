/**
 * helpRetrieval.symbolDeterminism.property.test.ts (Task 3.5)
 *
 * Feature: in-app-help-search — property-based test for exact-symbol determinism.
 * Validates: Requirements 3.1
 *
 * Property 3: Exact-symbol determinism
 *   For all entries `e` and queries containing a symbol of `e` verbatim,
 *   `scoreEntry(query, e) === 1.0` (exact-symbol queries are always answered
 *   locally). The match is deterministic: the same query/entry always yields 1.0.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { scoreEntry } from './helpRetrieval';
import type { HelpEntry } from './helpTypes';
import { KNOWLEDGE_BASE } from '../data/helpKnowledgeBase';

/**
 * A symbol guaranteed to be non-empty after trimming, so `scoreEntry` does not
 * skip it. (`scoreEntry` ignores symbols that are empty/whitespace-only.)
 */
const nonEmptySymbol = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary surrounding text the user might type around the symbol. */
const surroundingText = fc.string({ maxLength: 40 });

describe('Property 3: Exact-symbol determinism (Req 3.1)', () => {
  it('scores 1.0 for any generated entry when the query contains its symbol verbatim', () => {
    fc.assert(
      fc.property(
        nonEmptySymbol,
        fc.array(fc.string(), { maxLength: 3 }), // extra symbols
        fc.array(fc.string(), { maxLength: 3 }), // aliases
        fc.string(), // title
        fc.string(), // body
        surroundingText,
        surroundingText,
        (symbol, extraSymbols, aliases, title, body, prefix, suffix) => {
          const entry: HelpEntry = {
            id: 'gen-entry',
            category: 'concept',
            title,
            symbols: [...extraSymbols, symbol],
            aliases,
            body,
          };

          // Query contains the symbol verbatim, surrounded by arbitrary text.
          const query = `${prefix}${symbol}${suffix}`;

          expect(scoreEntry(query, entry)).toBe(1.0);
        },
      ),
    );
  });

  it('scores 1.0 for real knowledge base entries when their symbol appears in the query', () => {
    // Constrain to entries that actually carry a usable (non-empty) symbol.
    const entriesWithSymbols = KNOWLEDGE_BASE.filter((e) =>
      e.symbols.some((s) => s.trim().length > 0),
    );
    expect(entriesWithSymbols.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...entriesWithSymbols),
        surroundingText,
        surroundingText,
        (entry, prefix, suffix) => {
          const symbol = entry.symbols.find((s) => s.trim().length > 0)!;
          const query = `${prefix}${symbol}${suffix}`;

          expect(scoreEntry(query, entry)).toBe(1.0);
        },
      ),
    );
  });

  it('is deterministic: the same symbol query yields 1.0 on repeated evaluation', () => {
    fc.assert(
      fc.property(nonEmptySymbol, surroundingText, (symbol, suffix) => {
        const entry: HelpEntry = {
          id: 'gen-entry',
          category: 'concept',
          title: 'title',
          symbols: [symbol],
          aliases: [],
          body: 'body',
        };
        const query = `${symbol}${suffix}`;

        const first = scoreEntry(query, entry);
        const second = scoreEntry(query, entry);
        expect(first).toBe(1.0);
        expect(second).toBe(first);
      }),
    );
  });
});
