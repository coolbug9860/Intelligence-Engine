/**
 * serpOpportunityDetectionService.provider.test.ts (Task 7.2*)
 *
 * Unit coverage for the GoogleCseProvider: `isConfigured()` reflects the
 * credentials, `search` is invoked with the keyword and maps the vendor payload
 * into a SerpResponse, and HTTP failures surface as SerpProviderError.
 *
 * Requirements: 1.2, 1.3, 7.2
 */

import { describe, it, expect } from 'vitest';
import {
  GoogleCseProvider,
  normalizeGoogleCse,
  SerpProviderError,
} from './serpOpportunityDetectionService';

const SAMPLE_PAYLOAD = {
  items: [
    {
      title: 'Global Widget Market Size Report 2030',
      link: 'https://grandviewresearch.com/industry-report/widget',
      displayLink: 'grandviewresearch.com',
      snippet: 'The widget market is...',
      pagemap: { product: [{ name: 'Widget Report' }] },
    },
    {
      title: 'Widget blog post',
      link: 'https://example.com/blog/widget',
      displayLink: 'example.com',
      snippet: 'opinions',
    },
  ],
};

const okFetch = (capture: { url?: string }) => (url: string) => {
  capture.url = url;
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_PAYLOAD) });
};

describe('GoogleCseProvider.isConfigured', () => {
  it('is false when either credential is absent, true when both present', () => {
    expect(new GoogleCseProvider('', '').isConfigured()).toBe(false);
    expect(new GoogleCseProvider('key', '').isConfigured()).toBe(false);
    expect(new GoogleCseProvider('', 'cx').isConfigured()).toBe(false);
    expect(new GoogleCseProvider('key', 'cx').isConfigured()).toBe(true);
  });
});

describe('GoogleCseProvider.search', () => {
  it('calls the endpoint with the keyword and normalizes the payload', async () => {
    const capture: { url?: string } = {};
    const provider = new GoogleCseProvider('key', 'cx', okFetch(capture));
    const res = await provider.search('widget market');

    expect(capture.url).toContain('q=widget%20market');
    expect(capture.url).toContain('cx=cx');
    expect(res.keyword).toBe('widget market');
    expect(res.organic).toHaveLength(2);
    expect(res.organic[0].domain).toBe('grandviewresearch.com');
    expect(res.organic[0].hasReportSchema).toBe(true);
    expect(res.ads).toEqual([]);
    expect(res.aiOverviewSources).toEqual([]);
  });

  it('throws SerpProviderError on a non-ok response', async () => {
    const provider = new GoogleCseProvider('key', 'cx', () =>
      Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }),
    );
    await expect(provider.search('widget')).rejects.toBeInstanceOf(SerpProviderError);
    await expect(provider.search('widget')).rejects.toMatchObject({ code: 'RATE_LIMIT', keyword: 'widget' });
  });
});

describe('normalizeGoogleCse', () => {
  it('returns an empty organic list for a payload with no items', () => {
    const res = normalizeGoogleCse('widget', {});
    expect(res.organic).toEqual([]);
    expect(res.ads).toEqual([]);
    expect(res.aiOverviewSources).toEqual([]);
  });
});
