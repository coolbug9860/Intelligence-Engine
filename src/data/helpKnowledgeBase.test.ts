/**
 * helpKnowledgeBase.test.ts (Task 2.2)
 *
 * Feature: in-app-help-search — knowledge base integrity.
 * Validates: Requirements 12.1, 12.2, 12.3
 *
 * Asserts the static KB is well-formed so every entry is reachable by search and
 * safe to use as grounding context:
 *  - 12.1 each `id` is unique and non-empty
 *  - 12.2 each `title` and `body` is non-empty
 *  - 12.3 each entry has at least one `symbol` or one `alias`
 */

import { describe, it, expect } from 'vitest';
import { KNOWLEDGE_BASE } from './helpKnowledgeBase';

const isNonEmpty = (s: string): boolean => s.trim().length > 0;

describe('KNOWLEDGE_BASE integrity', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(KNOWLEDGE_BASE)).toBe(true);
    expect(KNOWLEDGE_BASE.length).toBeGreaterThan(0);
  });

  // Requirement 12.1 — unique, non-empty ids
  it('assigns every entry a non-empty id', () => {
    const offenders = KNOWLEDGE_BASE.filter((e) => typeof e.id !== 'string' || !isNonEmpty(e.id));
    expect(offenders).toEqual([]);
  });

  it('assigns every entry a unique id', () => {
    const ids = KNOWLEDGE_BASE.map((e) => e.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect([...new Set(duplicates)]).toEqual([]);
    expect(new Set(ids).size).toBe(KNOWLEDGE_BASE.length);
  });

  // Requirement 12.2 — non-empty title and body
  it('gives every entry a non-empty title', () => {
    const offenders = KNOWLEDGE_BASE.filter((e) => !isNonEmpty(e.title)).map((e) => e.id);
    expect(offenders).toEqual([]);
  });

  it('gives every entry a non-empty body', () => {
    const offenders = KNOWLEDGE_BASE.filter((e) => !isNonEmpty(e.body)).map((e) => e.id);
    expect(offenders).toEqual([]);
  });

  // Requirement 12.3 — at least one symbol or alias, each non-empty
  it('gives every entry at least one non-empty symbol or alias', () => {
    const offenders = KNOWLEDGE_BASE.filter((e) => {
      const tokens = [...e.symbols, ...e.aliases].filter(isNonEmpty);
      return tokens.length === 0;
    }).map((e) => e.id);
    expect(offenders).toEqual([]);
  });
});
