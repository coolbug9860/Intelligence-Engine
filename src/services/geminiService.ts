import { GoogleGenAI, Type } from "@google/genai";
import { ReportSuggestion, RSSArticle, EDGARSignal } from "../types";

/** Model id passed to `GoogleGenAI.models.generateContent` (server + browser API paths in this file). */
const GEMINI_ANALYSIS_MODEL = "gemini-2.5-flash";   // Best price-performance for high-volume structured output with reasoning
const GEMINI_BRIEF_MODEL = "gemini-2.5-pro";         // Most advanced reasoning for complex brief generation — worth the cost for a one-off $3-5k report justification

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-KEY ROTATION MANAGER
//
// Reads up to 5 Gemini API keys from environment variables:
//   GEMINI_API_KEY        — primary (required)
//   GEMINI_API_KEY_2      — fallback 1 (optional)
//   GEMINI_API_KEY_3      — fallback 2 (optional)
//   GEMINI_API_KEY_4      — fallback 3 (optional)
//   GEMINI_API_KEY_5      — fallback 4 (optional)
//
// On a quota/rate-limit error (429, RESOURCE_EXHAUSTED, spending cap,
// PERMISSION_DENIED) the manager automatically advances to the next key
// and retries the call. If all keys are exhausted it throws the last error.
//
// Keys are also rotated on a per-call round-robin basis to spread load
// evenly across all available keys, not just use #1 until it's exhausted.
// ─────────────────────────────────────────────────────────────────────────────

interface ManagedKey {
  key: string;
  client: GoogleGenAI;
  masked: string;
  exhausted: boolean;
  exhaustedAt: number | null;   // timestamp — keys reset after 60 minutes
}

const KEY_RESET_MS = 60 * 60 * 1000; // 1 hour — quota windows typically reset hourly

class GeminiKeyManager {
  private keys: ManagedKey[] = [];
  private currentIndex = 0;
  private initialized = false;

  private init() {
    if (this.initialized) return;

    const envKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY_4,
      process.env.GEMINI_API_KEY_5,
    ].filter((k): k is string => Boolean(k?.trim()));

    if (envKeys.length === 0) {
      throw new Error(
        "GEMINI_API_KEY environment variable is required for AI features."
      );
    }

    this.keys = envKeys.map((key) => ({
      key,
      client: new GoogleGenAI({ apiKey: key }),
      masked: key.substring(0, 4) + "****" + key.substring(key.length - 4),
      exhausted: false,
      exhaustedAt: null,
    }));

    console.info(
      `Intelligence Core: ${this.keys.length} Gemini API key(s) loaded. [${this.keys.map(k => k.masked).join(', ')}]`
    );

    this.initialized = true;
  }

  /** Returns the next available (non-exhausted) client, resetting expired bans first. */
  private getAvailableKey(): ManagedKey | null {
    const now = Date.now();

    // Reset any keys whose exhaustion window has expired
    for (const k of this.keys) {
      if (k.exhausted && k.exhaustedAt && now - k.exhaustedAt > KEY_RESET_MS) {
        k.exhausted = false;
        k.exhaustedAt = null;
        console.info(`[GeminiKeys] Key ${k.masked} quota window reset — re-enabling.`);
      }
    }

    // Try keys starting from currentIndex (round-robin)
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      if (!this.keys[idx].exhausted) {
        return this.keys[idx];
      }
    }

    return null; // all keys exhausted
  }

  /** Mark a key as quota-exhausted so it won't be used until reset. */
  private markExhausted(managed: ManagedKey) {
    managed.exhausted = true;
    managed.exhaustedAt = Date.now();
    console.warn(
      `[GeminiKeys] Key ${managed.masked} marked exhausted — ` +
      `${this.keys.filter(k => !k.exhausted).length} key(s) remaining.`
    );
  }

  /** Advance the round-robin pointer to the next key. */
  private advance() {
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  /**
   * Execute a Gemini API call with automatic key rotation on quota errors.
   * The caller provides a factory function that takes a GoogleGenAI client
   * and returns a Promise. On quota/rate-limit error, the next key is tried.
   */
  async call<T>(
    factory: (client: GoogleGenAI, keyMasked: string) => Promise<T>
  ): Promise<T> {
    this.init();

    let lastError: unknown = null;

    // Try every key at most once
    for (let attempt = 0; attempt < this.keys.length; attempt++) {
      const managed = this.getAvailableKey();

      if (!managed) {
        throw new Error(
          "[GeminiKeys] All API keys are quota-exhausted. " +
          "Add more keys (GEMINI_API_KEY_2, _3 …) or wait for quota reset."
        );
      }

      try {
        const result = await factory(managed.client, managed.masked);
        // Success — advance round-robin for next call
        this.advance();
        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isQuotaError =
          msg.includes("429") ||
          msg.includes("RESOURCE_EXHAUSTED") ||
          msg.includes("spending cap") ||
          msg.includes("quota") ||
          msg.includes("rate limit") ||
          msg.includes("PERMISSION_DENIED") ||
          (err as any)?.status === 429;

        if (isQuotaError) {
          console.warn(
            `[GeminiKeys] Key ${managed.masked} hit quota/rate limit — rotating to next key.`
          );
          this.markExhausted(managed);
          this.advance();
          lastError = err;
          // Continue loop to try next key
        } else {
          // Non-quota error (bad prompt, network, etc.) — don't rotate, just throw
          throw err;
        }
      }
    }

    throw lastError ?? new Error("[GeminiKeys] All keys failed.");
  }
}

const keyManager = new GeminiKeyManager();

const AI_TIMEOUT_MS = 90000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = AI_TIMEOUT_MS
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(new Error("AI request timeout exceeded."));
      }, timeoutMs)
    ),
  ]);
}

/** Full detail for logs when Gemini or parsing fails (SDK errors are not always plain `Error`). */
function formatGeminiServiceError(error: unknown): string {
  if (error instanceof Error) {
    const lines = [`${error.name}: ${error.message}`];
    if (error.stack) {
      lines.push(error.stack);
    }
    if (error.cause !== undefined) {
      lines.push(
        `Caused by: ${formatGeminiServiceError(error.cause)}`
      );
    }
    return lines.join("\n");
  }
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(
        error as Record<string, unknown>,
        Object.getOwnPropertyNames(error)
      );
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/** First `[` index for regex-style array detection (see `ARRAY_HEAD_REGEX`). */
const ARRAY_HEAD_REGEX = /\[/;

/**
 * Greedy "first array-shaped" slice per `/\[[\s\S]*\]/` — used only when
 * bracket-balanced extraction fails (e.g. truncated output).
 */
const GREEDY_JSON_ARRAY_REGEX = /\[[\s\S]*\]/;

/**
 * Extract the first top-level `[` … `]` span, respecting strings and escapes.
 * Prefer this over greedy `/\[[\s\S]*\]/`, which breaks on `]` inside strings.
 */
function extractFirstBalancedJsonArray(text: string): string | null {
  const m = text.match(ARRAY_HEAD_REGEX);
  if (!m || m.index === undefined) {
    return null;
  }
  const start = m.index;
  const s = text.slice(start);

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) {
        return s.slice(0, i + 1);
      }
    }
  }
  return null;
}

/** Remove trailing commas before `}` or `]` only outside of JSON strings. */
function removeTrailingCommasOutsideStrings(json: string): string {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) {
        j++;
      }
      const next = json[j];
      if (next === "]" || next === "}") {
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** Replace raw line breaks inside JSON string literals with a space (invalid in strict JSON). */
function replaceUnescapedNewlinesInsideStrings(json: string): string {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        out += c;
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        out += c;
        continue;
      }
      if (c === "\n" || c === "\r") {
        out += " ";
        if (c === "\r" && json[i + 1] === "\n") {
          i++;
        }
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') {
      inString = true;
    }
    out += c;
  }
  return out;
}

/**
 * Parse model text without assuming the whole payload is valid JSON.
 * 1) Strip optional markdown fences
 * 2) Extract first JSON array substring (balanced `[`...`]`; fallback greedy `/\[[\s\S]*\]/`)
 * 3) Repair trailing commas and unescaped newlines inside strings, then JSON.parse
 */
