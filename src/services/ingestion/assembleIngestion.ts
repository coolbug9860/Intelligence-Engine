/**
 * assembleIngestion.ts (Task 8 / 8.1)
 *
 * The pure, testable core of the Phase-0 ingestion assembly extracted from server.ts.
 *
 * Given the already-fetched per-connector outputs (RSS count, EDGAR signals, and the
 * four IngestionRecord streams), this runs the zero-LLM keyword gate + lazy enrichment,
 * performs the Federal Register → SAM watchlist hand-off (distinct IDs, sequential,
 * quota-safe via the injected `samLookup`), collapses everything through the single
 * adapter into the EXISTING `EDGARSignal` seam, and reports a partial/total status.
 *
 * `samLookup` is injected so the SAM dependency (and its quota gate) can be exercised
 * in tests without network or Express.
 *
 * Validates: Requirements 1.2, 1.6, 5.6, 5.7, 6.5, 6.6, 8.4
 */

import type { EDGARSignal } from "../../types";
import type { IngestionRecord } from "./ingestionTypes";
import type { SamSignal } from "../samGovService";
import { runKeywordGateAndEnrich } from "./keywordGate";
import { ingestionRecordToEdgarSignal } from "./ingestionAdapter";
import { extractSolicitationIds } from "../federalRegisterService";

export type IngestionStatus = "FULL_SUCCESS" | "PARTIAL_SUCCESS" | "TOTAL_FAILURE";

export interface AssembleParams {
  rssArticleCount: number;
  edgarSignals: EDGARSignal[];
  tedRecords: IngestionRecord[];
  ukFtsRecords: IngestionRecord[];
  fedRegRecords: IngestionRecord[];
  epoRecords: IngestionRecord[];
  adzunaRecords: IngestionRecord[];
  rejectedCount: number;
  samLookup: (noticeId: string) => Promise<SamSignal | null>;
}

export interface AssembledIngestion {
  combinedSignals: EDGARSignal[];
  watchlistIds: string[];
  samSignalCount: number;
  status: IngestionStatus;
  stats: {
    edgar: number; ted: number; ukFts: number; fedReg: number; epo: number; adzuna: number;
    gatedSignals: number; sam: number; sourcesWithData: number;
  };
}

/** SamSignal → EDGARSignal (unchanged seam shape). */
function adaptSam(s: SamSignal): EDGARSignal {
  return {
    title: s.title,
    filingType: s.noticeType,
    companyName: s.agency,
    filingDate: s.postedDate,
    excerpt: s.excerpt,
    url: s.url,
    vertical: s.vertical,
    matchedKeyword: s.matchedKeyword,
  };
}

export async function assembleCombinedSignals(p: AssembleParams): Promise<AssembledIngestion> {
  // Gate + lazy enrichment over the four new IngestionRecord streams.
  const ingestionRecords: IngestionRecord[] = [
    ...p.tedRecords, ...p.ukFtsRecords, ...p.fedRegRecords, ...p.epoRecords, ...p.adzunaRecords,
  ];
  const gatedRecords = await runKeywordGateAndEnrich(ingestionRecords);

  // Watchlist hand-off: distinct solicitation IDs from gate-matched FedReg notices.
  const watchlistIds = Array.from(new Set(
    gatedRecords
      .filter((r) => r.source_system === "US_FEDERAL_REGISTER")
      .flatMap((r) => extractSolicitationIds(`${r.headline} ${r.abstract} ${r.fullText ?? ""}`))
  ));

  // Sequential by-ID SAM lookups (quota-safe; injected dependency).
  const samSignals: SamSignal[] = [];
  for (const noticeId of watchlistIds) {
    const signal = await p.samLookup(noticeId);
    if (signal) samSignals.push(signal);
  }

  // Adapt gated records — per-record guard so one bad record never aborts the cycle.
  const adaptedIngestion: EDGARSignal[] = [];
  for (const rec of gatedRecords) {
    try {
      adaptedIngestion.push(ingestionRecordToEdgarSignal(rec));
    } catch (err) {
      console.warn("[Ingestion] Skipped malformed record:", err);
    }
  }

  const combinedSignals: EDGARSignal[] = [
    ...p.edgarSignals,
    ...adaptedIngestion,
    ...samSignals.map(adaptSam),
  ];

  // Status: distinguish full / partial / total failure.
  const externalCounts = [
    p.edgarSignals.length, p.tedRecords.length, p.ukFtsRecords.length,
    p.fedRegRecords.length, p.epoRecords.length, p.adzunaRecords.length,
  ];
  const sourcesWithData = externalCounts.filter((n) => n > 0).length;
  let status: IngestionStatus;
  if (sourcesWithData === 0 && p.rssArticleCount === 0) {
    status = "TOTAL_FAILURE";
  } else if (p.rejectedCount > 0 || sourcesWithData < externalCounts.length) {
    status = "PARTIAL_SUCCESS";
  } else {
    status = "FULL_SUCCESS";
  }

  return {
    combinedSignals,
    watchlistIds,
    samSignalCount: samSignals.length,
    status,
    stats: {
      edgar: p.edgarSignals.length,
      ted: p.tedRecords.length,
      ukFts: p.ukFtsRecords.length,
      fedReg: p.fedRegRecords.length,
      epo: p.epoRecords.length,
      adzuna: p.adzunaRecords.length,
      gatedSignals: adaptedIngestion.length,
      sam: samSignals.length,
      sourcesWithData,
    },
  };
}
