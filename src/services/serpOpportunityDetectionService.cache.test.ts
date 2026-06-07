/**
 * serpOpportunityDetectionService.cache.test.ts (Task 7.4*)
 *
 * Integration coverage for FileResultCache: flush() writes JSON to the cache
 * path and a fresh instance reloads it; stale entries (age > Refresh_Window)
 * read as misses; a missing file reads as an empty cache.
 *
 * Requirements: 8.5 (plus 8.1, 8.4 behavior)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileResultCache, type CachedClassification } from './serpOpportunityDetectionService';

const tmpPath = join(tmpdir(), `serp-cache-test-${process.pid}-${Date.now()}.json`);

const entry = (keyword: string, timestamp: number): CachedClassification => ({
  keyword,
  classification: { opportunityClass: 'GREEN', score: 85, reason: 'gap' },
  domains: [],
  signals: ['ORGANIC'],
  timestamp,
});

afterEach(() => {
  if (existsSync(tmpPath)) rmSync(tmpPath);
});

describe('FileResultCache persistence', () => {
  it('flushes to disk and a fresh instance reloads the entry', async () => {
    const now = Date.now();
    const cache = new FileResultCache(tmpPath);
    cache.set('widget', entry('widget', now), now);
    await cache.flush();

    expect(existsSync(tmpPath)).toBe(true);

    const reloaded = new FileResultCache(tmpPath);
    const hit = reloaded.get('widget', now, 7 * 24 * 60 * 60 * 1000);
    expect(hit).not.toBeNull();
    expect(hit?.keyword).toBe('widget');
    expect(hit?.classification.opportunityClass).toBe('GREEN');
  });

  it('treats an entry older than the refresh window as a miss', () => {
    const now = Date.now();
    const cache = new FileResultCache(tmpPath);
    cache.set('widget', entry('widget', now - 10_000), now - 10_000);
    // Refresh window of 1s → the 10s-old entry is stale.
    expect(cache.get('widget', now, 1_000)).toBeNull();
  });

  it('treats a missing cache file as an empty cache', () => {
    const cache = new FileResultCache(join(tmpdir(), `does-not-exist-${Date.now()}.json`));
    expect(cache.get('anything', Date.now(), 1_000)).toBeNull();
  });
});
