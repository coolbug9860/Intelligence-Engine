/**
 * Pure grounding helpers for the in-app Help / Search server fallback.
 *
 * Extracted from the `/api/help/explain` route so the resolution + source
 * projection logic is a single, side-effect-free source of truth shared by the
 * server and its tests. No I/O, no model calls, no mutation of the KB.
 */

import type { HelpEntry, HelpSource } from './helpTypes';

/**
 * Resolve client-supplied context ids against the knowledge base.
 *
 * - Ignores ids that are not strings.
 * - Ignores ids that do not match any KB entry (version skew / junk).
 * - De-duplicates: each KB entry is resolved at most once, preserving the
 *   order of first appearance in `contextIds`.
 * - Never mutates the knowledge base.
 */
export function resolveContextEntries(
  contextIds: readonly unknown[],
  kb: readonly HelpEntry[]
): HelpEntry[] {
  const seen = new Set<string>();
  const resolved: HelpEntry[] = [];
  for (const id of contextIds) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const entry = kb.find((e) => e.id === id);
    if (entry) {
      resolved.push(entry);
      seen.add(id);
    }
  }
  return resolved;
}

/** Project resolved KB entries into lightweight citation sources. */
export function toHelpSources(entries: readonly HelpEntry[]): HelpSource[] {
  return entries.map((e) => ({
    id: e.id,
    title: e.title,
    sourceDoc: e.sourceDoc,
  }));
}
