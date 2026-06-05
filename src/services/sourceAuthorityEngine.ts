import { ReportSuggestion } from "../types";

type SourceProfile = {
  score: number;
  tier: "Institutional" | "Major Media" | "Industry" | "Blog" | "Unknown";
};

const SOURCE_AUTHORITY: Record<string, SourceProfile> = {
  // Tier 1: Institutional
  Reuters:              { score: 95, tier: "Institutional" },
  Bloomberg:            { score: 94, tier: "Institutional" },
  "Wall Street Journal": { score: 94, tier: "Institutional" },
  "Financial Times":    { score: 93, tier: "Institutional" },
  "S&P Global":         { score: 90, tier: "Institutional" },

  // Tier 2: Major Media
  CNBC:                    { score: 88, tier: "Major Media" },
  "MIT Technology Review": { score: 88, tier: "Major Media" },
  MarketWatch:             { score: 82, tier: "Major Media" },
  Forbes:                  { score: 85, tier: "Major Media" },
  "Yahoo Finance":         { score: 72, tier: "Major Media" },

  // Healthcare & Pharma
  "STAT News":       { score: 86, tier: "Industry" },
  FiercePharma:      { score: 84, tier: "Industry" },
  FierceBiotech:     { score: 83, tier: "Industry" },
  "BioPharma Dive":  { score: 82, tier: "Industry" },
  "Endpoints News":  { score: 80, tier: "Industry" },

  // Semiconductor & Electronics
  "Semiconductor Engineering": { score: 85, tier: "Industry" },
  "EE Times":                  { score: 84, tier: "Industry" },
  "Semiconductor Today":       { score: 76, tier: "Industry" },

  // Energy & Cleantech
  CleanTechnica:          { score: 78, tier: "Industry" },
  "Renewable Energy World": { score: 77, tier: "Industry" },
  Electrek:               { score: 76, tier: "Industry" },

  // BFSI & Fintech
  Finextra:        { score: 85, tier: "Industry" },
  "Banking Dive":  { score: 80, tier: "Industry" },
  "Payments Dive": { score: 79, tier: "Industry" },

  // Automotive
  "Automotive IQ": { score: 78, tier: "Industry" },

  // Construction
  "Construction Dive": { score: 80, tier: "Industry" },

  // Agriculture
  "AgFunder News": { score: 78, tier: "Industry" },

  // Food & Beverage
  FoodNavigator:      { score: 77, tier: "Industry" },
  "Beverage Industry": { score: 74, tier: "Industry" },
  BeverageDaily:      { score: 73, tier: "Industry" },

  // Retail & E-Commerce
  "Retail Dive": { score: 80, tier: "Industry" },

  // Aerospace & Defense
  "Defense News": { score: 82, tier: "Industry" },

  // IT & Telecom B2B
  "Light Reading": { score: 78, tier: "Industry" },
  CIO:             { score: 76, tier: "Industry" },

  // India B2B (Economic Times verticals)
  "ET Healthworld": { score: 74, tier: "Industry" },
  "ET Pharma":      { score: 74, tier: "Industry" },
  "ET Auto":        { score: 74, tier: "Industry" },
  "ET BFSI":        { score: 75, tier: "Industry" },

  // General B2B
  "Business Wire": { score: 82, tier: "Industry" },
  TechCrunch:      { score: 78, tier: "Industry" },
  VentureBeat:     { score: 76, tier: "Industry" },
  CoinDesk:        { score: 74, tier: "Industry" },
  "Seeking Alpha": { score: 68, tier: "Industry" },

  // Blog / Unknown
  Medium:  { score: 55, tier: "Blog" },
  Unknown: { score: 50, tier: "Unknown" },
};

