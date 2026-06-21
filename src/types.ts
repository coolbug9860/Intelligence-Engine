export type Vertical =
  | 'Healthcare'
  | 'Electronics'
  | 'Semiconductor'
  | 'Automotive'
  | 'Chemicals'
  | 'Energy'
  | 'Fintech'
  | 'Aerospace'
  | 'BFSI'
  | 'Food & Beverage'
  | 'Construction'
  | 'Agriculture'
  | 'Retail & E-Commerce'
  | 'IT & Telecom';

export const VERTICALS: Vertical[] = [
  'Healthcare', 'Electronics', 'Semiconductor', 'Automotive', 'Chemicals',
  'Energy', 'Fintech', 'Aerospace', 'BFSI', 'Food & Beverage',
  'Construction', 'Agriculture', 'Retail & E-Commerce', 'IT & Telecom'
];

export type StrategicPillar =
  | 'Regulatory Trigger'
  | 'M&A / Corporate Activity'
  | 'Technology Disruption'
  | 'Supply Chain Decoupling'
  | 'Geographic Demand Shift'
  | 'Patent / IP Filing'
  | 'Clinical / Scientific Breakthrough'
  | 'Competitor White Space'
  | 'Emerging Application'
  | 'ESG / Sustainability Mandate'
  | 'Investment Surge'
  | 'Consumer Behavior Shift'
  | 'Cross-Vertical Convergence';

export interface EDGARSignal {
  title: string;          // Filing company + form type, e.g. "Apple Inc — 10-K"
  filingType: string;     // "10-K" | "10-Q" | "8-K"
  companyName: string;
  filingDate: string;     // ISO date string
  excerpt: string;        // Relevant passage extracted from the filing (≤700 chars)
  url: string;            // Link to the EDGAR filing viewer
  vertical: string;       // Matched Kaiso vertical
  matchedKeyword: string; // The search keyword that surfaced this filing
}

export interface RSSArticle {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  sourceName: string;
  timestamp: number;
}

export interface EvidenceSource {
  source: string;
  url: string;
  relevance: number;
  keyClaim: string;
}

export interface StressTestScenario {
  scenario: string;
  resilience: number;
  impact: string;
  mitigationStrategy?: string;
}

export interface CausalNode {
  stage: string;
  description: string;
  intensity: number;
}

export interface IntelligenceProfile {
  evidenceWeight: number;
  systemicResilience: number;
  calibrationIntegrity: number;
  groundingDelta: number;
  overallConfidence: number;
  temporalDrift: number;
  forecastAccuracy: number;
}

export interface SignalLedgerEntry {
  timestamp: number;
  intensity: number;
  evidenceId: string;
}

export interface ForecastValidationEntry {
  predictionDate: number;
  targetDate: number;
  metricLabel: string;
  predictedValue: number;
  actualValue?: number;
  isConfirmed: boolean;
}

// ── SERP Opportunity Detection (serpOpportunityDetectionService) ─────────────
// Domain unions shared between ReportSuggestion and the detection service.
// Defined here (not in the service) so ReportSuggestion can reference them
// without a service→types→service import cycle.
export type SerpSignalType =
  | 'ORGANIC'
  | 'PAID_AD'
  | 'AI_OVERVIEW'
  | 'SCHEMA_MARKUP'
  | 'REPORT_MARKETPLACE'
  | 'PDF'
  | 'TITLE_PATTERN';

export type OpportunityClass = 'GREEN' | 'YELLOW' | 'RED';

export interface ReportSuggestion {
  id: string;

  sourceArticleTitle?: string;
  sourceArticleUrl?: string;
  sourceArticleDate?: string;
  sourceArticleTimestamp?: number;
  sourceName?: string;

  vertical: Vertical;

  strategicPillar?: StrategicPillar;
  isGeographicFocus?: boolean;

  reportTitle: string;
  marketKeyword: string;

  salesPotential?: 'High' | 'Medium' | 'Emerging';

  trigger?: string;
  rationale?: string;
  b2bCommercialRationale?: string;
  competitorWhiteSpace?: string;
  competitorContext?: string;

  trendingKeywords?: string[];

  thematicCluster: string;

  nexusConnection?: string;
  confidenceScore?: number;

