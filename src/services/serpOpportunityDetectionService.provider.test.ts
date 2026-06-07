/**
 * serpOpportunityDetectionService.provider.test.ts (Task 7.2*)
 *
 * Unit coverage for the TavilyProvider: `isConfigured()` reflects the
 * credential, `search` POSTs the keyword and maps the vendor payload into a
 * SerpResponse, and HTTP failures surface as SerpProviderError.
 *
 * Requirements: 1.2, 1.3, 7.2
 */

import { describe, it, expect } from 'vitest';
import {
  TavilyProvider,
  normalizeTavily,
  SerpProviderError,
} from './serpOpportunityDetectionService';

const SAMPLE_PAYLOAD = {
  results: [
    {
      title: 'Global Widget Market Size Report 2030',
      url: 'https://grandviewresearch.com/industry-report/widget',
      content: 'The widget market is...',
    },
    {
      title: 'Widget blog post',
      url: 'https://example.com/blog/widget',
      content: 'opinions',
    },
  ],
};

const okFetch = (capture: { url?: string; init?: any }) => (url: string, init?: unknown) => {
  capture.url = url;
  capture.init = init;
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_PAYLOAD) });
};

describe('TavilyProvider.isConfigured', () => {
  it('is false when the credential is absent, true when present', () => {
    expect(new TavilyProvider('').isConfigured()).toBe(false);
    expect(new TavilyProvider('tvly-key').isConfigured()).toBe(true);
  });
});

describe('TavilyProvider.search', () => {
  it('POSTs the keyword to the Tavily endpoint and normalizes the payload', async () => {
    const capture: { url?: string; init?: any } = {};
    const provider = new TavilyProvider('tvly-key', okFetch(capture));
    const res = await provider.search('widget market');

    expect(capture.url).toBe('https://api.tavily.com/search');
    expect(capture.init?.method).toBe('POST');
    expect(String(capture.init?.body)).toContain('widget market');
    expect(String(capture.init?.headers?.Authorization)).toContain('tvly-key');

    expect(res.keyword).toBe('widget market');
    expect(res.organic).toHaveLength(2);
    expect(res.organic[0].domain).toBe('grandviewresearch.com');
    expect(res.organic[0].snippet).toBe('The widget market is...');
    expect(res.ads).toEqual([]);
    expect(res.aiOverviewSources).toEqual([]);
  });

  it('throws SerpProviderError on a non-ok response', async () => {
    const provider = new TavilyProvider('tvly-key', () =>
      Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }),
    );
    await expect(provider.search('widget')).rejects.toBeInstanceOf(SerpProviderError);
    await expect(provider.search('widget')).rejects.toMatchObject({ code: 'RATE_LIMIT', keyword: 'widget' });
  });
});

describe('normalizeTavily', () => {
  it('returns an empty organic list for a payload with no results', () => {
    const res = normalizeTavily('widget', {});
    expect(res.organic).toEqual([]);
    expect(res.ads).toEqual([]);
    expect(res.aiOverviewSources).toEqual([]);
  });
});
