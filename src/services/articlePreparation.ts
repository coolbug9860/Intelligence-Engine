/**
 * articlePreparation.ts
 *
 * Input-preparation for the analysis prompt, extracted from geminiService.ts
 * (Option-B modularization). This is all internal-only logic — no other service
 * imports it, and it does not touch the shared Gemini plumbing (keyManager,
 * safeJsonParse, withTimeout) that reasoningEngine and the reasoning-engine-llm-upgrade
 * spec rely on remaining in geminiService.ts.
 *
 * Responsibilities:
 *  - commercial-relevance gate (inclusion)
 *  - consumer/retail-investor noise gate (exclusion)
 *  - vertical classification + stratified sampling for the prompt
 */

import { RSSArticle } from "../types";

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

export function isCommerciallyRelevant(title?: string): boolean {
  if (!title || typeof title !== "string") {
    return false;
  }

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/);

  return words.some((w) => RELEVANCE_TERMS.has(w));
}

/**
 * Consumer / retail-investor / personal-finance noise that should never seed a B2B
 * syndicated report. General markets and personal-finance columns leak items like
 * "I'm 55 and retiring", "Roth 401(k) tips", or "Wall Street vs Main Street" that pass
 * the commercial-relevance gate yet have no enterprise buyer. Conservative, high-
 * precision substring list — drops only clearly non-B2B consumer-finance items. Tunable.
 * (Note: "ira" is intentionally excluded — "IRA" is also the Inflation Reduction Act.)
 */
const RETAIL_NOISE_TERMS: string[] = [
  "401k", "401(k)", "roth", "retire", "personal finance", "mortgage rate",
  "credit score", "savings account", "how to invest", "stock pick",
  "dividend stock", "student loan", "social security", "homebuyer",
  "home buyer", "main street",
];

/** True when a headline is clearly consumer/retail-investor noise, not a B2B signal. */
export function isRetailNoise(title?: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return RETAIL_NOISE_TERMS.some((term) => t.includes(term));
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

export function prepareArticles(articles: RSSArticle[]) {
  const commercialArticles = articles
    .filter((a) => a?.title)
    .filter((a) => isCommerciallyRelevant(a.title))
    .filter((a) => !isRetailNoise(a.title));

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