  intelligenceProfile?: IntelligenceProfile;
  causalPath?: CausalNode[];
  stressTests?: StressTestScenario[];
  evidenceSources?: EvidenceSource[];
  evolutionData?: number[];
  signalLedger?: SignalLedgerEntry[];
  forecastValidation?: ForecastValidationEntry[];

  credibilityScore?: number;
  veracityRationale?: string;

  marketExecutionWindow?:
    | 'Immediate (0-3M)'
    | 'Strategic (6-12M)'
    | 'Long-term (1Y+)';

  primaryStakeholder?: string;

  nexusArticlesCount?: number;

signalCount?: number;
  contributingSignals?: string[];
  signalType?: 'Regulatory' | 'VC/PE Funding' | 'Patent Filing' | 'Trade Publication' | 'General News';
  suggestedSegmentationAxes?: string[];
  estimatedCAGRRange?: string;
  signalOriginGeography?: string;
  recommendedReportGeography?: string;

  sentimentPolarity?: 'Bullish' | 'Bearish' | 'Neutral';

  executionRisk?: 'Low' | 'Medium' | 'High';

  regulatoryHurdle?: 'None' | 'Standard' | 'Critical';

opportunityScore?: number;

  commercialViabilityScore?: number;
  quantifiabilityScore?: number;
  cagrViabilityScore?: number;
  competitiveDensityScore?: number;
  segmentabilityScore?: number;
  buyerWillingnessScore?: number;
  seoSearchabilityScore?: number;

  freshnessLabel?: string;

  isLogicVerified?: boolean;
  sourceDomainMatch?: boolean;
  inferenceRatio?: number;

  // Google Trends enrichment — added post-pipeline in server.ts
  trendScore?: number;                  // 0–100, most recent Google Trends interest value
  trendDirection?: 'RISING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';
  trendDirectionLabel?: string;         // e.g. "📈 Rising (72)" — ready for UI display

  // Competitor White Space Detection — added post-pipeline in server.ts
  whiteSpaceStatus?: 'CONFIRMED_GAP' | 'PARTIAL_COVERAGE' | 'COMMODITISED' | 'UNKNOWN';
  whiteSpaceScore?: number;             // 0–100, higher = less competitor coverage = better for Kaiso
  whiteSpaceLabel?: string;             // e.g. "🟢 Confirmed Gap" — ready for UI display
  whiteSpaceCompetitors?: string[];     // Names of competitors that already cover this topic
  whiteSpaceGapReason?: string;         // One-sentence explanation of gap or coverage

  // SERP Opportunity Detection (serpOpportunityDetectionService) — additive, optional.
  // Existing white-space fields above remain the unchanged downstream contract.
  opportunityClass?: OpportunityClass;       // raw GREEN/YELLOW/RED band before status mapping
  whiteSpaceSignals?: SerpSignalType[];      // SERP signal types that contributed to coverage
  whiteSpaceSerpCached?: boolean;            // true when served from the SERP result cache

  // Action Classification — computed after whitespace + trends enrichment in server.ts
  actionVerdict?: 'PUBLISH NOW' | 'MONITOR' | 'PASS';
  actionReason?: string;                // One plain-English sentence explaining the verdict
  actionScore?: number;                 // 0–100 composite score (opportunityScore + ws + trend)
  actionUrgency?: 'HIGH' | 'MEDIUM' | 'LOW';

  // Council Review (councilEngine) — ADVISORY ONLY. A Gemini "second opinion" on
  // borderline opportunities. NEVER alters opportunityScore, confidence, or
  // actionVerdict; it is a displayed annotation only.
  councilReview?: {
    skepticNote: string;          // Differentiation / commoditisation critique
    buyerNote: string;            // Enterprise willingness-to-pay assessment
    chairmanVerdict: string;      // One-line synthesis of the two reviewers
    suggestedConfidence?: number; // 0–10, advisory only — what the council WOULD score (not applied)
  };
}

export interface IntelligenceBrief {
  executiveSummary: string;
  marketTriggerAnalysis: string;

  chapterOutline: {
    title: string;
    description: string;
  }[];

  targetPersonas: {
    title: string;
    type: string;
    decision: string;
    whyBuy: string;
  }[];

  competitivePositioning: {
    text: string;
    differentiators: string[];
  };

  seoTitleVariants: string[];
}
