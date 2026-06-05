/**
 * competitorWhitespaceService.ts
 *
 * Post-processing enrichment step — runs AFTER Gemini outputs the curated
 * portfolio. For each opportunity, scrapes the public search indexes of the
 * four dominant syndicated research publishers to determine whether they
 * already have a report covering that exact niche.
 *
 * PUBLISHERS CHECKED:
 *   1. Fortune Business Insights — fortunebusinessinsights.com/industry-reports (search)
 *   2. MarketsandMarkets      — marketsandmarkets.com/search (search)
 *   3. Mordor Intelligence    — mordorintelligence.com/industry-reports (search)
 *   4. Allied Market Research — alliedmarketresearch.com (search)
 *
 * ENRICHMENT FIELDS ADDED:
 *   whiteSpaceStatus          — 'CONFIRMED_GAP' | 'PARTIAL_COVERAGE' | 'COMMODITISED' | 'UNKNOWN'
 *   whiteSpaceScore           — 0–100, higher = less competitor coverage = better for Kaiso
 *   whiteSpaceLabel           — UI-ready label (e.g. "🟢 Confirmed Gap")
 *   whiteSpaceCompetitors     — string[] of competitors that have reports on this topic
 *   whiteSpaceGapReason       — one-sentence explanation of why a gap exists or doesn't
 *
 * STRATEGY:
 *   - Use each publisher's own search endpoint (free, no auth)
 *   - Keyword used: the suggestion's marketKeyword stripped of "global" prefix
 *     and "market" suffix (same logic as trendsService cleanKeyword)
 *   - Match threshold: any result title with ≥40% token overlap against EITHER
 *     the suggestion's reportTitle OR its cleaned marketKeyword is treated as a
 *     competing report (the keyword set is short and specific, so it catches
 *     commoditised topics the long report title would miss)
 *   - Non-fatal: if all scrapes fail, suggestions return unchanged with
 *     whiteSpaceStatus 'UNKNOWN'
 *
 * IMPORTANT: This step is intentionally non-fatal. A publisher scrape failure
 * must never break the core intelligence pipeline.
 */

import { ReportSuggestion } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

// Delay between requests to the same domain to avoid triggering bot detection
const PER_DOMAIN_DELAY_MS = 1500;

// Minimum token overlap ratio (0–1) to consider a competitor result a match.
// Lowered from 0.55 to 0.40: competitor report titles are short and specific, so a
// high threshold systematically missed real coverage and over-reported CONFIRMED_GAP
// (which then inflated actionScore by +30 and produced false PUBLISH NOW verdicts).
// Matching is also done against the cleaned marketKeyword, not just the long report
// title — see checkPublisher / enrichWithWhiteSpaceDetection.
const MATCH_THRESHOLD = 0.40;

// Timeout for each individual HTTP fetch
const FETCH_TIMEOUT_MS = 8000;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type WhiteSpaceStatus =
  | 'CONFIRMED_GAP'     // 0 competitors have this topic
  | 'PARTIAL_COVERAGE'  // 1 competitor has it
  | 'COMMODITISED'      // 2+ competitors have it
  | 'UNKNOWN';          // All scrapes failed

export interface WhiteSpaceResult {
  status: WhiteSpaceStatus;
  score: number;           // 0–100, higher = more white space
  label: string;           // UI-ready label
  competitors: string[];   // Names of competitors that have reports on this topic
  gapReason: string;       // One-sentence explanation
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISHER SEARCH CONFIGS
// ─────────────────────────────────────────────────────────────────────────────

interface PublisherConfig {
  name: string;
  buildSearchUrl: (keyword: string) => string;
  extractTitles: (html: string) => string[];
}

const PUBLISHERS: PublisherConfig[] = [
  {
    name: 'Fortune Business Insights',
    buildSearchUrl: (kw) =>
      `https://www.fortunebusinessinsights.com/industry-reports/search?q=${encodeURIComponent(kw)}`,
    extractTitles: (html) => extractTitlesFromHtml(html, [
      /<h[23][^>]*class="[^"]*(?:report|title|card)[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/gi,
      /<a[^>]*href="[^"]*\/industry-reports\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
      /<div[^>]*class="[^"]*(?:report-title|card-title|report-name)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
      /"name"\s*:\s*"([^"]{20,200})"/g,
    ]),
  },
  {
    name: 'MarketsandMarkets',
    buildSearchUrl: (kw) =>
      `https://www.marketsandmarkets.com/search.asp?search=${encodeURIComponent(kw)}`,
    extractTitles: (html) => extractTitlesFromHtml(html, [
      /<span[^>]*class="[^"]*(?:report-title|title)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
      /<a[^>]*href="[^"]*(?:Market-Research|market-reports)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
      /<h[23][^>]*>([\s\S]*?market[\s\S]*?)<\/h[23]>/gi,
      /"name"\s*:\s*"([^"]{20,200})"/g,
    ]),
  },
  {
    name: 'Mordor Intelligence',
    buildSearchUrl: (kw) =>
      `https://www.mordorintelligence.com/industry-reports?q=${encodeURIComponent(kw)}`,
    extractTitles: (html) => extractTitlesFromHtml(html, [
      /<h[23][^>]*class="[^"]*(?:report|title|card)[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/gi,
      /<a[^>]*href="[^"]*\/industry-reports\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
      /<div[^>]*class="[^"]*report-card-title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
      /"name"\s*:\s*"([^"]{20,200})"/g,
    ]),
  },
  {
    name: 'Allied Market Research',
    buildSearchUrl: (kw) =>
      `https://www.alliedmarketresearch.com/search?query=${encodeURIComponent(kw)}`,
    extractTitles: (html) => extractTitlesFromHtml(html, [
      /<h[23][^>]*class="[^"]*(?:report|title)[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/gi,
      /<a[^>]*href="[^"]*-market[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
      /<div[^>]*class="[^"]*(?:card-title|report-name)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
      /"name"\s*:\s*"([^"]{20,200})"/g,
    ]),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HTML TITLE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try multiple regex patterns against HTML, strip tags from matches,
 * and return a de-duped list of non-empty title strings.
 */