function safeJsonParse(text: string) {
  let cleanText = text.trim();

  if (cleanText.startsWith("```")) {
    cleanText = cleanText
      .replace(/^```[a-z]*\n/i, "")
      .replace(/\n```$/g, "");
  }

  let arraySlice = extractFirstBalancedJsonArray(cleanText);
  if (!arraySlice) {
    const greedy = cleanText.match(GREEDY_JSON_ARRAY_REGEX);
    arraySlice = greedy?.[0] ?? null;
  }

  if (!arraySlice) {
    console.error(
      "safeJsonParse: no JSON array substring found (balanced or /\\[[\\s\\S]*\\]/)"
    );
    return null;
  }

  const attempts: string[] = [
    arraySlice,
    removeTrailingCommasOutsideStrings(arraySlice),
    replaceUnescapedNewlinesInsideStrings(arraySlice),
    removeTrailingCommasOutsideStrings(
      replaceUnescapedNewlinesInsideStrings(arraySlice)
    ),
    replaceUnescapedNewlinesInsideStrings(
      removeTrailingCommasOutsideStrings(arraySlice)
    ),
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      return JSON.parse(attempts[i]);
    } catch (error) {
      if (i === attempts.length - 1) {
        console.error(
          "safeJsonParse: JSON.parse failed after repairs; last snippet (800 chars):",
          attempts[i].slice(0, 800),
          error
        );
      }
    }
  }

  return null;
}

const RELEVANCE_TERMS = new Set([
  "market", "markets", "investment", "investor", "investors",
  "acquisition", "merger", "ipo", "funding", "capital", "revenue",
  "growth", "profit", "earnings", "valuation", "startup", "venture",
  "equity", "debt", "bond", "stock", "shares", "portfolio", "supply",
  "demand", "production", "manufacturing", "logistics", "procurement",
  "regulation", "regulatory", "policy", "legislation", "compliance",
  "approval", "technology", "ai", "semiconductor", "chip", "battery",
  "energy", "drug", "clinical", "patent", "license", "contract",
  "partnership", "deal", "agreement", "joint", "launch", "deploy",
  "expand", "scale", "export", "import", "trade", "tariff", "digital",
  "data", "cloud", "platform", "software", "hardware", "network",
]);

function isCommerciallyRelevant(title?: string): boolean {
  if (!title || typeof title !== "string") {
    return false;
  }

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/);

  return words.some((w) => RELEVANCE_TERMS.has(w));
}

// Vertical keyword map for stratified sampling
// Each vertical gets up to 5 articles ensuring all 14 verticals
// have representation in every Gemini analysis call
const VERTICAL_KEYWORDS: Record<string, string[]> = {
  Healthcare:       ["pharma","drug","clinical","biotech","medical","health","fda","hospital","patient","therapeutic"],
  Semiconductor:    ["semiconductor","chip","wafer","fab","lithography","nvidia","tsmc","intel","amd","foundry"],
  Electronics:      ["electronics","circuit","pcb","component","display","sensor","capacitor","transistor"],
  Automotive:       ["automotive","vehicle","ev","electric car","battery","oem","lidar","autonomous","tesla","fleet"],
  Energy:           ["energy","solar","wind","grid","oil","gas","nuclear","hydrogen","power","renewabl","utility"],
  Chemicals:        ["chemical","polymer","resin","specialty chemical","fertilizer","petrochemical","compound","catalyst"],
  BFSI:             ["bank","insurance","fintech","payment","lending","credit","wealth","asset management","treasury","bfsi"],
  Fintech:          ["fintech","neobank","crypto","blockchain","defi","digital payment","regtech","insurtech"],
  Aerospace:        ["aerospace","aviation","defense","satellite","drone","missile","aircraft","space","rocket"],
  Construction:     ["construction","infrastructure","real estate","building","cement","steel","contractor","smart city"],
  Agriculture:      ["agriculture","farming","crop","fertilizer","agtech","food security","irrigation","livestock"],
  "Food & Beverage":["food","beverage","nutrition","fmcg","packaged food","dairy","meat","restaurant","supply chain"],
  "Retail & E-Commerce": ["retail","ecommerce","e-commerce","consumer","shopping","marketplace","logistics","fulfillment"],
  "IT & Telecom":   ["telecom","5g","cloud","saas","software","cybersecurity","data center","network","enterprise it"],
};

const ARTICLES_PER_VERTICAL = 5;
const MAX_UNCLASSIFIED = 10;

function classifyArticleVertical(title: string, excerpt: string): string | null {
  const text = `${title} ${excerpt}`.toLowerCase();
  for (const [vertical, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return vertical;
    }
  }
  return null;
}

function prepareArticles(articles: RSSArticle[]) {
  const commercialArticles = articles
    .filter((a) => a?.title)
    .filter((a) => isCommerciallyRelevant(a.title));

  // Stratified sampling: up to ARTICLES_PER_VERTICAL articles per vertical
  const buckets: Record<string, RSSArticle[]> = {};
  const unclassified: RSSArticle[] = [];

  for (const article of commercialArticles) {
    const vertical = classifyArticleVertical(
      article.title,
      article.description || ""
    );
    if (vertical) {
      if (!buckets[vertical]) buckets[vertical] = [];
      if (buckets[vertical].length < ARTICLES_PER_VERTICAL) {
        buckets[vertical].push(article);
      }
    } else if (unclassified.length < MAX_UNCLASSIFIED) {
      unclassified.push(article);
    }
  }

  // Merge: all bucketed articles + unclassified fallback
  const stratified = [
    ...Object.values(buckets).flat(),
    ...unclassified,
  ];

  const verticalsCovered = Object.keys(buckets).length;
  console.log(
    `[Stratifier] ${stratified.length} articles selected across ${verticalsCovered} verticals`
  );

  return stratified.map((a) => ({
    title: a.title,
    url: a.link,
    date: a.pubDate,
    timestamp: a.timestamp,
    source: a.sourceName,
    vertical: classifyArticleVertical(a.title, a.description || "") || "General",
    excerpt: a.description?.replace(/<[^>]+>/g, "").slice(0, 700) ?? "",
  }));
}