function detectSourceProfile(sourceName: string): SourceProfile {
  const n = sourceName.toLowerCase();

  if (n.includes("reuters"))                                   return SOURCE_AUTHORITY["Reuters"];
  if (n.includes("bloomberg"))                                 return SOURCE_AUTHORITY["Bloomberg"];
  if (n.includes("wall street journal") || n.includes("wsj")) return SOURCE_AUTHORITY["Wall Street Journal"];
  if (n.includes("financial times") || n.includes("ft.com"))  return SOURCE_AUTHORITY["Financial Times"];
  if (n.includes("s&p global") || n.includes("spglobal"))     return SOURCE_AUTHORITY["S&P Global"];
  if (n.includes("cnbc"))                                      return SOURCE_AUTHORITY["CNBC"];
  if (n.includes("mit technology") || n.includes("mit tech"))  return SOURCE_AUTHORITY["MIT Technology Review"];
  if (n.includes("marketwatch"))                               return SOURCE_AUTHORITY["MarketWatch"];
  if (n.includes("forbes"))                                    return SOURCE_AUTHORITY["Forbes"];
  if (n.includes("yahoo"))                                     return SOURCE_AUTHORITY["Yahoo Finance"];

  // Healthcare
  if (n.includes("stat news") || n.includes("statnews"))       return SOURCE_AUTHORITY["STAT News"];
  if (n.includes("fiercepharma"))                              return SOURCE_AUTHORITY["FiercePharma"];
  if (n.includes("fiercebiotech"))                             return SOURCE_AUTHORITY["FierceBiotech"];
  if (n.includes("biopharma dive"))                            return SOURCE_AUTHORITY["BioPharma Dive"];
  if (n.includes("endpoints"))                                 return SOURCE_AUTHORITY["Endpoints News"];

  // Semiconductor
  if (n.includes("semiconductor engineering") || n.includes("semiengineering")) return SOURCE_AUTHORITY["Semiconductor Engineering"];
  if (n.includes("ee times") || n.includes("eetimes"))         return SOURCE_AUTHORITY["EE Times"];
  if (n.includes("semiconductor today"))                       return SOURCE_AUTHORITY["Semiconductor Today"];

  // Energy
  if (n.includes("cleantechnica"))                             return SOURCE_AUTHORITY["CleanTechnica"];
  if (n.includes("renewable energy world"))                    return SOURCE_AUTHORITY["Renewable Energy World"];
  if (n.includes("electrek"))                                  return SOURCE_AUTHORITY["Electrek"];

  // BFSI
  if (n.includes("finextra"))                                  return SOURCE_AUTHORITY["Finextra"];
  if (n.includes("banking dive"))                              return SOURCE_AUTHORITY["Banking Dive"];
  if (n.includes("payments dive"))                             return SOURCE_AUTHORITY["Payments Dive"];

  // Automotive
  if (n.includes("automotive iq"))                             return SOURCE_AUTHORITY["Automotive IQ"];

  // Construction
  if (n.includes("construction dive"))                         return SOURCE_AUTHORITY["Construction Dive"];

  // Agriculture
  if (n.includes("agfunder"))                                  return SOURCE_AUTHORITY["AgFunder News"];

  // Food & Beverage
  if (n.includes("foodnavigator"))                             return SOURCE_AUTHORITY["FoodNavigator"];
  if (n.includes("beverage industry"))                         return SOURCE_AUTHORITY["Beverage Industry"];
  if (n.includes("beveragedaily"))                             return SOURCE_AUTHORITY["BeverageDaily"];

  // Retail
  if (n.includes("retail dive"))                               return SOURCE_AUTHORITY["Retail Dive"];

  // Defense
  if (n.includes("defense news"))                              return SOURCE_AUTHORITY["Defense News"];

  // IT & Telecom
  if (n.includes("light reading"))                             return SOURCE_AUTHORITY["Light Reading"];
  if (n.includes("cio"))                                       return SOURCE_AUTHORITY["CIO"];

  // Economic Times verticals
  if (n.includes("et healthworld") || n.includes("economictimes") && n.includes("health")) return SOURCE_AUTHORITY["ET Healthworld"];
  if (n.includes("et pharma") || n.includes("economictimes") && n.includes("pharma"))      return SOURCE_AUTHORITY["ET Pharma"];
  if (n.includes("et auto") || n.includes("economictimes") && n.includes("auto"))          return SOURCE_AUTHORITY["ET Auto"];
  if (n.includes("et bfsi") || n.includes("economictimes") && n.includes("bfsi"))          return SOURCE_AUTHORITY["ET BFSI"];

  // General
  if (n.includes("business wire"))                             return SOURCE_AUTHORITY["Business Wire"];
  if (n.includes("techcrunch"))                                return SOURCE_AUTHORITY["TechCrunch"];
  if (n.includes("venturebeat"))                               return SOURCE_AUTHORITY["VentureBeat"];
  if (n.includes("coindesk"))                                  return SOURCE_AUTHORITY["CoinDesk"];
  if (n.includes("seeking alpha"))                             return SOURCE_AUTHORITY["Seeking Alpha"];
  if (n.includes("medium"))                                    return SOURCE_AUTHORITY["Medium"];

  return SOURCE_AUTHORITY["Unknown"];
}

const SIGNAL_TYPE_MULTIPLIER: Record<string, number> = {
  "Regulatory":       1.15,
  "VC/PE Funding":    1.10,
  "Patent Filing":    1.08,
  "Trade Publication": 1.03,
  "General News":     1.00,
};

export function normalizeSourceAuthority(
  suggestion: ReportSuggestion
): ReportSuggestion {
  const sourceName = suggestion.sourceName?.trim() || "Unknown";
  const profile = detectSourceProfile(sourceName);

  const url = (suggestion.sourceArticleUrl || "").toLowerCase();
  const domain = sourceName.toLowerCase().replace(/\s+/g, "");
  const sourceDomainMatch =
    url.includes(domain) || profile.tier === "Unknown";

  const geminiScore = suggestion.credibilityScore || 0;
  const finalCredibility = sourceDomainMatch
    ? geminiScore
    : Math.round(geminiScore * 0.6);

  const blendedScore =
    finalCredibility > 0
      ? Math.round(finalCredibility * 0.6 + profile.score * 0.4)
      : profile.score;

  const signalMultiplier = SIGNAL_TYPE_MULTIPLIER[suggestion.signalType || "General News"] ?? 1.00;
  const finalScore = Math.min(100, Math.round(blendedScore * signalMultiplier));

  return {
    ...suggestion,
    credibilityScore: finalScore,
    sourceDomainMatch,
    veracityRationale:
      suggestion.veracityRationale ||
      `Source classified as ${profile.tier} tier media.`,
  };
}
