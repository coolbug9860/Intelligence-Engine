/**
 * helpGrounding.groundingIntegrity.property.test.ts (Task 10.2)
 *
 * Feature: in-app-help-search — property-based test for grounding integrity.
 * **Validates: Requirements 8.3**
 *
 * Property 9: Grounding integrity
 *   For all fallback responses, every entry in `sources` corresponds to a real
 *   KB entry resolved from `contextIds` (no fabricated sources). The LLM is only
 *   ever grounded on resolved KB entries: unknown/stale ids are ignored,
 *   duplicates are de-duplicated, and the response `sources` map ONLY the
 *   resolved entries.
 *
 * This targets the pure resolution + source-projection logic that the
 * `/api/help/explain` route uses (`resolveContextEntries` + `toHelpSources` in
 * helpGrounding.ts), so the test stays deterministic — no server boot, no Gemini.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { resolveContextEntries, toHelpSources } from './helpGrounding';
import { KNOWLEDGE_BASE } from '../data/helpKnowledgeBase';

/** All real KB ids — the only ids that may ever resolve. */
const KB_IDS: string[] = KNOWLEDGE_BASE.map((e) => e.id);
const KB_ID_SET = new Set(KB_IDS);

/**
 * An id arbitrary that mixes valid KB ids with junk/unknown ids so the property
 * exercises the "ignore unknown" and "de-duplicate" branches. Junk ids are
 * filtered to guarantee they are NOT accidentally real KB ids.
 */
const idArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KB_IDS),
  fc.string().filter((s) => !KB_ID_SET.has(s)),
);

const contextIdsArb: fc.Arbitrary<string[]> = fc.array(idArb, { maxLength: 30 });

describe('Property 9: Grounding integrity (Requirements 8.3)', () => {
  it('resolves to exactly the unique valid KB entries, order-preserved, no unknowns', () => {
    fc.assert(
      fc.property(contextIdsArb, (contextIds) => {
        const resolved = resolveContextEntries(contextIds, KNOWLEDGE_BASE);

        // Expected: first-appearance order of ids that are real KB ids, de-duped.
        const expectedIds: string[] = [];
        const seen = new Set<string>();
        for (const id of contextIds) {
          if (KB_ID_SET.has(id) && !seen.has(id)) {
            expectedIds.push(id);
            seen.add(id);
          }
        }

        const resolvedIds = resolved.map((e) => e.id);
        // No unknowns leaked in, no duplicates, order preserved.
        expect(resolvedIds).toEqual(expectedIds);
        // Every resolved entry is the actual KB object (a real entry).
        for (const entry of resolved) {
          expect(KNOWLEDGE_BASE).toContain(entry);
        }
      }),
    );
  });

  it('derives sources that contain ONLY ids present in KNOWLEDGE_BASE (no fabrication)', () => {
    fc.assert(
      fc.property(contextIdsArb, (contextIds) => {
        const resolved = resolveContextEntries(contextIds, KNOWLEDGE_BASE);
        const sources = toHelpSources(resolved);

        // sources map one-to-one onto resolved entries.
        expect(sources.map((s) => s.id)).toEqual(resolved.map((e) => e.id));

        for (const src of sources) {
          // Every source id is a real KB id and its title matches the KB entry.
          expect(KB_ID_SET.has(src.id)).toBe(true);
          const kbEntry = KNOWLEDGE_BASE.find((e) => e.id === src.id);
          expect(kbEntry).toBeDefined();
          expect(src.title).toBe(kbEntry!.title);
          expect(src.sourceDoc).toBe(kbEntry!.sourceDoc);
        }
      }),
    );
  });

  it('ignores arrays of purely unknown ids (empty resolution, empty sources)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string().filter((s) => !KB_ID_SET.has(s)), { maxLength: 20 }),
        (junkIds) => {
          const resolved = resolveContextEntries(junkIds, KNOWLEDGE_BASE);
          expect(resolved).toEqual([]);
          expect(toHelpSources(resolved)).toEqual([]);
        },
      ),
    );
  });
});