const RED_TEAM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    logicLeaks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          fault: { type: Type.STRING },
          severity: {
            type: Type.STRING,
            enum: ["Low", "Medium", "Critical"],
          },
          counterArgument: { type: Type.STRING },
        },
      },
    },
    blindSpots: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    resilienceAdjustment: {
      type: Type.NUMBER,
    },
  },
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function analyzeNews(
  articles: RSSArticle[],
  edgarSignals: EDGARSignal[] = [],
  recentlySurfaced: Array<{ reportTitle: string; vertical: string; generatedAt: string; anchorTitle?: string }> = []
): Promise<ReportSuggestion[]> {
  if (!articles.length && !edgarSignals.length) return [];

  const cleanedArticles = prepareArticles(articles);

  // Prepare EDGAR signals as a clean array for the prompt
  const rawEdgar = edgarSignals.map((s) => ({
    company: s.companyName,
    filingType: s.filingType,
    filingDate: s.filingDate,
    vertical: s.vertical,
    keyword: s.matchedKeyword,
    excerpt: s.excerpt,
    url: s.url,
  }));

  // Stratified cap: max 3 signals per vertical, 42 total max
  // Prevents prompt overflow when EDGAR returns large result sets
  const MAX_EDGAR_PER_VERTICAL = 3;
  const MAX_EDGAR_TOTAL = 42;
  const edgarByVertical: Record<string, typeof rawEdgar> = {};
  for (const signal of rawEdgar) {
    if (!edgarByVertical[signal.vertical]) edgarByVertical[signal.vertical] = [];
    if (edgarByVertical[signal.vertical].length < MAX_EDGAR_PER_VERTICAL) {
      edgarByVertical[signal.vertical].push(signal);
    }
  }
  const cleanedEdgar = Object.values(edgarByVertical).flat().slice(0, MAX_EDGAR_TOTAL);
  console.log(`[EDGAR] Sending ${cleanedEdgar.length} signals to Gemini (capped from ${rawEdgar.length})`);

  console.log(
    `Intelligence Core: Starting synthesis for ${cleanedArticles.length} articles...`
  );

  // ── MEMORY CONTEXT BLOCK ────────────────────────────────────────────────────
  // Builds the novelty suppression block from previously surfaced opportunities.
  //
  // DESIGN NOTE — SOURCE AGNOSTIC:
  // This block operates only on { reportTitle, vertical, generatedAt } from
  // memory.cycles. It does not care which data source (EDGAR, USPTO, OpenAlex,
  // NIH RePORTER, arXiv, etc.) produced the opportunity. When new sources are
  // added to the pipeline, they feed memory.cycles the same way and suppression
  // works automatically with zero changes here.
  //
  // Three suppression layers:
  //   1. Title list       — exact/near-exact title suppression (0–14d hard, 15–30d soft)
  //   2. Keyword themes   — strips boilerplate from titles, suppresses core concepts
  //   3. Vertical cooldown — reduces probability of over-represented verticals
  const memorySuppressBlock = (() => {
    if (!recentlySurfaced.length) return '';

    const nowMs = Date.now();
    const DAY_MS = 86_400_000;

    const suppress: typeof recentlySurfaced = [];
    const deprioritise: typeof recentlySurfaced = [];

    for (const o of recentlySurfaced) {
      const daysAgo = Math.round((nowMs - new Date(o.generatedAt).getTime()) / DAY_MS);
      if (daysAgo <= 14)       suppress.push(o);
      else if (daysAgo <= 30)  deprioritise.push(o);
    }

    if (!suppress.length && !deprioritise.length) return '';

    // ── Layer 2: keyword theme extraction ──────────────────────────────────────
    // Strip market-report boilerplate from titles, keep the signal words.
    // These become forbidden *concepts*, not just forbidden title strings.
    // This prevents Gemini rephrasing "AI Data Center Infrastructure" as
    // "AI Infrastructure & Data Center" to bypass title-level suppression.
    //
    // BOILERPLATE also includes common AI-era modifiers (driven, powered,
    // based, enabled, intelligence, advanced, next, generation) so that
    // "AI-Driven Geospatial Intelligence" and "Space-Based Geospatial
    // Intelligence" both reduce to the same core concept ("geospatial")
    // and are correctly blocked.
    // BOILERPLATE strips ONLY structural/generic market-report words.
    // Domain nouns (biologics, cybersecurity, defense, geospatial, specialty,
    // procurement, intelligence) are intentionally kept so they appear in
    // the suppressed keyword list and block semantic variants of the same topic.
    const BOILERPLATE = /\b(global|market|size|share|forecast|industry|report|the|and|of|for|in|a|an|to|by|with|from|into|its|2025|2026|2027|2034|2035|trends?|analysis|overview|outlook|growth|demand|sector|systems?|platform|technologies?|management|development|investment|infrastructure|driven|powered|based|enabled|enhanced|advanced|smart|next|generation|digital|modern|integrated|automated|autonomous|application|innovation|landscape|dynamics|transition|deployment|adoption|solutions?)\b/gi;

    const allSuppressedTitles = [...suppress, ...deprioritise].map(o => o.reportTitle);

    // Extract unigrams (signal words after boilerplate stripping)
    const suppressedUnigrams = allSuppressedTitles
      .flatMap(title =>
        title.toLowerCase()
          .replace(BOILERPLATE, ' ')
          .split(/[\s,&\-\/]+/)
          .map(w => w.trim())
          .filter(w => w.length > 4)
      );

    // Extract bigrams from the cleaned token stream.
    // Bigrams catch paired concepts that survive unigram stripping —
    // e.g. "geospatial intelligence" where both words are individually
    // boilerplate but together form a specific market concept.
    // We operate on the *pre*-boilerplate token stream so we preserve
    // meaningful pairs like "supply chain", "gene therapy", "cell therapy".
    const suppressedBigrams = allSuppressedTitles
      .flatMap(title => {
        const tokens = title.toLowerCase()
          .split(/[\s,&\-\/]+/)
          .map(w => w.replace(/[^a-z0-9]/g, '').trim())
          .filter(w => w.length > 2);
        const bigrams: string[] = [];
        for (let i = 0; i < tokens.length - 1; i++) {
          // Only include bigrams where at least one token survives BOILERPLATE
          // (i.e. is a meaningful signal word, not pure filler)
          const a = tokens[i].replace(/\b(the|and|of|for|in|a|an|to|by|with|from|its)\b/g, '');
          const b = tokens[i + 1].replace(/\b(the|and|of|for|in|a|an|to|by|with|from|its)\b/g, '');
          if (a.length > 3 && b.length > 3) {
            bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
          }
        }
        return bigrams;
      });

    const suppressedKeywords = [
      ...suppressedUnigrams,
      ...suppressedBigrams,
    ]
      .filter((w, i, arr) => arr.indexOf(w) === i)  // dedupe
      .slice(0, 50);                                  // cap raised: bigrams double the list

    // ── Layer 3: vertical cooldown ─────────────────────────────────────────────
    // Count how many times each vertical appeared in suppressed opportunities.
    // Verticals appearing 2+ times get a cooldown instruction.
    const verticalCounts: Record<string, number> = {};
    for (const o of [...suppress, ...deprioritise]) {
      verticalCounts[o.vertical] = (verticalCounts[o.vertical] ?? 0) + 1;
    }
    const cooledVerticals = Object.entries(verticalCounts)
      .filter(([, count]) => count >= 2)
      .map(([v, count]) => `${v} (appeared ${count}x recently)`);

    // ── Assemble the block ─────────────────────────────────────────────────────
    const lines: string[] = ['NOVELTY REQUIREMENT — READ BEFORE SELECTING ANY OPPORTUNITY:'];

    if (suppress.length) {
      lines.push('');
      lines.push('STRONGLY AVOID RESURFACING — these were surfaced within 14 days. Only include if the supporting evidence is a new signal published within the last 7 days that is materially different from prior evidence. Aim for 10 opportunities but never fewer than 8, and never pad the list by recycling a suppressed theme just to reach a count. A genuinely new angle backed by fresh evidence always beats resurfacing:');
      suppress.forEach(o => {
        const daysAgo = Math.round((nowMs - new Date(o.generatedAt).getTime()) / DAY_MS);
        lines.push(`  - ${o.reportTitle} [${o.vertical}] — ${daysAgo}d ago`);
      });
    }

    if (deprioritise.length) {
      lines.push('');
      lines.push('LOWER PRIORITY — surfaced 15–30 days ago. Include only if a new corroborating signal exists. If you include one, begin the rationale with "Resurface:" and state in one sentence what new evidence justifies it:');
      deprioritise.forEach(o => {
        const daysAgo = Math.round((nowMs - new Date(o.generatedAt).getTime()) / DAY_MS);
        lines.push(`  - ${o.reportTitle} [${o.vertical}] — ${daysAgo}d ago`);
      });
    }

    if (suppressedKeywords.length) {
      lines.push('');
      lines.push('SUPPRESSED THEMES — Do not generate opportunities whose core subject matches these concepts, regardless of how the title is worded. These themes are already covered by recent output:');
      lines.push(`  ${suppressedKeywords.join(', ')}`);
    }

    if (cooledVerticals.length) {
      lines.push('');
      lines.push('VERTICAL COOLDOWN — These verticals are over-represented in recent cycles. Only select them if signal strength is exceptional (score 8.5+). Prefer underrepresented verticals for remaining slots:');
      cooledVerticals.forEach(v => lines.push(`  - ${v}`));
    }

    // ── Layer 4: anchor article suppression ────────────────────────────────────
    // Hard-blocks reuse of any article or filing that was the primary anchor
    // for an opportunity in a previous session. Placed as an ABSOLUTE RULE
    // so Gemini cannot override it on the basis of signal strength.
    const usedAnchors = [...suppress, ...deprioritise]
      .map(o => o.anchorTitle)
      .filter((a): a is string => Boolean(a && a.trim().length > 0));

    if (usedAnchors.length) {
      lines.push('');
      lines.push('ABSOLUTE RULE — ANCHOR REUSE PROHIBITED:');
      lines.push('The following articles or filings have ALREADY been used as evidence for an opportunity in a previous session. You MUST NOT use any of them as the sourceArticleTitle for ANY opportunity in this response — regardless of the report title, angle, scope, or vertical. This rule blocks the SOURCE ARTICLE ITSELF, not just the title it previously generated. WRONG: using "Ondas Inc. EX-99.1" as a Defense Electronics report after it already anchored a Defense Procurement report — same article, different angle, still prohibited. WRONG: using "AIR PRODUCTS 10-Q" for a Specialty Chemicals for Electronics report after it anchored a Specialty Chemicals Demand report. The filing is exhausted. Find a different article. This rule has NO exceptions — signal strength, investment size, and relevance do NOT override it:');
      usedAnchors.forEach(a => lines.push(`  - ${a}`));
      lines.push('Violating this rule produces duplicate intelligence with zero value to Kaiso. The signal pool reliably contains at least 8 to 10 worthwhile fresh opportunities — find them.');
    }

    lines.push('');
    lines.push('Every slot used on a repeated theme is a slot not used on fresh intelligence. When a known theme and a genuinely new theme are both viable, always prefer the new one. Target 10 opportunities and never return fewer than 8. Do not pad with recycled or weak themes to hit a number: 8 strong, genuinely novel opportunities beat 10 with filler.');

    return lines.join('\n');
  })();
  // ── END MEMORY CONTEXT BLOCK ────────────────────────────────────────────────

  const KAISO_VERTICALS = [
    'Healthcare', 'Electronics', 'Semiconductor', 'Automotive', 'Chemicals',
    'Energy', 'Fintech', 'Aerospace', 'BFSI', 'Food & Beverage',
    'Construction', 'Agriculture', 'Retail & E-Commerce', 'IT & Telecom'
  ];

  const STRATEGIC_PILLARS = [
    'Regulatory Trigger', 'M&A / Corporate Activity', 'Technology Disruption',
    'Supply Chain Decoupling', 'Geographic Demand Shift', 'Patent / IP Filing',
    'Clinical / Scientific Breakthrough', 'Competitor White Space',
    'Emerging Application', 'ESG / Sustainability Mandate', 'Investment Surge',
    'Consumer Behavior Shift', 'Cross-Vertical Convergence'
  ];

  // Forecast window for report titles — computed dynamically so titles never go
  // stale (e.g. shipping "2025-2034" in 2026). Standard 10-year syndicated window.
  const currentYear = new Date().getFullYear();
  const FORECAST_RANGE = `${currentYear}-${currentYear + 9}`;

  const prompt = `You are a senior market intelligence analyst at Kaiso Research, a global B2B syndicated market research firm.

YOUR TASK:
Analyze the news articles below and identify the TOP 10 most commercially valuable market keyword opportunities that Kaiso's research team should investigate for new syndicated report publication.

KAISO BUSINESS CONTEXT:
- Kaiso publishes B2B syndicated market research reports priced $3,000-$5,000 each
- Report buyers are: enterprise procurement teams, investment firms, management consultants, product strategy heads, government bodies
- A strong report opportunity requires: a specific niche keyword, clear enterprise buyer demand, sufficient market activity, and ideally a gap in competitor report databases
- Kaiso covers these verticals only: ${KAISO_VERTICALS.join(', ')}

SIGNAL PRIORITY HIERARCHY — FOLLOW THIS ORDER STRICTLY:

PRIORITY 1 — EDGAR REGULATORY SIGNALS (Primary source. Always check these first.)
Start by scanning all EDGAR filings provided below. These are official SEC disclosures where executives legally describe market conditions, demand shifts, risks, and investment plans. An EDGAR signal alone is sufficient to identify a strong opportunity — it does not require RSS corroboration. EDGAR-only opportunities should receive a confidenceScore of 6 minimum.

PRIORITY 2 — RSS + NEWSAPI ARTICLES (Secondary source. Use to corroborate and strengthen.)
After identifying opportunities from EDGAR, scan RSS/NewsAPI articles to find additional corroboration or new signals not covered by EDGAR. An RSS-only opportunity requires at least 2 articles from different sources to qualify as strong.

CONVERGENCE BONUS — HIGHEST CONFIDENCE:
When an EDGAR filing AND one or more RSS articles point to the same market theme, that is maximum-confidence convergence. Elevate the confidenceScore to 8+ for such opportunities and rank them above single-source signals.

RANKING RULE (evidence tie-breaker only): EDGAR + RSS convergence (strongest evidence) > EDGAR-only > multi-RSS > single-RSS. IMPORTANT: commercial viability is the PRIMARY ranking axis — source tier is only a tie-breaker between opportunities of comparable commercial value. Never rank a commercially weak opportunity above a commercially strong one just because its source tier is higher.

When multiple signals support the same opportunity, list ALL of them in the contributingSignals array. EDGAR entries in format: "[Company] [FilingType] ([Vertical])". RSS entries in format: "Article Title (Source Name)". Single-RSS-article opportunities are acceptable only if they score 8+ on Buyer Willingness and Quantifiability.

SIX-POINT COMMERCIAL VIABILITY FILTER:
Score each opportunity against all six criteria (1-10), scoring EACH criterion independently on its own merits.

1. QUANTIFIABILITY (20%): Can this market be assigned a credible dollar value from company revenues, shipment volumes, or regulatory data? Score 1 if purely conceptual, 10 if multiple public data sources exist.

2. CAGR VIABILITY (20%): Is 8-10%+ annual growth narratively supportable? Are there specific regulatory approvals, investment surges, or technology shifts driving growth? Score 1 for flat/declining markets, 10 for markets with multiple confirmed growth drivers.

3. COMPETITIVE LANDSCAPE DENSITY (15%): Are 10-15 companies identifiable as active players in this exact niche? Score 1 if fewer than 5 companies exist, 10 if 15+ named players are identifiable.

4. SEGMENTABILITY (15%): Can this market be divided across 3-4 meaningful axes (by product type, application, geography, technology, or customer segment)? Score 1 if one product sold one way, 10 if 4+ clear segmentation axes exist.

5. BUYER WILLINGNESS (20%): Does a VP Strategy, BD Director, or Investment Analyst at a $100M+ company need this intelligence right now? Is it niche enough to justify $4,000 but broad enough for 10-30 buyers globally? Score 1 for consumer/academic topics, 10 for active enterprise investment decisions.

6. SEO SEARCHABILITY (10%): Is someone already searching "[Topic] Market Size" or "[Topic] Market Report" with commercial intent? Score 1 if too obscure or too broad, 10 if exact phrase maps to clear buyer search behavior. Score MAX 4 if the topic combines two distinct markets in one phrase (e.g. "AI Infrastructure and Data Center", "Biologics and Cell Gene Therapy") — compound topics do not map to real search queries and will not rank.

COMPOSITE: commercialViabilityScore = round(Q*0.20 + C*0.20 + D*0.15 + S*0.15 + B*0.20 + E*0.10)
INCLUSION GATE: Include an opportunity only if its commercialViabilityScore composite is 6 or higher. Do NOT inflate individual criterion scores to clear this gate — score each honestly and let the composite fall where it lands. Separately, exclude any opportunity scoring below 5 on Quantifiability or Buyer Willingness; those two are non-negotiable for a sellable report.

GROUNDING — MANDATORY, NO FABRICATION:
Every opportunity MUST trace to a specific signal in the EDGAR or RSS data provided below. Do NOT invent companies, filings, funding rounds, regulations, partnerships, or statistics that are not present in the input. sourceArticleTitle and contributingSignals must be copied from the provided signals, not paraphrased or imagined. Estimated figures such as CAGR must be directional and anchored to drivers visible in the signals — never fabricate precise market sizes, dollar values, or growth rates. If a strong-looking opportunity cannot be grounded in the supplied signals, leave it out.

SCORING DISCIPLINE — CRITICAL FOR RANKING QUALITY:
These six scores rank the opportunities for a $4,000+ commissioning decision, so they MUST discriminate, not cluster.
- Use the FULL 1-10 range. Reserve 9-10 for genuinely exceptional and 1-3 for genuinely weak. Do NOT default to 6, 7, or 8.
- Score each dimension INDEPENDENTLY. Do not let one strong dimension — or your overall confidence that the trend is real — pull the others up. A real opportunity usually has a SPIKY profile (e.g. Buyer Willingness 9 but Competitive Density 4), not a flat 7 across all six.
- Commercial value and evidence confidence are SEPARATE axes. A well-evidenced trend can still make a commercially weak report (few buyers, no search demand); a thinly-evidenced trend can be commercially strong. Score commercial viability on its own merits, never inflated by how certain you are the trend is real.
- If most of your opportunities land at the same composite, you are not discriminating hard enough. Spread them so the strongest clearly out-scores the weakest.

CALIBRATION EXAMPLE (illustrative score profiles only — do NOT copy these topics):
- A niche with surging enterprise procurement and easy market sizing but a crowded competitor field: Buyer Willingness 9, Quantifiability 8, SEO 7, Segmentability 6, CAGR 7, Competitive Density 3 → composite ~7 (include).
- A broad, well-known but commoditised topic: Buyer Willingness 5, Quantifiability 7, SEO 4 (too generic to rank), Segmentability 5, CAGR 4, Competitive Density 8 → composite ~5 (exclude).
Note the spiky profiles and full range — that is the level of discrimination expected on every opportunity.

FOR EACH OPPORTUNITY RETURN EXACTLY THESE FIELDS:
- reportTitle: Full market research report title following this EXACT formula: [Geographic Modifier] + [Product/Technology Modifier] + [Core Subject] + "Market Size, Share & Forecast, ${FORECAST_RANGE}". Geographic modifier MUST be "Global" unless the signal clearly originates from a specific country or region (e.g. "India", "North America", "Asia Pacific"). Example: "Global AI-Powered Offshore Wind Turbine Predictive Maintenance Market Size, Share & Forecast, ${FORECAST_RANGE}". Never omit the geographic modifier. Never omit the forecast year range. CRITICAL TITLE RULE: The Core Subject must describe ONE single, specific market. Never combine two distinct markets into one title using "and", "&", or "/" — these are separate reports with separate buyers. WRONG: "Global AI Infrastructure and Data Center Market" (two markets). WRONG: "Global Biologics and Cell/Gene Therapy Market" (two markets). RIGHT: "Global AI Data Center Market" OR "Global AI Infrastructure Market" — pick the one the signal most directly supports. If a signal touches two adjacent markets, identify which single market has the stronger buyer demand right now and title the report for that market only.
- marketKeyword: SEO keyword phrase following this EXACT formula: [geographic modifier] + [product/technology modifier] + [core subject] + "market". All lowercase. No hyphens. No special characters. This must be the exact phrase a corporate buyer would type into Google. Example: "global ai powered offshore wind turbine predictive maintenance market". Must include the geographic modifier. Must end with "market". Must correspond to ONE searchable market — never combine two markets with "and" in the keyword phrase.
- vertical: Must be exactly one of: ${KAISO_VERTICALS.map(v => `"${v}"`).join(', ')}
- strategicPillar: Must be exactly one of: ${STRATEGIC_PILLARS.map(p => `"${p}"`).join(', ')}
- thematicCluster: REQUIRED. A 2-4 word category label that groups this opportunity by its core technology or market theme. This field is used for deduplication — every opportunity MUST have a specific, descriptive value. NEVER leave this empty, null, or generic. Examples by vertical: Semiconductor → "Advanced Chip Packaging", Energy → "Grid-Scale Energy Storage", Healthcare → "Cell Gene Therapy Manufacturing", Aerospace → "Commercial Space Launch", Fintech → "Embedded Finance Rails", Agriculture → "Precision AgriTech", IT & Telecom → "AI Data Center Cooling", Automotive → "Solid-State EV Batteries". The value must reflect the specific niche, not a broad category like "Emerging Markets" or "Technology".
- rationale: Why this topic is trending RIGHT NOW based on the articles. 2-3 sentences max.
- b2bCommercialRationale: Who specifically would pay $4,000 for this report and why. 1-2 sentences.
- competitorWhiteSpace: Is this niche underserved in existing research databases? What specific gap exists?
- trigger: The single most important news event or signal that makes this "the right time" for this report
- trendingKeywords: Array of 3-5 related keywords/phrases a buyer would search for
- salesPotential: "High" (clear enterprise demand, strong trigger), "Medium" (good signal, developing market), or "Emerging" (early stage, speculative)
- confidenceScore: Integer 1-10 based purely on evidence quality and volume in these articles (do NOT default to 7)
- sentimentPolarity: "Bullish" (positive momentum), "Bearish" (contraction/risk), or "Neutral"
- marketExecutionWindow: "Immediate (0-3M)" (publish now, hot topic), "Strategic (6-12M)" (building momentum), or "Long-term (1Y+)" (early signal)
- primaryStakeholder: The single most likely report buyer persona (e.g. "EV Battery Procurement Heads at Tier-1 Automotive OEMs")
- sourceArticleTitle: Title of the primary article that triggered this signal
- sourceArticleUrl: URL of that primary article
- sourceName: Name of the publication (e.g. "Reuters", "Financial Times")
- commercialViabilityScore: Integer 1-10. Weighted composite of the six commercial filter scores. Formula: round((quantifiabilityScore*0.20 + cagrViabilityScore*0.20 + competitiveDensityScore*0.15 + segmentabilityScore*0.15 + buyerWillingnessScore*0.20 + seoSearchabilityScore*0.10))
- quantifiabilityScore: Integer 1-10. Can this market be assigned a credible dollar value?
- cagrViabilityScore: Integer 1-10. Is 8-10%+ CAGR narratively supportable?
- competitiveDensityScore: Integer 1-10. Are 10-15 companies identifiable as active players?
- segmentabilityScore: Integer 1-10. Can it be divided across 3-4 meaningful axes?
- buyerWillingnessScore: Integer 1-10. Does a $100M+ enterprise VP need this right now?
- seoSearchabilityScore: Integer 1-10. Is someone already searching this keyword commercially? Score MAX 4 if the market keyword combines two distinct markets with "and" or "&".
- signalCount: Integer. Count of articles from the provided list that directly or indirectly support this opportunity. Minimum 1. Set higher when multiple articles from different sources point at the same market theme.
- contributingSignals: Array of strings. List every article supporting this opportunity in format "Article Title (Source Name)". Primary article first. Include ALL articles counted in signalCount.
- signalType: Classify the primary signal driving this opportunity. Must be exactly one of: "Regulatory", "VC/PE Funding", "Patent Filing", "Trade Publication", "General News"
- suggestedSegmentationAxes: Array of exactly 4 strings. Each string defines one segmentation axis for this market in the format "By [Dimension]: [Category1], [Category2], [Category3]". Examples: "By Product Type: Hardware, Software, Services" or "By End User: Hospitals, Clinics, Home Care" or "By Geography: North America, Europe, Asia Pacific" or "By Technology: AI-Based, Conventional, Hybrid".
- estimatedCAGRRange: String. Provide a realistic CAGR range estimate for this market in the format "X-Y%" (e.g. "12-18%"). Follow with a single comma, then one sentence of reasoning citing the primary growth driver. Example: "14-19%, driven by accelerating AI chip procurement cycles among hyperscalers". Base the range on the signal strength, sector norms, and regulatory context. Do not fabricate specific figures — anchor to observable drivers in the articles.
- signalOriginGeography: String. Where does this signal originate? Identify the primary country or region driving this market event. Use concise names: "United States", "China", "India", "European Union", "Southeast Asia", "Global", etc.
- recommendedReportGeography: String. Based on signal origin and market scope, recommend the ideal Kaiso report SKU geography. Must be exactly one of: "Global", "Regional: Asia Pacific", "Regional: North America", "Regional: Europe", "Regional: Middle East & Africa", "Regional: Latin America", "Country: [Name]". Choose "Global" only if signals span 3+ regions. Choose Country SKU only if the signal is clearly country-specific.

SCORING RULES:
- confidenceScore 8-10: 3+ articles from tier-1 sources (Reuters, FT, Bloomberg, WSJ) all pointing to same trend
- confidenceScore 5-7: 1-2 strong articles or multiple mid-tier sources
- confidenceScore 1-4: Single weak signal or speculative topic
- salesPotential "High": Enterprise companies actively spending/investing in this area RIGHT NOW
- salesPotential "Medium": Clear future demand but procurement cycle not yet triggered
- salesPotential "Emerging": Interesting signal but unclear commercial timeline

SIGNAL TYPE CLASSIFICATION:
For each opportunity, classify the primary signal type driving it. Use exactly one of these values:
- "Regulatory": FDA approval, government policy, sanctions, trade regulation, compliance mandate
- "VC/PE Funding": Venture capital round, private equity acquisition, IPO filing, funding announcement
- "Patent Filing": Patent grant, IP licensing deal, R&D breakthrough announcement
- "Trade Publication": Industry report, trade association data, B2B sector news, earnings from sector companies
- "General News": General business news, market commentary, analyst opinion without hard event

Signal type weight for ranking: Regulatory > VC/PE Funding > Patent Filing > Trade Publication > General News. When two opportunities have equal commercialViabilityScore, rank the higher signal type first.

DIVERSITY RULE: Ensure opportunities span at least 5 different verticals. Do not return more than 2 opportunities from the same vertical.
${memorySuppressBlock ? `\n${memorySuppressBlock}\n` : ''}
PRIORITY 1 DATA — EDGAR REGULATORY FILINGS (Start here. These drive your primary opportunity identification.)
${cleanedEdgar.length > 0 ? JSON.stringify(cleanedEdgar, null, 2) : "(No EDGAR signals available this cycle)"}

---

PRIORITY 2 DATA — RSS & NEWSAPI ARTICLES (Use to corroborate EDGAR signals or identify additional opportunities.)
${JSON.stringify(cleanedArticles, null, 2)}

IMPORTANT: Return a JSON array of 8 to 10 objects, strongest first. Prioritise quality and novelty over hitting a specific count — never pad with weak or recycled opportunities, and never return fewer than 8. No explanation text. No markdown formatting. Pure valid JSON array only.`;

  try {
    const analysisPromise = keyManager.call((client, keyMasked) => {
      console.info(`Intelligence Core: Connected to Gemini API successfully. [${keyMasked}]`);
      return client.models.generateContent({
        model: GEMINI_ANALYSIS_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        config: {
          temperature: 0.2,
          maxOutputTokens: 40000,
          thinkingConfig: { thinkingBudget: 6144 },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
            type: Type.OBJECT,
            properties: {
              reportTitle: { type: Type.STRING },
              marketKeyword: { type: Type.STRING },
              vertical: { type: Type.STRING },
              strategicPillar: { type: Type.STRING },
              thematicCluster: { type: Type.STRING },
              rationale: { type: Type.STRING },
              b2bCommercialRationale: { type: Type.STRING },
              competitorWhiteSpace: { type: Type.STRING },
              trigger: { type: Type.STRING },
              trendingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              salesPotential: { type: Type.STRING },
              confidenceScore: { type: Type.INTEGER },
              sentimentPolarity: { type: Type.STRING },
              marketExecutionWindow: { type: Type.STRING },
              primaryStakeholder: { type: Type.STRING },
              sourceArticleTitle: { type: Type.STRING },
              sourceArticleUrl: { type: Type.STRING },
              sourceName: { type: Type.STRING },
              commercialViabilityScore: { type: Type.INTEGER },
              quantifiabilityScore: { type: Type.INTEGER },
              cagrViabilityScore: { type: Type.INTEGER },
              competitiveDensityScore: { type: Type.INTEGER },
              segmentabilityScore: { type: Type.INTEGER },
              buyerWillingnessScore: { type: Type.INTEGER },
              seoSearchabilityScore: { type: Type.INTEGER },
              signalCount: { type: Type.INTEGER },
              contributingSignals: { type: Type.ARRAY, items: { type: Type.STRING } },
              signalType: { type: Type.STRING },
              suggestedSegmentationAxes: { type: Type.ARRAY, items: { type: Type.STRING } },
              estimatedCAGRRange: { type: Type.STRING },
              signalOriginGeography: { type: Type.STRING },
              recommendedReportGeography: { type: Type.STRING },
            },
            required: [
              "reportTitle", "marketKeyword", "vertical", "rationale", "trigger",
              "confidenceScore",
              // thematicCluster drives dedup grouping; omitting it forces the
              // "Emerging Markets" fallback that caused historical dedup collapse.
              "thematicCluster",
              // Commercial sub-scores now DRIVE the ranking (see scoringEngine),
              // so they must always be present rather than defaulting to 5.
              "commercialViabilityScore", "buyerWillingnessScore", "quantifiabilityScore",
              "seoSearchabilityScore", "segmentabilityScore", "cagrViabilityScore",
              "competitiveDensityScore",
            ],
          },
        },
      },
    });
    });
    const response = await withTimeout(analysisPromise, 120000);

    // `.text` is a string getter in current @google/genai types, but older SDK
    // versions exposed it as a method. Cast through `any` so the defensive
    // function-vs-getter guard works at runtime without a compile error.
    const responseAny = response as any;
    const raw =
      typeof responseAny.text === "function"
        ? await responseAny.text()
        : responseAny.text;
    const text = (raw ?? "").trim();

    let parsed: any[];
    try {
      // Try direct parse first
      const result = JSON.parse(text);
      if (Array.isArray(result)) {
        parsed = result;
      } else if (result && typeof result === 'object') {
        // Handle {"opportunities": [...]} or any wrapper object
        const arrayValue = Object.values(result).find((v) => Array.isArray(v));
        parsed = arrayValue ? (arrayValue as any[]) : [result];
      } else {
        parsed = [result];
      }
    } catch {
      // Gemini added text before/after JSON — extract the array manually
      const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        try {
          parsed = JSON.parse(arrayMatch[0]);
        } catch {
          const extracted = extractFirstBalancedJsonArray(text);
          if (extracted) {
            parsed = JSON.parse(extracted);
          } else {
            console.error('[Gemini] Raw response sample:', text.slice(0, 300));
            throw new Error("Could not parse AI response as JSON");
          }
        }
      } else {
        const extracted = extractFirstBalancedJsonArray(text);
        if (extracted) {
          parsed = JSON.parse(extracted);
        } else {
          console.error('[Gemini] Raw response sample:', text.slice(0, 300));
          throw new Error("Could not parse AI response as JSON");
        }
      }
    }

    // ── POST-PARSE ASSERTION ────────────────────────────────────────────────
    // We ask Gemini for 10 so dedup has a 2-slot buffer. Gemini reliably
    // returns 8-10 — it does not guarantee exactly 10. So we assert on the
    // minimum acceptable floor (8), not on the request count (10).
    // If dedup then merges some of those 8-10 down below 8, the orchestrator's
    // DEDUP_COLLAPSE warning fires separately. Asserting on 10 here was causing
    // every 8- or 9-result response to throw and return [], producing the
    // "No Strategic Opportunities Identified" regression.
    console.log(`[Gemini] Parsed ${parsed.length} opportunities from response`);
    if (parsed.length < 8) {
      console.error(
        `[Gemini] UNDER-COUNT: received ${parsed.length}/8 minimum opportunities. ` +
        `Input sizes — articles: ${cleanedArticles.length}, EDGAR: ${cleanedEdgar.length}, ` +
        `suppressed titles: ${recentlySurfaced.length}. ` +
        `This usually means the data pipeline was too sparse for Gemini to ` +
        `fill the minimum slots, or suppression acted as a hard filter.`
      );
      throw new Error(
        `[Gemini] Safety floor violation: model returned ${parsed.length} opportunities, minimum is 8. ` +
        `Check pipeline data volume (articles: ${cleanedArticles.length}, EDGAR: ${cleanedEdgar.length}).`
      );
    }
    // ── END POST-PARSE ASSERTION ────────────────────────────────────────────

        return parsed.slice(0, 10).map((item: any, index: number) => ({
      id: `sig-${Date.now()}-${index}`,
      reportTitle: String(item.reportTitle || "Untitled Market Opportunity"),
      marketKeyword: String(item.marketKeyword || "").toLowerCase().slice(0, 100),
      vertical: (KAISO_VERTICALS.includes(item.vertical) ? item.vertical : "IT & Telecom") as any,
      strategicPillar: item.strategicPillar || undefined,
      thematicCluster: String(item.thematicCluster || "Emerging Markets"),
      rationale: String(item.rationale || ""),
      b2bCommercialRationale: String(item.b2bCommercialRationale || ""),
      competitorWhiteSpace: String(item.competitorWhiteSpace || ""),
      trigger: String(item.trigger || ""),
      trendingKeywords: Array.isArray(item.trendingKeywords) ? item.trendingKeywords.map(String) : [],
      salesPotential: (['High', 'Medium', 'Emerging'].includes(item.salesPotential)
        ? item.salesPotential : 'Medium') as any,
      confidenceScore: typeof item.confidenceScore === 'number'
        ? Math.min(10, Math.max(1, Math.round(item.confidenceScore))) : 5,
      sentimentPolarity: (['Bullish', 'Bearish', 'Neutral'].includes(item.sentimentPolarity)
        ? item.sentimentPolarity : 'Neutral') as any,
      marketExecutionWindow: (['Immediate (0-3M)', 'Strategic (6-12M)', 'Long-term (1Y+)'].includes(item.marketExecutionWindow)
        ? item.marketExecutionWindow : 'Strategic (6-12M)') as any,
      primaryStakeholder: String(item.primaryStakeholder || ""),
      sourceArticleTitle: String(item.sourceArticleTitle || ""),
      sourceArticleUrl: String(item.sourceArticleUrl || ""),
      sourceArticleTimestamp: Date.now(),
      sourceName: String(item.sourceName || ""),
      commercialViabilityScore: typeof item.commercialViabilityScore === 'number' ? Math.min(10, Math.max(1, Math.round(item.commercialViabilityScore))) : 5,
      quantifiabilityScore: typeof item.quantifiabilityScore === 'number' ? Math.min(10, Math.max(1, Math.round(item.quantifiabilityScore))) : 5,
      cagrViabilityScore: typeof item.cagrViabilityScore === 'number' ? Math.min(10, Math.max(1, Math.round(item.cagrViabilityScore))) : 5,
      competitiveDensityScore: typeof item.competitiveDensityScore === 'number' ? Math.min(10, Math.max(1, Math.round(item.competitiveDensityScore))) : 5,
      segmentabilityScore: typeof item.segmentabilityScore === 'number' ? Math.min(10, Math.max(1, Math.round(item.segmentabilityScore))) : 5,
      buyerWillingnessScore: typeof item.buyerWillingnessScore === 'number' ? Math.min(10, Math.max(1, Math.round(item.buyerWillingnessScore))) : 5,
      seoSearchabilityScore: typeof item.seoSearchabilityScore === 'number' ? Math.min(10, Math.max(1, Math.round(item.seoSearchabilityScore))) : 5,
      signalCount: typeof item.signalCount === 'number' ? Math.max(1, Math.round(item.signalCount)) : 1,
      contributingSignals: Array.isArray(item.contributingSignals) ? item.contributingSignals.map(String) : [],
      signalType: item.signalType || undefined,
      suggestedSegmentationAxes: Array.isArray(item.suggestedSegmentationAxes) ? item.suggestedSegmentationAxes.map(String) : undefined,
      estimatedCAGRRange: item.estimatedCAGRRange ? String(item.estimatedCAGRRange) : undefined,
      signalOriginGeography: item.signalOriginGeography ? String(item.signalOriginGeography) : undefined,
      recommendedReportGeography: item.recommendedReportGeography ? String(item.recommendedReportGeography) : undefined,
    }));

  } catch (err) {
    console.error("[Gemini] analyzeNews failed:", formatGeminiServiceError(err));
    return [];
  }
}

