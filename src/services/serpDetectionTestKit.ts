/**
 * serpDetectionTestKit.ts
 *
 * Shared test doubles for the orchestration property/unit tests: a configurable
 * MockSerpProvider with a call counter, an in-memory ResultCache, a no-network/
 * no-fs default deps builder, and small SerpResponse/ReportSuggestion builders.
 * Not a test suite itself (no `.test.ts` suffix), so vitest does not run it.
 */

import {
  SCORING_RUBRIC,
  type SerpProvider,
  type SerpResponse,
  type SerpOrganicResult,
  type ResultCache,
  type CachedClassification,
  type DetectionDeps,
} from './serpOpportunityDetectionService';
import type { ReportSuggestion } from '../types';

export class MockSerpProvider implements SerpProvider {
  public calls: string[] = [];
  constructor(
    private readonly configured: boolean = true,
    private readonly behavior: (keyword: string) => SerpResponse | Error = () => emptyResponse(''),
  ) {}
  isConfigured(): boolean {
    return this.configured;
  }
  async search(keyword: string): Promise<SerpResponse> {
    this.calls.push(keyword);
    const r = this.behavior(keyword);
    if (r instanceof Error) throw r;
    return { ...r, keyword };
  }
}

export class InMemoryCache implements ResultCache {
  public store = new Map<string, CachedClassification>();
  public flushed = 0;
  get(key: string, now: number, refreshWindowMs: number): CachedClassification | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (now - e.timestamp > refreshWindowMs) return null;
    return e;
  }
  set(key: string, value: CachedClassification, now: number): void {
    this.store.set(key, { ...value, timestamp: now });
  }
  async flush(): Promise<void> {
    this.flushed++;
  }
}

export const emptyResponse = (keyword: string): SerpResponse => ({
  keyword,
  organic: [],
  ads: [],
  aiOverviewSources: [],
});

export const competitorResult = (domain: string): SerpOrganicResult => ({
  title: 'Widget Market Size Report',
  link: `https://${domain}/industry-report/widgets`,
  domain,
});

export const responseWithCompetitors = (keyword: string, domains: string[]): SerpResponse => ({
  keyword,
  organic: domains.map(competitorResult),
  ads: [],
  aiOverviewSources: [],
});

export const makeSuggestion = (
  id: string,
  marketKeyword: string,
  reportTitle = 'Some Report Title',
): ReportSuggestion => ({
  id,
  vertical: 'Healthcare',
  reportTitle,
  marketKeyword,
  thematicCluster: 'Test Cluster',
});

export function testDeps(over: Partial<DetectionDeps> = {}): Partial<DetectionDeps> {
  return {
    provider: over.provider ?? new MockSerpProvider(true),
    cache: over.cache ?? new InMemoryCache(),
    rubric: over.rubric ?? SCORING_RUBRIC,
    runControl: over.runControl ?? { runBudget: 100, interCallDelayMs: 0, refreshWindowMs: 7 * 24 * 60 * 60 * 1000 },
    now: over.now ?? (() => 1_000_000),
    sleep: over.sleep ?? (async () => {}),
  };
}
