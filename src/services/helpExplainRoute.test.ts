/**
 * Unit tests for the `POST /api/help/explain` fallback route in `server.ts`.
 *
 * Strategy: the route lives behind the existing auth middleware + aiLimiter and
 * delegates synthesis to `geminiService.askKnowledgeBase`. `server.ts` exports
 * `app` and only calls `app.listen` when NODE_ENV !== "test", so we can import it
 * safely, mount it on an ephemeral port, and drive the *real* handler over HTTP.
 *
 * Determinism: `askKnowledgeBase` is mocked (resolve for happy path, reject for
 * the 502 path) so no Gemini key / network is touched. The auth token is pinned
 * via KAISO_AUTH_TOKEN before the module is imported.
 *
 * Covers Requirements 9.3 (400 on empty query), 9.6 (400 when no contextIds
 * resolve), 10.1 (502 on Gemini failure), and the happy-path response shape.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Express } from 'express';

// Mock the Gemini service before `server.ts` (which imports it) is loaded.
// `server.ts` imports "./src/services/geminiService"; this test sits in
// src/services, so "./geminiService" resolves to the same absolute module.
const { askKnowledgeBaseMock } = vi.hoisted(() => ({
  askKnowledgeBaseMock: vi.fn(),
}));

vi.mock('./geminiService', () => ({
  askKnowledgeBase: askKnowledgeBaseMock,
  // server.ts also imports generateFullBrief; it is never exercised here.
  generateFullBrief: vi.fn(),
}));

const TOKEN = 'test-token';
const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

let server: Server;
let baseUrl: string;

async function postExplain(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/help/explain`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  // Must be set BEFORE server.ts is evaluated: it reads these at module load.
  process.env.NODE_ENV = 'test';
  process.env.KAISO_AUTH_TOKEN = TOKEN;

  const mod = await import('../../server');
  const app = mod.app as Express;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  askKnowledgeBaseMock.mockReset();
});

describe('POST /api/help/explain', () => {
  it('returns 400 when the query is empty or whitespace-only (Req 9.3)', async () => {
    const res = await postExplain({ query: '   ', contextIds: ['metric-opportunity-score'] });

    expect(res.status).toBe(400);
    expect(askKnowledgeBaseMock).not.toHaveBeenCalled();
  });

  it('returns 400 when none of the supplied contextIds resolve (Req 9.6)', async () => {
    const res = await postExplain({
      query: 'what is the ranking number',
      contextIds: ['does-not-exist', 'also-bogus'],
    });

    expect(res.status).toBe(400);
    expect(askKnowledgeBaseMock).not.toHaveBeenCalled();
  });

  it('returns 502 when the Gemini synthesis fails (Req 10.1)', async () => {
    askKnowledgeBaseMock.mockRejectedValueOnce(new Error('quota exhausted'));

    const res = await postExplain({
      query: 'explain opportunityScore',
      contextIds: ['metric-opportunity-score'],
    });

    expect(res.status).toBe(502);
    expect(askKnowledgeBaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns { answer, sources, mode:"llm" } on the happy path with sources reflecting only resolved entries', async () => {
    askKnowledgeBaseMock.mockResolvedValueOnce('opportunityScore is the 0–100 ranking number.');

    const res = await postExplain({
      // one valid id + one bogus id: bogus must be dropped from sources.
      query: 'explain opportunityScore',
      contextIds: ['metric-opportunity-score', 'ghost-id', 'metric-commercial-core'],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      answer: string;
      sources: Array<{ id: string; title: string }>;
      mode: string;
    };

    expect(body.mode).toBe('llm');
    expect(body.answer).toBe('opportunityScore is the 0–100 ranking number.');

    // Sources reflect ONLY the resolved entries, in order, with no fabricated ids.
    expect(body.sources.map((s) => s.id)).toEqual([
      'metric-opportunity-score',
      'metric-commercial-core',
    ]);
    for (const s of body.sources) {
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
    }

    // The mock was grounded with exactly the resolved entries (query + 2 entries).
    expect(askKnowledgeBaseMock).toHaveBeenCalledTimes(1);
    const [, contextArg] = askKnowledgeBaseMock.mock.calls[0] as [string, Array<{ id: string }>];
    expect(contextArg.map((e) => e.id)).toEqual([
      'metric-opportunity-score',
      'metric-commercial-core',
    ]);
  });
});
