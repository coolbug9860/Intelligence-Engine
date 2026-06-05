import { ReportSuggestion } from "../types";

// ─────────────────────────────────────────────────────────────
// Canonical Market Keyword Mapping
// Maps semantically duplicated AI outputs into stable taxonomy.
// ─────────────────────────────────────────────────────────────

const MARKET_KEYWORD_MAP: Record<string, string> = {

  // Energy / Infrastructure
  "Industrial Fuel Supply Chain Risk": "Energy Supply Chain Resilience",
  "Industrial Energy Security": "Energy Security",
  "Energy Infrastructure Resilience": "Energy Security",
  "Maritime Energy Logistics": "Energy Logistics",
  "Grid Infrastructure Resilience": "Grid Infrastructure",

  // Semiconductor
  "AI Semiconductor Sovereignty": "Semiconductor Supply Chain",
  "Chip Supply Chain Decoupling": "Semiconductor Supply Chain",

  // Critical Minerals
  "Critical Mineral Protectionism": "Critical Minerals Supply Chain",
  "Rare Earth Trade Security": "Critical Minerals Supply Chain",

  // Automotive / EV
  "EV Battery Localization": "Battery Supply Chain",
  "Battery Manufacturing Sovereignty": "Battery Supply Chain",

  // Healthcare
  "Biopharma Manufacturing Resilience": "Pharmaceutical Supply Chain",

  // Logistics
  "Industrial Logistics Disruption": "Supply Chain Resilience"
};

// ─────────────────────────────────────────────────────────────
// Thematic Cluster Normalization
// ─────────────────────────────────────────────────────────────

const THEMATIC_CLUSTER_MAP: Record<string, string> = {

  "Industrial Decarbonization Supercycle": "Industrial Decarbonization",

  "Critical Energy Protectionism": "Energy Protectionism",

  "AI Compute Sovereignty": "AI Infrastructure Sovereignty",

  "Strategic Rare Earth Nationalism": "Critical Mineral Protectionism"
};

// ─────────────────────────────────────────────────────────────
// Vertical Normalization
// ─────────────────────────────────────────────────────────────

const VERTICAL_MAP: Record<string, string> = {

  "Energy & Utilities": "Energy",

  "Banking": "BFSI",

  "Retail": "Retail & E-Commerce",

  "Telecommunications": "IT & Telecom",

  "Healthcare & Life Sciences": "Healthcare"
};

// ─────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────

function normalizeValue(
  value: string,
  mapping: Record<string, string>
): string {
  if (!value) return value;

  const normalized = Object.entries(mapping).find(
    ([key]) => key.toLowerCase() === value.toLowerCase()
  );

  return normalized ? normalized[1] : value;
}

// ─────────────────────────────────────────────────────────────
// Main Engine
// ─────────────────────────────────────────────────────────────

export function normalizeSuggestion(
  suggestion: ReportSuggestion
): ReportSuggestion {

  return {

    ...suggestion,

    marketKeyword: normalizeValue(
      suggestion.marketKeyword,
      MARKET_KEYWORD_MAP
    ),

    thematicCluster: normalizeValue(
      suggestion.thematicCluster,
      THEMATIC_CLUSTER_MAP
    ),

    vertical: normalizeValue(
      suggestion.vertical,
      VERTICAL_MAP
    ) as any
  };
}
