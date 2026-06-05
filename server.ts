import express from "express";
import dotenv from "dotenv";
import Parser from "rss-parser";
import fs from "fs";
import path from "path";
import cors from "cors";
import rateLimit from "express-rate-limit";

import type { RSSArticle, EDGARSignal } from "./src/types";
import { runIntelligencePipeline } from "./src/services/intelligenceOrchestrator";
import {
  generateFullBrief,
} from "./src/services/geminiService";
import { fetchEdgarSignals } from "./src/services/edgarService";
import { generateBriefDocxBuffer } from "./src/services/briefExportServer";
import { enrichWithTrends } from "./src/services/trendsService";
import { enrichWithWhiteSpaceDetection } from "./src/services/competitorWhitespaceService";
import { classifyPortfolio } from "./src/services/actionClassificationEngine";

dotenv.config();

const app = express();

// Tell Express to trust Render's reverse proxy — fixes express-rate-limit
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR warning on every request
app.set('trust proxy', 1);
// This tells the server to wait up to 10 minutes for the AI to finish
app.use((req, res, next) => {
  res.setTimeout(600000, () => {
    console.warn(`[Timeout] Request to ${req.url} timed out after 10 minutes.`);
    if (!res.headersSent) {
      res.status(504).send('The AI synthesis took too long. Please try again.');
    }
  });
  next();
});
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});


const PORT = Number(process.env.PORT) || 8080;

app.use(express.json({ limit: "10mb" }));

// ════════════════════════════════════════════════════════════════════════════════
// CORS — Only allow requests from our own Render domain.
// Blocks other websites from silently calling our API using your Gemini quota.
// ════════════════════════════════════════════════════════════════════════════════
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://kaiso-intelligence-os.onrender.com";

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-domain, mobile apps, curl during dev)
    if (!origin || origin === ALLOWED_ORIGIN) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

// ════════════════════════════════════════════════════════════════════════════════
// RATE LIMITING — Prevent Gemini quota exhaustion and DoS attacks.
// Different limits for cheap vs expensive endpoints.
// ════════════════════════════════════════════════════════════════════════════════

// General API limit: 60 requests per minute per IP (covers /api/rss, /api/auth)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
  handler: (req, res, _next, options) => {
    console.warn(`[RateLimit] General limit hit from ${req.ip}`);
    res.status(429).json(options.message);
  },
});

// AI endpoint limit: 10 requests per minute per IP (covers /api/intelligence/*)
// Each call consumes significant Gemini tokens — this stops runaway scripts.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI request limit reached. Please wait a minute before trying again." },
  handler: (req, res, _next, options) => {
    console.warn(`[RateLimit] AI limit hit from ${req.ip} on ${req.path}`);
    res.status(429).json(options.message);
  },
});

app.use("/api", generalLimiter);
app.use("/api/intelligence", aiLimiter);

// ════════════════════════════════════════════════════════════════════════════════
// AUTH — Credentials live in env vars, never in source code.
// Set KAISO_USERNAME and KAISO_PASSWORD in Render environment variables.
// The token returned here is a simple signed secret; for production consider
// a proper JWT library, but this is vastly safer than hardcoded credentials.
// ════════════════════════════════════════════════════════════════════════════════
const AUTH_TOKEN = process.env.KAISO_AUTH_TOKEN || crypto.randomUUID(); // stable per-process session token

app.post("/api/auth", (req, res) => {
  const { username, password } = req.body || {};
  const validUser = process.env.KAISO_USERNAME;
  const validPass = process.env.KAISO_PASSWORD;

  if (!validUser || !validPass) {
    console.error("[Auth] KAISO_USERNAME or KAISO_PASSWORD env vars not set.");
    return res.status(500).json({ error: "Server authentication not configured." });
  }

  if (username === validUser && password === validPass) {
    console.log("[Auth] Successful login.");
    return res.json({ token: AUTH_TOKEN });
  }

  console.warn("[Auth] Failed login attempt.");
  return res.status(401).json({ error: "Invalid credentials." });
});
// ════════════════════════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE — All /api/* routes below this line require a valid token.
// Token is issued by /api/auth above and stored in the client sessionStorage.
// ════════════════════════════════════════════════════════════════════════════════
app.use("/api", (req, res, next) => {
  // /api/auth itself is exempt — it's how you get the token
  if (req.path === "/auth") return next();

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || token !== AUTH_TOKEN) {
    console.warn(`[Auth] Rejected unauthenticated request to ${req.path}`);
    return res.status(401).json({ error: "Unauthorized." });
  }

  next();
});

