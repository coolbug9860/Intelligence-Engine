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
import { fetchSamNoticeById } from "./src/services/samGovService";
import { fetchTedNotices } from "./src/services/tedService";
import { fetchUkFtsNotices } from "./src/services/ukFtsService";
import { fetchFederalRegisterNotices } from "./src/services/federalRegisterService";
import { fetchEpoPatents } from "./src/services/epoService";
import { assembleCombinedSignals } from "./src/services/ingestion/assembleIngestion";
import type { IngestionRecord } from "./src/services/ingestion/ingestionTypes";
import { generateBriefDocxBuffer } from "./src/services/briefExportServer";
import { enrichWithTrends } from "./src/services/trendsService";
import { enrichWithWhiteSpaceDetection } from "./src/services/serpOpportunityDetectionService";
import { classifyPortfolio } from "./src/services/actionClassificationEngine";
import { runCouncilReview } from "./src/services/councilEngine";
import {
  readLedger,
  upsertVerdict,
  runDueTrendChecks,
  computeVerticalCalibration,
} from "./src/services/outcomeLedger";

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
// Build the CORS allowlist. RENDER_EXTERNAL_URL is injected automatically by Render
// and always matches the live service URL, so the app works out-of-the-box on any
// Render deploy even when ALLOWED_ORIGIN is not set manually. ALLOWED_ORIGIN
// (comma-separated) can add extra origins, e.g. a custom domain. Trailing slashes
// are stripped so values like "https://x.onrender.com/" still match the browser's
// Origin header (which never includes a trailing slash).
const ALLOWED_ORIGINS = [
  process.env.RENDER_EXTERNAL_URL,
  ...(process.env.ALLOWED_ORIGIN ?? "").split(","),
]
  .map((o) => (o ?? "").trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Requests with no Origin header (same-origin navigations, curl, health checks)
    // are always allowed. Browser cross-origin requests must match the allowlist.
    if (!origin || ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ""))) {
      callback(null, true);
    } else {
      console.warn(
        `[CORS] Blocked request from origin: ${origin} ` +
        `(allowed: ${ALLOWED_ORIGINS.join(", ") || "none configured"})`
      );
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
// Re-audited 2026-06-06: removed 24 dead (403/404/401/timeout/malformed), 2 stale
// (>1yr old, redundant), and 2 undated (fiercepharma/biotech — no parseable dates,
// dropped by the freshness filter anyway). Added 14 Industry Dive + Electrek feeds,
// all verified live and fresh. Every URL below returned parseable, recent items.
const STABLE_RSS_FEEDS = [

  // ── Healthcare & Pharma ──────────────────────────────────────────────────
  "https://www.statnews.com/feed/",                           // STAT News — pharma/biotech journalism
  "https://www.biopharmadive.com/feeds/news/",               // BioPharma Dive — M&A, regulatory
  "https://endpoints.news/feed/",                             // Endpoints News — clinical/regulatory
  "https://health.economictimes.indiatimes.com/rss/lateststories", // ET Health — Asia market signals
  "https://pharma.economictimes.indiatimes.com/rss/lateststories", // ET Pharma — India manufacturing
  "https://www.drugdiscoverytrends.com/feed/",               // DDT — early pipeline signals
  "https://www.healthcaredive.com/feeds/news/",              // Healthcare Dive — provider/payer markets
  "https://www.medtechdive.com/feeds/news/",                 // MedTech Dive — medical devices/diagnostics

  // ── Semiconductor & Electronics ──────────────────────────────────────────
  "https://semiengineering.com/feed/",                        // Semiconductor Engineering — deep technical
  "https://www.eetimes.com/feed",                             // EE Times — broad electronics coverage
  "https://semiconductor-today.com/rss/news.xml",            // Semiconductor Today — industry news
  "https://www.electronicdesign.com/rss.xml",                // Electronic Design — engineering/design

  // ── Construction ─────────────────────────────────────────────────────────
  "https://www.constructiondive.com/feeds/news/",            // Construction Dive — project/market news
  "https://www.smartcitiesdive.com/feeds/news/",             // Smart Cities Dive — infrastructure/urban

  // ── Automotive ───────────────────────────────────────────────────────────
  "https://auto.economictimes.indiatimes.com/rss/industry",  // ET Auto — global supply chain signals
  "https://auto.economictimes.indiatimes.com/rss/auto-technology", // ET Auto — EV/tech signals
  "https://www.automotivedive.com/feeds/news/",              // Automotive Dive — OEM/EV market news

  // ── Energy & Cleantech ───────────────────────────────────────────────────
  "https://cleantechnica.com/feed/",                         // CleanTechnica — EV/solar/storage
  "https://www.pv-tech.org/feed/",                           // PV Tech — solar industry
  "https://www.energy-storage.news/feed/",                   // Energy Storage News — battery/grid
  "https://www.utilitydive.com/feeds/news/",                 // Utility Dive — grid/power markets
  "https://electrek.co/feed/",                               // Electrek — EV/clean energy

  // ── BFSI & Fintech ────────────────────────────────────────────────────────
  "https://www.tearsheet.co/feed",                           // Tearsheet — fintech/banking transformation
  "https://www.bankingdive.com/feeds/news/",                 // Banking Dive — institutional finance
  "https://www.paymentsdive.com/feeds/news/",                // Payments Dive — payments industry
  "https://www.cfodive.com/feeds/news/",                     // CFO Dive — corporate finance/treasury

  // ── Chemicals ────────────────────────────────────────────────────────────
  "https://cen.acs.org/feeds/rss/topic/business.xml",       // C&EN Business
  "https://cen.acs.org/feeds/rss/latestnews.xml",           // C&EN Latest News
  "https://cen.acs.org/feeds/rss/topic/policy.xml",         // C&EN Policy — regulatory signals
  "https://cen.acs.org/feeds/rss/topic/synthesis.xml",      // C&EN Synthesis — R&D signals

  // ── Aerospace & Defense ──────────────────────────────────────────────────
  "https://www.defensenews.com/arc/outboundfeeds/rss/category/global/?outputType=xml",
  "https://www.defensenews.com/arc/outboundfeeds/rss/category/industry/?outputType=xml",
  "https://aviationweek.com/awn/rss-feed-by-content-source", // Aviation Week — aerospace industry
  "https://spacenews.com/feed/",                             // Space News — satellite/space commerce

  // ── Agriculture ──────────────────────────────────────────────────────────
  "https://agfundernews.com/feed",                           // AgFunder — agritech investment
  "https://agweek.com/index.rss",                            // AgWeek — crop/commodity news
  "https://brownfieldagnews.com/feed",                       // Brownfield Ag News — US farm markets
  "https://www.farmprogress.com/rss.xml",                    // Farm Progress — precision ag trends

  // ── Food & Beverage ──────────────────────────────────────────────────────
  "https://www.foodnavigator.com/arc/outboundfeeds/rss/",   // Food Navigator — global F&B
  "https://www.beveragedaily.com/arc/outboundfeeds/rss/",   // Beverage Daily — drinks industry
  "https://www.foodbusinessnews.net/rss/articles",           // Food Business News — manufacturer focus
  "https://www.fooddive.com/feeds/news/",                    // Food Dive — M&A/supply chain
  "https://www.grocerydive.com/feeds/news/",                 // Grocery Dive — grocery retail/CPG

  // ── Retail & E-Commerce ──────────────────────────────────────────────────
  "https://www.retaildive.com/feeds/news/",                  // Retail Dive — market/strategy news
  "https://www.modernretail.co/feed/",                       // Modern Retail — DTC/e-commerce
  "https://www.supplychaindive.com/feeds/news/",             // Supply Chain Dive — logistics/fulfillment

  // ── IT & Telecom (B2B only) ──────────────────────────────────────────────
  "https://www.lightreading.com/rss.xml",                    // Light Reading — telecom/5G
  "https://www.datacenterdynamics.com/en/rss/",              // Data Center Dynamics — infrastructure
  "https://www.ciodive.com/feeds/news/",                     // CIO Dive — enterprise IT
  "https://www.cybersecuritydive.com/feeds/news/",           // Cybersecurity Dive — security spend

  // ── Industrial / Cross-Vertical ──────────────────────────────────────────
  "https://www.manufacturingdive.com/feeds/news/",           // Manufacturing Dive — industrial/reshoring

  // ── Global Tier-1 Business ───────────────────────────────────────────────
  "https://feeds.bloomberg.com/markets/news.rss",            // Bloomberg Markets
  "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", // WSJ Markets
  "https://feeds.content.dowjones.io/public/rss/mw_topstories", // MarketWatch Top Stories
];
// Source name overrides for feeds whose RSS channel title is misleading or generic
const SOURCE_NAME_OVERRIDES: Record<string, string> = {
  // Global Tier-1
  "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain": "WSJ Markets",
  "https://feeds.content.dowjones.io/public/rss/mw_topstories": "MarketWatch",
  "https://feeds.bloomberg.com/markets/news.rss": "Bloomberg Markets",
  // Chemicals
  "https://cen.acs.org/feeds/rss/topic/business.xml": "Chemical & Engineering News",
  "https://cen.acs.org/feeds/rss/latestnews.xml": "Chemical & Engineering News",
  "https://cen.acs.org/feeds/rss/topic/policy.xml": "Chemical & Engineering News",
  "https://cen.acs.org/feeds/rss/topic/synthesis.xml": "Chemical & Engineering News",
  // Energy
  "https://www.pv-tech.org/feed/": "PV Tech",
  "https://www.energy-storage.news/feed/": "Energy Storage News",
  "https://www.utilitydive.com/feeds/news/": "Utility Dive",
  "https://electrek.co/feed/": "Electrek",
  // BFSI & Fintech
  "https://www.tearsheet.co/feed": "Tearsheet",
  "https://www.bankingdive.com/feeds/news/": "Banking Dive",
  "https://www.paymentsdive.com/feeds/news/": "Payments Dive",
  "https://www.cfodive.com/feeds/news/": "CFO Dive",
  // Semiconductor
  "https://www.electronicdesign.com/rss.xml": "Electronic Design",
  // Automotive
  "https://www.automotivedive.com/feeds/news/": "Automotive Dive",
  // Construction
  "https://www.smartcitiesdive.com/feeds/news/": "Smart Cities Dive",
  // Aerospace & Defense
  "https://spacenews.com/feed/": "Space News",
  // Retail & Logistics
  "https://www.modernretail.co/feed/": "Modern Retail",
  "https://www.supplychaindive.com/feeds/news/": "Supply Chain Dive",
  // IT & Telecom
  "https://www.datacenterdynamics.com/en/rss/": "Data Center Dynamics",
  "https://www.ciodive.com/feeds/news/": "CIO Dive",
  "https://www.cybersecuritydive.com/feeds/news/": "Cybersecurity Dive",
  // Industrial
  "https://www.manufacturingdive.com/feeds/news/": "Manufacturing Dive",
  // Healthcare & Pharma
  "https://www.drugdiscoverytrends.com/feed/": "Drug Discovery Trends",
  "https://www.healthcaredive.com/feeds/news/": "Healthcare Dive",
  "https://www.medtechdive.com/feeds/news/": "MedTech Dive",
  // Food & Bev
  "https://www.fooddive.com/feeds/news/": "Food Dive",
  "https://www.grocerydive.com/feeds/news/": "Grocery Dive",
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

const now = Date.now();
      const cutoff = now - 48 * 60 * 60 * 1000;
      // Allow 1h of clock skew, but reject articles dated further in the future.
      // Some feeds (e.g. Aviation Week event announcements) publish forward-dated
      // items; without this guard they get a future timestamp, sort to the very top
      // of the feed, and render as "JUST NOW" every session until the date passes.
      const futureCutoff = now + 60 * 60 * 1000;
      const items = (feed.items || []).map((item: any) => {
        // Prefer rss-parser's normalized isoDate; fall back to raw pubDate.
        const rawDate = item.isoDate || item.pubDate || "";
        const parsed = rawDate ? new Date(rawDate).getTime() : NaN;
        return {
          title: item.title || "",
          link: item.link || "",
          pubDate: rawDate,
          description: (item.contentSnippet || item.content || "").slice(0, 700),
          sourceName: SOURCE_NAME_OVERRIDES[STABLE_RSS_FEEDS[index]] || feed.title || "Unknown Source",
          timestamp: parsed,
        };
      }).filter((item) =>
        // Drop undated/unparseable items instead of stamping them Date.now()
        // (that faked freshness), and drop future-dated items (the "JUST NOW" bug).
        Number.isFinite(item.timestamp) &&
        item.timestamp >= cutoff &&
        item.timestamp <= futureCutoff
      );

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
    const { articles, watchlistTitles, previousMemory } = req.body;

    // ── Phase 0: Ingestion — single request-triggered, in-process fan-out ──
    // Promise.allSettled isolates per-source failure: one connector down can
    // never abort the cycle. Each connector is already non-fatal internally;
    // settledOr handles the rare hard rejection too.
    const settled = await Promise.allSettled([
      ingestStableRssFeeds(),          // 0 — RSS + NewsAPI
      fetchEdgarSignals(),             // 1 — SEC EDGAR
      fetchTedNotices(),               // 2 — EU TED
      fetchUkFtsNotices(),             // 3 — UK FTS + Contracts Finder
      fetchFederalRegisterNotices(),   // 4 — US Federal Register (SAM watchlist source)
      fetchEpoPatents(),               // 5 — EU EPO patents
    ]);

    function settledOr<T>(r: PromiseSettledResult<T>, fallback: T, label: string): T {
      if (r.status === "fulfilled") return r.value;
      console.warn(`[Ingestion] ${label} connector rejected (non-fatal):`, r.reason);
      return fallback;
    }

    const rssArticles: RSSArticle[] =
      settled[0].status === "fulfilled" ? (settled[0].value.articles ?? []) : [];
    if (settled[0].status === "rejected") {
      console.warn("[Ingestion] RSS connector rejected (non-fatal):", settled[0].reason);
    }
    const edgarSignals  = settledOr<EDGARSignal[]>(settled[1], [], "EDGAR");
    const tedRecords    = settledOr<IngestionRecord[]>(settled[2], [], "EU-TED");
    const ukFtsRecords  = settledOr<IngestionRecord[]>(settled[3], [], "UK-FTS");
    const fedRegRecords = settledOr<IngestionRecord[]>(settled[4], [], "US-FederalRegister");
    const epoRecords    = settledOr<IngestionRecord[]>(settled[5], [], "EU-EPO");

    // ── Local zero-LLM keyword gate, watchlist hand-off, adapter merge ─────
    // All assembly logic lives in the pure, tested `assembleCombinedSignals`
    // helper (Task 8.1). SAM lookups are injected so the quota gate is honoured.
    const bodyArticles = Array.isArray(articles) ? articles : [];
    const pipelineArticles =
      rssArticles.length > 0 ? rssArticles : bodyArticles;
    const rejectedCount = settled.filter((s) => s.status === "rejected").length;

    const assembled = await assembleCombinedSignals({
      rssArticleCount: pipelineArticles.length,
      edgarSignals,
      tedRecords,
      ukFtsRecords,
      fedRegRecords,
      epoRecords,
      rejectedCount,
      samLookup: fetchSamNoticeById,
    });
    const combinedSignals = assembled.combinedSignals;

    // ── Observability: distinguish PARTIAL SUCCESS from TOTAL FAILURE ──────
    if (assembled.status === "TOTAL_FAILURE") {
      console.error("[Ingestion] TOTAL FAILURE — no source returned data this cycle; pipeline will run empty.");
    } else if (assembled.status === "PARTIAL_SUCCESS") {
      console.warn(
        `[Ingestion] PARTIAL SUCCESS — ${assembled.stats.sourcesWithData}/5 external sources returned data (${rejectedCount} hard-rejected). Pipeline continues.`
      );
    } else {
      console.log("[Ingestion] FULL SUCCESS — all external sources returned data.");
    }
    if (assembled.watchlistIds.length > 0) {
      console.log(
        `[Watchlist] FedReg surfaced ${assembled.watchlistIds.length} solicitation ID(s); SAM returned ${assembled.samSignalCount} notice(s).`
      );
    }

    const st = assembled.stats;
    console.log(
      `[Pipeline] RSS: ${pipelineArticles.length} | EDGAR: ${st.edgar} | TED: ${st.ted} | ` +
      `UK-FTS: ${st.ukFts} | FedReg: ${st.fedReg} | EPO: ${st.epo} | ` +
      `gated→signals: ${st.gatedSignals} | SAM: ${st.sam}`
    );

    // Memory durability: /tmp is wiped on every Render redeploy and cold start,
    // so it loses novelty-suppression history. The browser persists memoryState
    // in localStorage (durable across restarts) and sends it as `previousMemory`.
    // Prefer the browser copy when it is at least as rich as the /tmp copy; fall
    // back to disk for a fresh browser on a still-warm instance.
    const diskMemory = loadMemoryFromDisk();
    const clientCycles = previousMemory?.cycles?.length ?? 0;
    const diskCycles = diskMemory?.cycles?.length ?? 0;
    const persistedMemory = clientCycles >= diskCycles ? (previousMemory ?? diskMemory) : diskMemory;
    console.log(`[Memory] Using ${clientCycles >= diskCycles && previousMemory ? 'browser' : 'disk'} memory (browser: ${clientCycles} cycles, disk: ${diskCycles} cycles).`);

    // Ground-truth calibration: derive bounded per-vertical multipliers from
    // real recorded outcomes (sell-through rate). Non-fatal — an empty map means
    // neutral 1.0 scoring everywhere until enough verdicts accumulate.
    const calibration = await computeVerticalCalibration().catch((err) => {
      console.warn('[Calibration] Failed to compute, using neutral scoring:', err);
      return {};
    });
    if (Object.keys(calibration).length) {
      console.log('[Calibration] Applying vertical multipliers:', calibration);
    }

    const state = await runIntelligencePipeline(
      pipelineArticles,
      watchlistTitles || [],
      persistedMemory,
      combinedSignals,
      calibration
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

    // Enrich the final suggestions with SERP-based competitor white space
    // detection (serpOpportunityDetectionService): validates each opportunity
    // keyword against real search results via the Tavily provider, counts
    // distinct competing report domains, and maps to the whiteSpace* contract.
    // Non-fatal: on any failure or missing credential, suggestions return with
    // whiteSpaceStatus UNKNOWN rather than breaking the pipeline.
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

    // Council Review (advisory-only): a Gemini "second opinion" on borderline
    // (MONITOR) opportunities — Skeptic + Buyer + Chairman in a single call each.
    // Purely additive: it attaches a councilReview annotation and NEVER alters
    // scores or verdicts. Non-fatal — on any failure the portfolio is unchanged.
    if (state?.curatedPortfolio?.length) {
      try {
        state.curatedPortfolio = await runCouncilReview(state.curatedPortfolio);
      } catch (err) {
        console.warn('[Council] Review failed, continuing without advisory notes:', err);
      }
    }

    // Ground-truth trend loop: fire the 30/60/90-day re-checks for any due
    // ledger records. Fire-and-forget so the slow Google Trends polling never
    // delays the pipeline response; bounded internally to a small batch per run.
    void runDueTrendChecks()
      .then(({ checked }) => {
        if (checked) console.log(`[Ledger] Trend checkpoint sweep recorded ${checked} check(s).`);
      })
      .catch((err) => console.warn('[Ledger] Trend sweep failed (non-fatal):', err));

    res.json(state);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Intelligence pipeline failed. Please try again.",
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GROUND-TRUTH OUTCOME LEDGER — commercial verdict capture + read
// Auth + general rate limit already applied by the /api middleware above.
// ════════════════════════════════════════════════════════════════════════════════
app.post("/api/outcomes/verdict", async (req, res) => {
  try {
    const {
      opportunityId,
      verdict,
      vertical,
      marketKeyword,
      reportTitle,
      strategicPillar,
      opportunityScore,
      trendScore,
      trendDirection,
      verdictNote,
    } = req.body || {};

    const VALID_VERDICTS = ["COMMISSIONED", "SOLD", "PASSED", "PENDING"];
    if (
      !opportunityId ||
      !VALID_VERDICTS.includes(verdict) ||
      !vertical ||
      !marketKeyword ||
      !reportTitle
    ) {
      return res.status(400).json({
        error:
          "opportunityId, a valid verdict (COMMISSIONED|SOLD|PASSED|PENDING), vertical, marketKeyword, and reportTitle are required.",
      });
    }

    const records = await upsertVerdict({
      opportunityId,
      verdict,
      vertical,
      marketKeyword,
      reportTitle,
      strategicPillar,
      opportunityScoreAtSurface:
        typeof opportunityScore === "number" ? opportunityScore : undefined,
      trendBaseline: typeof trendScore === "number" ? trendScore : undefined,
      trendDirectionPredicted: trendDirection,
      verdictNote,
    });

    const record = records.find((r) => r.opportunityId === opportunityId);
    console.log(`[Outcomes] Recorded ${verdict} for ${opportunityId} (${vertical}).`);
    return res.json({ success: true, record });
  } catch (err) {
    console.error("[Outcomes] Verdict capture failed:", err);
    return res.status(500).json({ error: "Failed to record verdict." });
  }
});

app.get("/api/outcomes", async (_req, res) => {
  try {
    const records = await readLedger();
    return res.json({ success: true, count: records.length, records });
  } catch (err) {
    console.error("[Outcomes] Ledger read failed:", err);
    return res.status(500).json({ error: "Failed to read outcome ledger." });
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