export async function generateFullBrief(
  suggestion: ReportSuggestion
): Promise<string> {
  if (typeof window !== "undefined") {
    const response = await fetch("/api/intelligence/brief", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionStorage.getItem('kaiso_auth_token') ?? ''}`,
      },
      body: JSON.stringify({ suggestion }),
    });

    if (!response.ok) {
      throw new Error("Brief generation failed.");
    }

    const data = await response.json();

    return data.brief;
  }

  try {
    const currentYear = new Date().getFullYear();
    const forecastEndYear = currentYear + 9;
    const FORECAST_RANGE = `${currentYear}-${forecastEndYear}`;
    const briefPromise = keyManager.call((client, keyMasked) => {
      console.info(`[GeminiKeys] Brief generation using key [${keyMasked}]`);
      return client.models.generateContent({
        model: GEMINI_BRIEF_MODEL,
        contents: [
        {
          role: "user",
            parts: [
              {
                text: `You are a Lead Industry Analyst at Kaiso Research and Consulting, a global B2B market intelligence firm. This is a Report Commission Document — a formal internal deliverable that answers one question for the commissioning editor: is this market worth a $3,500-$5,500 syndicated report investment?

Your obligation is not to be comprehensive, balanced, or positive. Your obligation is to be precise, defensible, and honest about what the signals actually show. This brief must reach a clear verdict. A brief that presents both sides without choosing one has failed its purpose.

INTELLIGENCE SIGNAL DATA:
${JSON.stringify(suggestion, null, 2)}

═══════════════════════════════════════════════
WRITING RULES — MANDATORY, APPLY TO EVERY SECTION
═══════════════════════════════════════════════

ANALYTICAL POSITION RULE:
Take a clear, defensible position on every market claim. Do not present pros and cons like a student essay. If evidence supports both a risk and an opportunity, state which one dominates and why. The Lead Industry Analyst role earns a position — use it.

CAUSAL CHAIN RULE:
Do not list market forces. Show how one development causes the next. Structure: Event A creates condition B, which forces decision C, which produces consequence D. The reader should follow the logic as a chain, not a list. This is how Fortune analysts write.

NAMED ENTITY RULE:
Every 200-word block must contain at least 3 named entities — specific companies, regulations, standards bodies, named geographies, or proprietary technologies. "Major manufacturers" fails. "CATL, Panasonic Energy, and LG Energy Solution" passes. "Regulatory bodies" fails. "The U.S. IRA Section 45X production tax credit" passes.

STAT FORMAT RULE:
Every figure must carry an explicit year and projection horizon. Wrong: "The market is growing at 11.4% CAGR." Right: "The market is projected at 11.4% CAGR through 2032, anchored in Kaiso Research's primary dataset for this segment."

SOUL SIGNAL RULE — include at least 4 of these across the brief:
- Data Reaction: React to a data point — name what it means for a specific type of buyer, not just what it is.
- Named Consequence: Name a specific company type, job title, or procurement role facing a real consequence from this market move.
- Acknowledged Tension: Acknowledge genuine complexity — "This is a strong signal, but it also creates a data scarcity problem that will constrain report depth."
- Earned Opinion: State a clear analytical opinion without qualification — "This market will consolidate around 3-4 platform players by 2027."
- Analytical Honesty: State what the data does not show — "The CAGR figure masks a bifurcated market where the regulatory-compliant segment is growing at 3x the rate of the legacy segment."

OPENING HOOK RULE (Executive Summary only):
Do not open with a market size figure, a broad sector statement, or a question. Use one of these four techniques:
- Live Consequence: Open on a specific business consequence already in motion for a named actor.
- Data Paradox: Open on a statistic that contradicts what the reader would expect.
- Decision Clock: Open on a deadline or shrinking window that makes this urgent now.
- Named Failure: Open on a specific, verifiable failure or cost that grounds the analysis in real consequences.

LOADED ENDING RULE:
Every section must close on its sharpest sentence — the most specific, most consequential, or most challenging observation in that section. Never close a section on a transitional wrap-up or a general summary statement.

STANDALONE PUNCH RULE:
Use one short sentence (3-7 words, no qualifiers) to close at least 2 major sections. Examples of correct form: "The window is already narrowing." "This market will not wait." "The data does not support optimism here."

BANNED PATTERNS — ZERO TOLERANCE:
The following produce AI-flagged output and will be rejected. Do not use any of them anywhere in this brief.

Significance inflation: "marks a pivotal moment" / "represents a significant shift" / "underscores the importance of" / "highlights the growing need" / "signals a new era" / "is a game-changer" / "contributes to the evolution of"

Copula inflation: "serves as a catalyst" / "stands as a testament" / "functions as a bridge" / "acts as a barrier" / "operates as a key driver" / "boasts [feature or figure]"

Vague attributions: "experts say" / "industry observers note" / "analysts predict" / "reports suggest" / "studies indicate" / "it is widely understood" / "stakeholders believe"

Banned vocabulary: leverage, utilize, synergy, holistic, robust, seamless, transformative, innovative, paradigm, dynamic, game-changing, disruptive, scalable, agile, ecosystem, comprehensive, extensive, significant, substantial, considerable, notable, remarkable, unprecedented, groundbreaking

Banned transitions: Furthermore, Moreover, Additionally, In conclusion, In summary, "It is worth noting that" / "It is important to note that"

Synonym cycling: Do not rotate market / sector / space / industry / landscape / ecosystem. Pick the precise term and repeat it.

False ranges: "from startups to enterprises" / "from emerging to developed markets" / "across all segments of the industry"

Em dashes: Zero em dashes anywhere in this brief. Use a period, comma, or colon instead.

Rule of three compulsion: Do not default to exactly 3 bullets for every list. Use the count the evidence actually requires — 2, 4, or 5 when that is what the argument produces.

Temporal vagueness: Never use "in recent years," "increasingly," "over time," "in the coming years." Use specific dates, quarters, or year ranges.

═══════════════════════════════════════════════
OUTPUT FORMAT — EXACT SECTION HEADERS, EXACT ORDER
═══════════════════════════════════════════════

## COMMISSION TITLE
Kaiso report title in this exact format: "Global [Market Name] Market Size, Share & Forecast, ${FORECAST_RANGE}". The market name must be specific and searchable. No "Analysis," no "Study," no em dashes. Example: "Global AI Data Center Cooling Solutions Market Size, Share & Forecast, ${FORECAST_RANGE}".

## BURNING PLATFORM
75-100 words. This is not an executive summary. It is the answer to one question: why does this opportunity exist right now and what happens to a buyer who waits 12 months? Open with one of the four hook techniques above. Do not open with a market size. Do not open with a definition. Close on the sharpest sentence in the section — the one that makes a commissioning editor reach for a budget approval.

## MARKET SNAPSHOT
Market size estimate in this exact format: "USD X.X billion (${currentYear}E), projected to reach USD XX.X billion by ${forecastEndYear} at X.X% CAGR through ${forecastEndYear}." Follow with one sentence anchoring the estimate to the named signals in the intelligence data above. If a precise figure cannot be derived from the signal data, provide a directional range and state explicitly what data would be needed to confirm it. Do not fabricate specific figures.

## SIGNAL ANALYSIS
150-200 words. This is the analytical core of the brief. Show the causal chain from the triggering signal to the commercial opportunity, using named entities throughout. Structure: what the signal is (name the company or filing if EDGAR data is present) — what it reveals about the market — what decision it forces for enterprise buyers — why that creates a report opportunity now. One standalone punch sentence to close.

## DROC ANALYSIS

DRIVERS: Each bullet names a concrete mechanism with a specific actor, date range, or regulation. No vague forces. Wrong: "Growing demand for energy efficiency." Right: "The U.S. DOE's updated appliance efficiency standards effective January 2025 force a $4.2B retrofitting cycle across Tier-1 commercial real estate operators through 2027."

RESTRAINTS: Each bullet names a specific barrier with the actor it affects and the mechanism of friction. No generic obstacles.

OPPORTUNITIES: Each bullet identifies a named underserved segment, geography, or application and states why it is underserved. Not "emerging markets" — name the market and the gap.

CHALLENGES: Each bullet names a specific execution risk for Kaiso as publisher or for market participants. Name the risk precisely.

Use as many bullets as the evidence requires. Do not default to exactly 4 per category.

## SEGMENTATION FRAMEWORK
${suggestion.suggestedSegmentationAxes && suggestion.suggestedSegmentationAxes.length > 0
  ? `Use these pre-validated segmentation axes: ${suggestion.suggestedSegmentationAxes.join(' | ')}. For each axis, list the segments and close with one sentence explaining the commercial significance of that axis for enterprise procurement decisions — not why the market uses it, but why a buyer would pay for data cut along it.`
  : `Define 4 segmentation axes. Format each as "By [Dimension]: [Segment1], [Segment2], [Segment3]". Close each with one sentence on commercial significance for enterprise buyers.`}

## COMPETITIVE WHITE SPACE
Two parts. First: name the specific gap — a geography, sub-segment, application, or methodology angle that Mordor Intelligence, Grand View Research, and SNS Insider do not cover well. Be specific about what they do cover and where the gap is.${
  suggestion.whiteSpaceStatus && suggestion.whiteSpaceStatus !== 'UNKNOWN'
    ? `\n\nLIVE COMPETITOR SCAN DATA (authoritative — use this):\n- Publisher scan status: ${suggestion.whiteSpaceLabel}\n- Gap score: ${suggestion.whiteSpaceScore}/100\n- ${suggestion.whiteSpaceGapReason}\n${suggestion.whiteSpaceCompetitors && suggestion.whiteSpaceCompetitors.length > 0 ? `- Competitors with existing reports: ${suggestion.whiteSpaceCompetitors.join(', ')}` : '- No major publishers found covering this exact topic in the scan'}\n\nIncorporate this scan data as concrete evidence in your analysis. If COMMODITISED, name the specific reports these publishers have and explain what differentiated angle Kaiso must take. If CONFIRMED_GAP, state this explicitly as a first-mover signal.`
    : ''
} Second: one sentence stating Kaiso's differentiator for this report in precise, unqualified language. Not "Kaiso's comprehensive coverage" — name what is different and why it matters to the buyer.

## TARGET BUYER PERSONAS
Identify the buyer personas this report actually reaches. For each: job title, company type and size, the exact decision they face right now, why a $4,000 report resolves it faster than internal research, and the procurement trigger (budget cycle, regulatory deadline, board mandate, or competitive pressure). Use the count the evidence supports — not a forced set of exactly 3.

## KEY COMPANY SEEDS
Companies active in this market. For each: name, headquarters country, one-line role in this market, and classification (Potential Report Buyer / Potential Competitor / Both). Flag any already covered extensively by Mordor Intelligence or Grand View Research — that coverage is a competitive constraint, not a validation signal.

## GEOGRAPHIC PRIORITY RECOMMENDATION
The most commercially valuable geographies for this report based on the signal data. For each: region name, the specific regulatory, investment, or demand driver making it a priority right now (name the driver, not the category), and recommended depth (Primary Coverage / Secondary Coverage / Monitoring Only).

## REPORT CHAPTER OUTLINE
8 chapter titles. Structure: 1. Market Overview & Scope, 2. Market Size & Forecast (${currentYear - 5}-${forecastEndYear}), 3. Segmentation Analysis, 4. Competitive Landscape & Company Profiles, 5. Regional Analysis, 6. Technology & Innovation Trends, 7. Regulatory Environment & Policy Impact, 8. Strategic Recommendations & Investment Outlook. Adjust chapter 6 and 7 titles to reflect the specific market — do not use generic filler titles.

## SEO TITLE VARIANTS
5 alternative report titles targeting different search intents: (1) geographic variant, (2) technology-specific variant, (3) application or end-use variant, (4) forecast-year variant, (5) buyer-persona variant. Each title must be specific enough to rank — not "Global EV Battery Market" but "Global EV Battery Thermal Management Systems Market Size, Share & Forecast, ${FORECAST_RANGE}".

## RECOMMENDED PRICE TIER
Standard ($3,500), Premium ($4,500), or Enterprise ($5,500+). State the tier. Justify in exactly 2 sentences: one sentence on market complexity and data scarcity, one sentence on buyer willingness to pay based on the decision context identified in the Buyer Personas section.

## RESEARCH TEAM BRIEFING
The 5-6 most important data sources, databases, trade associations, regulatory bodies, and expert interview targets for the first two weeks of research. Name actual organisations and databases — not categories. Wrong: "Regulatory filings." Right: "SEC EDGAR 10-K filings from [named companies in this market], IEA World Energy Outlook 2024 dataset, and IRENA's Renewable Capacity Statistics 2025."

## COMMISSION VERDICT
This is the most important section. One of three verdicts, stated clearly on the first line:
COMMISSION — proceed to full report production.
DEFER — revisit in [specific timeframe] when [specific condition] is met.
PASS — insufficient commercial signal for production investment.

Follow the verdict with exactly 2 sentences: the primary reason for the verdict, and the single biggest risk to that verdict being correct. No hedging. No "on the other hand." The analyst has made a call.`,
              },
            ],
          },
        ],
        config: {
          temperature: 0.7,
          maxOutputTokens: 40000,
          thinkingConfig: { thinkingBudget: 8000 },
        },
      });
    });
    const response = await withTimeout(briefPromise, 120000);

    // See note in analyzeNews: cast through `any` so the function-vs-getter
    // guard compiles against the current @google/genai getter typing.
    const responseAny = response as any;
    const text =
      typeof responseAny.text === "function"
        ? await responseAny.text()
        : responseAny.text;

    return text || "Brief generation failed.";
  } catch (error) {
    console.error(
      "[Intelligence Core][generateFullBrief] Failed:",
      formatGeminiServiceError(error)
    );
    return "Brief generation failed.";
  }
}