// ════════════════════════════════════════════════════════════════════════════════
// MEMORY PERSISTENCE — JSON file survives server restarts on Render
// Unlocks memory engine, evolution engine, and longitudinal intelligence
// ════════════════════════════════════════════════════════════════════════════════
// Use /tmp so memory persists across requests within the same Render instance.
// process.cwd() on Render points to the build directory which is wiped on redeploy.
// /tmp survives for the lifetime of a running instance (~hours to days between deploys).
const MEMORY_FILE = process.env.MEMORY_FILE_PATH ?? path.join('/tmp', 'kaiso-memory.json');

function loadMemoryFromDisk(): any {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
      const memory = JSON.parse(raw);
      console.log("[Memory] Loaded from disk. Cycles:", memory?.cycles?.length ?? 0);
      return memory;
    }
  } catch (err) {
    console.warn("[Memory] Could not load memory file, starting fresh:", err);
  }
  return null;
}

function saveMemoryToDisk(memory: any): void {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf-8");
    console.log("[Memory] Saved to disk. Cycles:", memory?.cycles?.length ?? 0);
  } catch (err) {
    console.warn("[Memory] Could not save memory file:", err);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// STABLE RSS FEEDS — Backend-side ingestion only (NO browser CORS needed)
// ════════════════════════════════════════════════════════════════════════════════
// Quality standards: editorial content only, no user-generated content,
// no paywalled feeds that return 403, no aggregators with no bylines.
// Audited and upgraded 2026-05-30.
const STABLE_RSS_FEEDS = [

  // ── Healthcare & Pharma ──────────────────────────────────────────────────
  "https://www.statnews.com/feed/",                           // STAT News — gold standard pharma/biotech journalism
  "https://www.fiercepharma.com/rss/xml",                    // Fierce Pharma — industry news
  "https://www.fiercebiotech.com/rss/xml",                   // Fierce Biotech — R&D pipeline coverage
  "https://www.biopharmadive.com/feeds/news/",               // BioPharma Dive — M&A, regulatory
  "https://endpoints.news/feed/",                             // Endpoints News — clinical/regulatory focus
  "https://health.economictimes.indiatimes.com/rss/lateststories", // ET Health — Asia market signals
  "https://pharma.economictimes.indiatimes.com/rss/lateststories", // ET Pharma — India manufacturing signals
  "https://www.pharmaceutical-technology.com/feed/",         // Pharm-Tech — manufacturing & supply chain
  "https://www.drugdiscoverytrends.com/feed/",               // DDT — early pipeline signals

  // ── Semiconductor & Electronics ──────────────────────────────────────────
  "https://semiengineering.com/feed/",                        // Semiconductor Engineering — deep technical
  "https://www.eetimes.com/feed",                             // EE Times — broad electronics coverage
  "https://semiconductor-today.com/rss/news.xml",            // Semiconductor Today — industry news
  "https://www.electronicdesign.com/rss.xml",                // Electronic Design — engineering/design
  "https://www.ednasia.com/rss.xml",                         // EDN Asia — Asia semiconductor signals

  // ── Construction ─────────────────────────────────────────────────────────
  "https://www.constructiondive.com/feeds/news/",            // Construction Dive — project/market news
  "https://www.bdcnetwork.com/rss.xml",                      // Building Design+Construction — commercial
  "https://www.enr.com/rss/all",                             // Engineering News-Record — infrastructure

  // ── Automotive ───────────────────────────────────────────────────────────
  "https://auto.economictimes.indiatimes.com/rss/industry",  // ET Auto — global supply chain signals
  "https://auto.economictimes.indiatimes.com/rss/auto-technology", // ET Auto — EV/tech signals
  "https://www.autonews.com/rss.rss",                        // Automotive News — industry standard
  "https://www.wardsauto.com/rss.xml",                       // Wards Auto — production data/trends
  "https://www.just-auto.com/feed/",                         // Just Auto — global OEM coverage

  // ── Energy & Cleantech ───────────────────────────────────────────────────
  "https://www.renewableenergyworld.com/feed/",              // Renewable Energy World — editorial
  "https://cleantechnica.com/feed/",                         // CleanTechnica — EV/solar/storage
  "https://www.pv-tech.org/feed/",                           // PV Tech — solar industry
  "https://www.energy-storage.news/feed/",                   // Energy Storage News — battery/grid
  "https://www.rechargenews.com/rss",                        // Recharge News — wind/renewables
  "https://www.greentechmedia.com/rss/all",                  // Wood Mackenzie / GTM — market intelligence

  // ── BFSI & Fintech ────────────────────────────────────────────────────────
  "https://www.americanbanker.com/arc/outboundfeeds/rss/",   // American Banker — institutional finance
  "https://www.tearsheet.co/feed",                           // Tearsheet — fintech/banking transformation
  "https://www.pymnts.com/feed/",                            // PYMNTS — payments industry
  "https://www.thefinancialbrand.com/feed/",                 // The Financial Brand — retail banking
  "https://fintechmagazine.com/rss.xml",                     // Fintech Magazine — B2B fintech

  // ── Chemicals ────────────────────────────────────────────────────────────
  "https://cen.acs.org/feeds/rss/topic/business.xml",       // C&EN Business — verified working
  "https://cen.acs.org/feeds/rss/latestnews.xml",           // C&EN Latest News
  "https://cen.acs.org/feeds/rss/topic/policy.xml",         // C&EN Policy — regulatory signals
  "https://cen.acs.org/feeds/rss/topic/synthesis.xml",      // C&EN Synthesis — R&D signals
  "https://www.chemweek.com/rss/rss.xml",                   // Chemical Week — pricing/supply chain
  "https://www.icis.com/explore/resources/news/rss/",       // ICIS — commodity chemicals pricing

  // ── Aerospace & Defense ──────────────────────────────────────────────────
  "https://www.defensenews.com/arc/outboundfeeds/rss/category/global/?outputType=xml",
  "https://www.defensenews.com/arc/outboundfeeds/rss/category/industry/?outputType=xml",
  "https://aviationweek.com/awn/rss-feed-by-content-source", // Aviation Week — aerospace industry
  "https://breakingdefense.com/feed/",                       // Breaking Defense — procurement/contracts
  "https://spacenews.com/feed/",                             // Space News — satellite/space commerce

  // ── Agriculture ──────────────────────────────────────────────────────────
  "https://agfundernews.com/feed",                           // AgFunder — agritech investment
  "https://agweek.com/index.rss",                            // AgWeek — crop/commodity news
  "https://brownfieldagnews.com/feed",                       // Brownfield Ag News — US farm markets
  "https://www.agriculture.com/rss",                         // Agriculture.com — broad coverage
  "https://www.farmprogress.com/rss.xml",                    // Farm Progress — precision ag trends

  // ── Food & Beverage ──────────────────────────────────────────────────────
  "https://www.foodnavigator.com/arc/outboundfeeds/rss/",   // Food Navigator — global F&B
  "https://www.beveragedaily.com/arc/outboundfeeds/rss/",   // Beverage Daily — drinks industry
  "https://www.foodbusinessnews.net/rss/articles",           // Food Business News — manufacturer focus
  "https://www.fooddive.com/feeds/news/",                    // Food Dive — M&A/supply chain
  "https://www.dairyfoods.com/rss/all",                      // Dairy Foods — sub-vertical depth

  // ── Retail & E-Commerce ──────────────────────────────────────────────────
  "https://www.retaildive.com/feeds/news/",                  // Retail Dive — market/strategy news
  "https://www.modernretail.co/feed/",                       // Modern Retail — DTC/e-commerce
  "https://www.emarketer.com/rss.xml",                       // EMARKETER — digital commerce data
  "https://www.chainstoreage.com/rss.xml",                   // Chain Store Age — retail ops

  // ── IT & Telecom (B2B only) ──────────────────────────────────────────────
  "https://www.lightreading.com/rss.xml",                    // Light Reading — telecom/5G
  "https://www.sdxcentral.com/feed/",                        // SDxCentral — network/cloud
  "https://www.networkworld.com/news/rss.xml",               // Network World — enterprise IT
  "https://www.datacenterdynamics.com/en/rss/",              // Data Center Dynamics — infrastructure

  // ── Global Tier-1 Business ───────────────────────────────────────────────
  "https://feeds.bloomberg.com/markets/news.rss",            // Bloomberg Markets
  "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", // WSJ Markets
  "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",          // Dow Jones Markets
  "https://www.marketwatch.com/rss/marketpulse",             // MarketWatch Pulse
  "https://feeds.content.dowjones.io/public/rss/mw_topstories", // MarketWatch Top Stories
  "https://www.reuters.com/rssFeed/businessNews",            // Reuters Business — direct feed
];
// Source name overrides for feeds whose RSS channel title is misleading or generic
const SOURCE_NAME_OVERRIDES: Record<string, string> = {
  // Global Tier-1
  "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain": "WSJ Markets",
  "https://feeds.a.dj.com/rss/RSSMarketsMain.xml": "WSJ Markets",
  "https://www.marketwatch.com/rss/marketpulse": "MarketWatch",
  "https://feeds.content.dowjones.io/public/rss/mw_topstories": "MarketWatch",
  "https://feeds.bloomberg.com/markets/news.rss": "Bloomberg Markets",
  "https://www.reuters.com/rssFeed/businessNews": "Reuters Business",
  // Chemicals
  "https://cen.acs.org/feeds/rss/topic/business.xml": "Chemical & Engineering News",
  "https://cen.acs.org/feeds/rss/latestnews.xml": "Chemical & Engineering News",
  "https://cen.acs.org/feeds/rss/topic/policy.xml": "Chemical & Engineering News",
  "https://cen.acs.org/feeds/rss/topic/synthesis.xml": "Chemical & Engineering News",
  "https://www.chemweek.com/rss/rss.xml": "Chemical Week",
  "https://www.icis.com/explore/resources/news/rss/": "ICIS",
  // Energy
  "https://www.pv-tech.org/feed/": "PV Tech",
  "https://www.energy-storage.news/feed/": "Energy Storage News",
  "https://www.rechargenews.com/rss": "Recharge News",
  "https://www.greentechmedia.com/rss/all": "Wood Mackenzie / GTM",
  // BFSI
  "https://www.americanbanker.com/arc/outboundfeeds/rss/": "American Banker",
  "https://www.tearsheet.co/feed": "Tearsheet",
  "https://www.pymnts.com/feed/": "PYMNTS",
  "https://www.thefinancialbrand.com/feed/": "The Financial Brand",
  "https://fintechmagazine.com/rss.xml": "Fintech Magazine",
  // Semiconductor
  "https://www.electronicdesign.com/rss.xml": "Electronic Design",
  "https://www.ednasia.com/rss.xml": "EDN Asia",
  // Automotive
  "https://www.autonews.com/rss.rss": "Automotive News",
  "https://www.wardsauto.com/rss.xml": "Wards Auto",
  "https://www.just-auto.com/feed/": "Just Auto",
  // Construction
  "https://www.bdcnetwork.com/rss.xml": "BD+C",
  "https://www.enr.com/rss/all": "Engineering News-Record",
  // Aerospace & Defense
  "https://breakingdefense.com/feed/": "Breaking Defense",
  "https://spacenews.com/feed/": "Space News",
  // Retail
  "https://www.modernretail.co/feed/": "Modern Retail",
  "https://www.emarketer.com/rss.xml": "EMARKETER",
  "https://www.chainstoreage.com/rss.xml": "Chain Store Age",
  // IT & Telecom
  "https://www.sdxcentral.com/feed/": "SDxCentral",
  "https://www.networkworld.com/news/rss.xml": "Network World",
  "https://www.datacenterdynamics.com/en/rss/": "Data Center Dynamics",
  // Pharma
  "https://www.pharmaceutical-technology.com/feed/": "Pharmaceutical Technology",
  "https://www.drugdiscoverytrends.com/feed/": "Drug Discovery Trends",
  // Food & Bev
  "https://www.fooddive.com/feeds/news/": "Food Dive",
  "https://www.dairyfoods.com/rss/all": "Dairy Foods",
  // Agriculture
  "https://www.agriculture.com/rss": "Agriculture.com",
  "https://www.farmprogress.com/rss.xml": "Farm Progress",
};
/**
 * Shared STABLE_RSS_FEEDS ingestion for /api/rss and /api/intelligence/run.
 * Maps feed items to RSSArticle (including description for downstream NLP).
 */
 // ════════════════════════════════════════════════════════════════════════════════
// NEWS API INTEGRATION — Kaiso Intelligence OS
// ════════════════════════════════════════════════════════════════════════════════
//
// SETUP REQUIRED:
// 1. Get free API key at newsapi.org (100 requests/day free)
// 2. Add to Render environment variables: NEWS_API_KEY = your_key_here
//
// HOW IT WORKS:
// - Runs 3 targeted queries per cycle covering all 14 Kaiso verticals
// - Results cached for 2 hours (prevents burning free tier quota)
// - Merges with RSS articles before Gemini analysis
// - Falls back to empty array silently if API key missing or limit reached
// ════════════════════════════════════════════════════════════════════════════════

const NEWS_API_KEY = process.env.NEWS_API_KEY || "";

// 3 grouped queries covering all 14 Kaiso verticals efficiently
// Each query returns up to 20 articles = 60 total per cycle
// Only 3 API calls per run = stays well within 100/day free limit
const NEWS_API_QUERIES = [
  {
    q: "semiconductor OR pharmaceutical OR biotech OR \"medical device\" OR \"clinical trial\" OR \"drug approval\"",
    label: "Healthcare & Semiconductor",
  },
  {
    q: "\"electric vehicle\" OR \"renewable energy\" OR \"energy storage\" OR fintech OR \"supply chain\" OR aerospace OR \"chemical industry\"",
    label: "Automotive & Energy & BFSI & Chemicals",
  },
  {
    q: "\"market growth\" OR \"industry report\" OR \"investment round\" OR acquisition OR regulation OR \"trade policy\" OR \"manufacturing expansion\"",
    label: "Cross-Vertical B2B Signals",
  },
];

// Simple 2-hour in-memory cache to protect free tier quota
const newsApiCache: {
  articles: RSSArticle[];
  fetchedAt: number;
} = {
  articles: [],
  fetchedAt: 0,
};

const NEWS_API_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
// ════════════════════════════════════════════════════════════════════════════════
// RSS RESULT CACHE — 30 minute cache prevents refetch on every "Start Research"
// Eliminates the 40-60 second wait when team clicks the button multiple times
// ════════════════════════════════════════════════════════════════════════════════
const RSS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds
const rssCache: {
  articles: RSSArticle[];
  successCount: number;
  failureCount: number;
  fetchedAt: number;
} = {
  articles: [],
  successCount: 0,
  failureCount: 0,
  fetchedAt: 0,
};

// In-flight lock: prevents concurrent RSS fetches causing race conditions
let rssIngestionInFlight: Promise<{ articles: RSSArticle[]; successCount: number; failureCount: number }> | null = null;

async function fetchNewsAPIArticles(): Promise<RSSArticle[]> {
  // Return cached results if still fresh
  if (
    newsApiCache.fetchedAt > 0 &&
    Date.now() - newsApiCache.fetchedAt < NEWS_API_CACHE_TTL
  ) {
    const ageMinutes = Math.round(
      (Date.now() - newsApiCache.fetchedAt) / 60000
    );
    console.log(
      `[NewsAPI] Using cached results (${newsApiCache.articles.length} articles, ${ageMinutes}m old)`
    );
    return newsApiCache.articles;
  }

  // Skip silently if no API key configured
  if (!NEWS_API_KEY) {
    console.log(
      "[NewsAPI] No NEWS_API_KEY configured — skipping. Add key in Render environment variables."
    );
    return [];
  }

  console.log("[NewsAPI] Fetching fresh articles for all Kaiso verticals...");

  const allArticles: RSSArticle[] = [];
  let successCount = 0;

  for (const queryConfig of NEWS_API_QUERIES) {
    try {
const fromDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('T')[0];
      const params = new URLSearchParams({
        q: queryConfig.q,
        language: "en",
        sortBy: "publishedAt",
        pageSize: "20",
        from: fromDate,
        apiKey: NEWS_API_KEY,
      });

      const url = `https://newsapi.org/v2/everything?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "KaisoIntelligenceOS/1.0",
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn("[NewsAPI] Rate limit reached. Will retry after cache TTL.");
          break;
        }
        if (response.status === 401) {
          console.error("[NewsAPI] Invalid API key. Check NEWS_API_KEY in Render variables.");
          break;
        }
        console.warn(`[NewsAPI] Query failed: ${queryConfig.label} — HTTP ${response.status}`);
        continue;
      }

      const data: any = await response.json();

      if (data.status !== "ok") {
        console.warn(`[NewsAPI] Query error: ${data.message || "unknown"}`);
        continue;
      }

      const articles: RSSArticle[] = (data.articles || [])
        .filter(
          (item: any) =>
            item.title &&
            item.url &&
            item.title !== "[Removed]" &&
            item.description !== "[Removed]" &&
            !item.url.includes("removed.com")
        )
        .map((item: any) => ({
          title: item.title || "",
          link: item.url || "",
          pubDate: item.publishedAt || new Date().toISOString(),
          description: (item.description || item.content || "").slice(0, 700),
          sourceName: item.source?.name || "NewsAPI",
          timestamp: item.publishedAt
            ? new Date(item.publishedAt).getTime()
            : Date.now(),
        }));

      allArticles.push(...articles);
      successCount++;
      console.log(
        `[NewsAPI] ✓ ${queryConfig.label}: ${articles.length} articles`
      );

      // Small delay between requests to be respectful to the API
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (err) {
      console.warn(
        `[NewsAPI] ✗ Query failed: ${queryConfig.label} —`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Deduplicate by URL
  const deduped = Array.from(
    new Map(allArticles.map((a) => [a.link, a])).values()
  ).sort((a, b) => b.timestamp - a.timestamp);

  // Update cache
  newsApiCache.articles = deduped;
  newsApiCache.fetchedAt = Date.now();

  console.log(
    `[NewsAPI] Complete: ${successCount}/${NEWS_API_QUERIES.length} queries, ${deduped.length} unique articles`
  );

  return deduped;
}
async function ingestStableRssFeeds(): Promise<{
  articles: RSSArticle[];
  successCount: number;
  failureCount: number;
}> {
// Return cached result if still fresh
  if (
    rssCache.fetchedAt > 0 &&
    Date.now() - rssCache.fetchedAt < RSS_CACHE_TTL
  ) {
    const ageMinutes = Math.round((Date.now() - rssCache.fetchedAt) / 60000);
    console.log(
      `[RSS] Using cached results (${rssCache.articles.length} articles, ${ageMinutes}m old)`
    );
    return {
      articles: rssCache.articles,
      successCount: rssCache.successCount,
      failureCount: rssCache.failureCount,
    };
  }

  // If a fetch is already running, wait for it — prevents race condition on first run
  if (rssIngestionInFlight) {
    console.log('[RSS] Ingestion already in progress — waiting for result...');
    return rssIngestionInFlight;
  }

console.log(`[RSS] Starting ingestion of ${STABLE_RSS_FEEDS.length} feeds...`);

  rssIngestionInFlight = (async () => {
  const [rssResults, newsApiArticles] = await Promise.all([
    Promise.allSettled(
      STABLE_RSS_FEEDS.map((feedUrl) =>
        parser.parseURL(feedUrl).catch((err) => {
          throw new Error(`Feed failed: ${feedUrl} - ${err.message}`);
        })
      )
    ),
    fetchNewsAPIArticles(),
  ]);

  const allArticles: RSSArticle[] = [];
  let successCount = 0;
  let failureCount = 0;

  rssResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const feed = result.value;
      successCount++;

const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      const items = (feed.items || []).map((item: any) => ({
        title: item.title || "",
        link: item.link || "",
        pubDate: item.pubDate || "",
        description: (item.contentSnippet || item.content || "").slice(0, 700),
        sourceName: SOURCE_NAME_OVERRIDES[STABLE_RSS_FEEDS[index]] || feed.title || "Unknown Source",
        timestamp: item.pubDate
          ? new Date(item.pubDate).getTime()
          : Date.now(),
      })).filter((item) => item.timestamp >= cutoff);

      allArticles.push(...items);
      console.log(
        `[RSS] ✓ ${feed.title || `Feed ${index}`}: ${items.length} articles`
      );
    } else {
      failureCount++;
      console.warn(
        `[RSS] ✗ Feed ${index} failed:`,
        result.reason?.message || result.reason
      );
    }
  });

  allArticles.push(...newsApiArticles);

  const deduped = Array.from(
    new Map(allArticles.map((a) => [a.link, a])).values()
  ).sort((a, b) => b.timestamp - a.timestamp);

  console.log(
    `[RSS] Ingestion complete: ${successCount}/${STABLE_RSS_FEEDS.length} RSS feeds + ${newsApiArticles.length} NewsAPI articles = ${deduped.length} unique total, ${failureCount} RSS failures`
  );

// Update RSS cache
  rssCache.articles = deduped;
  rssCache.successCount = successCount;
  rssCache.failureCount = failureCount;
  rssCache.fetchedAt = Date.now();

return { articles: deduped, successCount, failureCount };
  })();

  const result = await rssIngestionInFlight;
  rssIngestionInFlight = null;
  return result;
}

// ════════════════════════════════════════════════════════════════════════════════
// /api/rss — Server-side RSS aggregation endpoint
// ════════════════════════════════════════════════════════════════════════════════
app.get("/api/rss", async (_, res) => {
  try {
    const { articles, successCount, failureCount } = await ingestStableRssFeeds();

    res.json({
      success: true,
      count: articles.length,
      successCount,
      failureCount,
      articles,
    });
  } catch (error) {
    console.error("[RSS] Fatal error:", error);

    res.status(500).json({
      success: false,
      error: "RSS ingestion failed. Please try again.",
      articles: [],
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// LEGACY ENDPOINTS (maintained for backwards compatibility)
// ════════════════════════════════════════════════════════════════════════════════

// ---------- API ROUTES ----------

app.post("/api/intelligence/run", async (req, res) => {
  try {
    const { articles, watchlistTitles } = req.body;

    // Fetch RSS feeds and EDGAR signals in parallel — saves ~3-5s per run
    const [{ articles: rssArticles }, edgarSignals] = await Promise.all([
      ingestStableRssFeeds(),
      fetchEdgarSignals().catch((err) => {
        // EDGAR failure is non-fatal — pipeline continues with RSS only
        console.warn("[EDGAR] Fetch failed, continuing without EDGAR signals:", err);
        return [] as EDGARSignal[];
      }),
    ]);

    const bodyArticles = Array.isArray(articles) ? articles : [];
    const pipelineArticles =
      rssArticles.length > 0 ? rssArticles : bodyArticles;

    console.log(
      `[Pipeline] RSS: ${pipelineArticles.length} articles | EDGAR: ${edgarSignals.length} signals`
    );

    // Load persisted memory from disk instead of relying on browser state
    const persistedMemory = loadMemoryFromDisk();

    const state = await runIntelligencePipeline(
      pipelineArticles,
      watchlistTitles || [],
      persistedMemory,
      edgarSignals
    );

    // Save updated memory back to disk after every successful run
    if (state?.memoryState) {
      saveMemoryToDisk(state.memoryState);
    }

    // Enrich the final 8 suggestions with Google Trends data
    // Non-fatal: if Trends fails, suggestions are returned unchanged
    if (state?.curatedPortfolio?.length) {
      try {
        state.curatedPortfolio = await enrichWithTrends(state.curatedPortfolio);
      } catch (err) {
        console.warn('[Trends] Enrichment failed, continuing without trend data:', err);
      }
    }

    // Enrich the final 8 suggestions with competitor white space detection
    // Checks Grand View Research, MarketsandMarkets, Mordor Intelligence,
    // and Allied Market Research for existing coverage of each opportunity.
    // Non-fatal: if scrapes fail, suggestions are returned unchanged.
    if (state?.curatedPortfolio?.length) {
      try {
        state.curatedPortfolio = await enrichWithWhiteSpaceDetection(state.curatedPortfolio);
      } catch (err) {
        console.warn('[WhiteSpace] Enrichment failed, continuing without whitespace data:', err);
      }
    }

    // Final step: classify each opportunity as PUBLISH NOW / MONITOR / PASS
    // and sort the portfolio so PUBLISH NOW items always surface first.
    if (state?.curatedPortfolio?.length) {
      try {
        state.curatedPortfolio = classifyPortfolio(state.curatedPortfolio);
        const publishCount = state.curatedPortfolio.filter((s: any) => s.actionVerdict === 'PUBLISH NOW').length;
        const monitorCount = state.curatedPortfolio.filter((s: any) => s.actionVerdict === 'MONITOR').length;
        const passCount    = state.curatedPortfolio.filter((s: any) => s.actionVerdict === 'PASS').length;
        console.log(`[Action] Classification complete — ${publishCount} PUBLISH NOW, ${monitorCount} MONITOR, ${passCount} PASS`);
      } catch (err) {
        console.warn('[Action] Classification failed, continuing without verdicts:', err);
      }
    }

    res.json(state);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Intelligence pipeline failed. Please try again.",
    });
  }
});

app.post("/api/intelligence/brief", async (req, res) => {
  try {
    const { suggestion } = req.body;

    const brief = await generateFullBrief(suggestion);

    res.json({ brief });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Brief generation failed. Please try again.",
    });
  }
});

// ---------- BRIEF DOCX EXPORT ----------

app.post("/api/brief/export-docx", async (req, res) => {
  try {
    const { briefText, suggestion } = req.body;

    if (!briefText || !suggestion) {
      return res.status(400).json({ error: "briefText and suggestion are required." });
    }

    console.log("[DOCX] Generating brief export for:", suggestion.reportTitle?.substring(0, 60));

    const buffer = await generateBriefDocxBuffer(briefText, suggestion);

    const filename = `KAISO_Brief_${(suggestion.reportTitle as string || "Brief")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .substring(0, 60)}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);

    console.log(`[DOCX] Export complete: ${buffer.length} bytes`);
  } catch (error) {
    console.error("[DOCX] Export failed:", error);
    res.status(500).json({ error: "DOCX generation failed. Please try again." });
  }
});

// ---------- STATIC FRONTEND ----------

app.use(express.static("dist"));

app.get("*", (_, res) => {
  res.sendFile("index.html", {
    root: "dist",
  });
});

// ---------- START SERVER ----------

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Sets the timeout to 10 minutes (600,000 ms)
server.timeout = 600000; 
// These two lines prevent the connection from "stalling" while the AI thinks
server.keepAliveTimeout = 610000;
server.headersTimeout = 620000;