function extractTitlesFromHtml(html: string, patterns: RegExp[]): string[] {
  const titles = new Set<string>();

  for (const pattern of patterns) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
      const raw = match[1] ?? '';
      const clean = raw
        .replace(/<[^>]+>/g, ' ')     // strip any inner HTML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      if (clean.length > 15 && clean.toLowerCase().includes('market')) {
        titles.add(clean);
      }
    }
  }

  return Array.from(titles).slice(0, 30); // cap to 30 titles per publisher
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD PROCESSING (mirrors trendsService.cleanKeyword logic)
// ─────────────────────────────────────────────────────────────────────────────

function cleanKeyword(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^global\s+/i, '')
    .replace(/\s+market$/i, '')
    .replace(/\s+industry$/i, '')
    .replace(/\s+sector$/i, '')
    .replace(/\s+solutions$/i, '')
    .trim();
}

/**
 * Tokenise a string for overlap comparison.
 * Strips common market-report stopwords so "Global AI Data Center Market"
 * and "AI Data Center" produce the same token set.
 */
const STOP_WORDS = new Set([
  'global', 'market', 'size', 'share', 'forecast', 'industry', 'report',
  'analysis', 'overview', 'outlook', 'growth', 'trends', 'research',
  'the', 'and', 'of', 'for', 'in', 'a', 'an', 'to', 'by', 'with',
  '2025', '2026', '2027', '2028', '2029', '2030', '2031', '2032',
  '2033', '2034', '2035',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const token of a) {
    if (b.has(token)) intersect++;
  }
  return intersect / Math.max(a.size, b.size);
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE PUBLISHER SCRAPE
// ─────────────────────────────────────────────────────────────────────────────

interface PublisherResult {
  publisherName: string;
  hasMatch: boolean;
  matchedTitles: string[];
  scrapeFailed: boolean;
}

async function checkPublisher(
  publisher: PublisherConfig,
  searchKeyword: string,
  matchTokenSets: Set<string>[]
): Promise<PublisherResult> {
  const url = publisher.buildSearchUrl(searchKeyword);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `[WhiteSpace] ${publisher.name}: HTTP ${response.status} for "${searchKeyword}"`
      );
      return { publisherName: publisher.name, hasMatch: false, matchedTitles: [], scrapeFailed: true };
    }

    const html = await response.text();
    const titles = publisher.extractTitles(html);

    const matchedTitles: string[] = [];

    for (const title of titles) {
      const titleTokens = tokenize(title);
      // Match against BOTH the report-title tokens and the cleaned market-keyword
      // tokens — take the strongest overlap. The keyword set is shorter and more
      // specific, so it catches commoditised topics the long title would miss.
      const ratio = matchTokenSets.length
        ? Math.max(...matchTokenSets.map((set) => overlapRatio(set, titleTokens)))
        : 0;
      if (ratio >= MATCH_THRESHOLD) {
        matchedTitles.push(title);
      }
    }

    console.log(
      `[WhiteSpace] ${publisher.name}: ${titles.length} titles found, ` +
      `${matchedTitles.length} matching "${searchKeyword}"`
    );

    return {
      publisherName: publisher.name,
      hasMatch: matchedTitles.length > 0,
      matchedTitles,
      scrapeFailed: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[WhiteSpace] ${publisher.name}: Scrape failed — ${msg}`);
    return { publisherName: publisher.name, hasMatch: false, matchedTitles: [], scrapeFailed: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE & LABEL DERIVATION
// ─────────────────────────────────────────────────────────────────────────────

function deriveWhiteSpaceResult(
  publisherResults: PublisherResult[],
  searchKeyword: string
): WhiteSpaceResult {
  const successfulChecks = publisherResults.filter((r) => !r.scrapeFailed);
  const competitorsWithMatch = publisherResults
    .filter((r) => r.hasMatch)
    .map((r) => r.publisherName);

  // If all scrapes failed, we can't make a determination
  if (successfulChecks.length === 0) {
    return {
      status: 'UNKNOWN',
      score: 50, // neutral
      label: '⬜ No data',
      competitors: [],
      gapReason: 'Publisher search checks timed out — whitespace status could not be determined.',
    };
  }

  const matchCount = competitorsWithMatch.length;
  const checkedCount = successfulChecks.length;

  let status: WhiteSpaceStatus;
  let score: number;
  let label: string;
  let gapReason: string;

  if (matchCount === 0) {
    status = 'CONFIRMED_GAP';
    // Score higher if we checked more publishers successfully
    score = Math.round(75 + (checkedCount / PUBLISHERS.length) * 25);
    label = '🟢 Confirmed Gap';
    gapReason = `None of ${checkedCount} major publishers checked (${successfulChecks.map(r => r.publisherName).join(', ')}) have a report on "${searchKeyword}" — first-mover opportunity for Kaiso.`;
  } else if (matchCount === 1) {
    status = 'PARTIAL_COVERAGE';
    score = 45;
    label = '🟡 Partial Coverage';
    gapReason = `${competitorsWithMatch[0]} covers this topic, but the other ${checkedCount - 1} checked publisher${checkedCount - 1 !== 1 ? 's' : ''} do not — differentiated positioning is still achievable.`;
  } else {
    status = 'COMMODITISED';
    score = Math.max(0, 30 - (matchCount - 2) * 10);
    label = '🔴 Commoditised';
    gapReason = `${competitorsWithMatch.join(', ')} all have reports on this topic — high competition, price pressure likely, and SEO will be harder to win.`;
  }

  return { status, score, label, competitors: competitorsWithMatch, gapReason };
}

// ─────────────────────────────────────────────────────────────────────────────
// SLEEP HELPER
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * enrichWithWhiteSpaceDetection()
 *
 * Takes the final curatedPortfolio suggestions and checks each one against
 * the search indexes of four major competitors. Returns the enriched array
 * with whitespace fields added to every suggestion.
 *
 * Runs publishers in sequence per suggestion to avoid being flagged as a
 * bot — total runtime for 8 suggestions × 4 publishers × 1.5s delay ≈ 48s
 * worst case (in practice much faster since most requests are <2s).
 *
 * Non-fatal: suggestions without whitespace data are returned unchanged.
 */
export async function enrichWithWhiteSpaceDetection(
  suggestions: ReportSuggestion[]
): Promise<ReportSuggestion[]> {
  if (!suggestions.length) return suggestions;

  console.log(`[WhiteSpace] Checking ${suggestions.length} suggestions against ${PUBLISHERS.length} publishers...`);

  const enriched: ReportSuggestion[] = [];

  for (const suggestion of suggestions) {
    const searchKeyword = cleanKeyword(suggestion.marketKeyword || suggestion.reportTitle || '');

    if (!searchKeyword) {
      console.warn(`[WhiteSpace] Skipping suggestion with no keyword: ${suggestion.id}`);
      enriched.push(suggestion);
      continue;
    }

    const reportTokens = tokenize(suggestion.reportTitle);
    const keywordTokens = tokenize(searchKeyword);
    // Match competitor titles against both the report title and the cleaned market
    // keyword (see MATCH_THRESHOLD note). Drop empty sets defensively.
    const matchTokenSets = [reportTokens, keywordTokens].filter((s) => s.size > 0);

    const publisherResults: PublisherResult[] = [];

    for (const publisher of PUBLISHERS) {
      const result = await checkPublisher(
        publisher,
        searchKeyword,
        matchTokenSets.length ? matchTokenSets : [reportTokens]
      );
      publisherResults.push(result);

      // Polite delay between publisher requests per suggestion
      await sleep(PER_DOMAIN_DELAY_MS);
    }

    const wsResult = deriveWhiteSpaceResult(publisherResults, searchKeyword);

    console.log(
      `[WhiteSpace] "${suggestion.reportTitle.slice(0, 60)}..." → ` +
      `${wsResult.label} | Score: ${wsResult.score} | Competitors: [${wsResult.competitors.join(', ') || 'none'}]`
    );

    enriched.push({
      ...suggestion,
      whiteSpaceStatus: wsResult.status,
      whiteSpaceScore: wsResult.score,
      whiteSpaceLabel: wsResult.label,
      whiteSpaceCompetitors: wsResult.competitors,
      whiteSpaceGapReason: wsResult.gapReason,
    });
  }

  const gaps = enriched.filter((s) => (s as any).whiteSpaceStatus === 'CONFIRMED_GAP').length;
  const partial = enriched.filter((s) => (s as any).whiteSpaceStatus === 'PARTIAL_COVERAGE').length;
  const commoditised = enriched.filter((s) => (s as any).whiteSpaceStatus === 'COMMODITISED').length;

  console.log(
    `[WhiteSpace] Complete — ${gaps} confirmed gaps, ${partial} partial, ${commoditised} commoditised, ` +
    `${enriched.length - gaps - partial - commoditised} unknown`
  );

  return enriched;
}
