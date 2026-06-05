import React from "react";
import { ReportSuggestion } from "../types";

interface MapChartProps {
  suggestions: ReportSuggestion[];
  onMarkerClick: (suggestion: ReportSuggestion) => void;
}

export const MapChart: React.FC<MapChartProps> = ({ suggestions, onMarkerClick }) => {
  if (suggestions.length === 0) {
    return (
      <div className="w-full h-full bg-[#111827] flex items-center justify-center">
        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">No signals available. Run Intelligence first.</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[#111827] p-6 overflow-auto">
      <div className="grid grid-cols-1 gap-3 pt-16">
        {suggestions.map((suggestion, idx) => (
          <button
            key={`${suggestion.id}-${idx}`}
            onClick={() => onMarkerClick(suggestion)}
            className="text-left bg-[#1F2937] hover:bg-[#374151] transition rounded-lg p-3 border border-gray-700"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="text-red-400 font-semibold text-[11px] leading-snug">{suggestion.reportTitle}</div>
              {suggestion.confidenceScore !== undefined && (
                <span className="text-[9px] font-black text-white bg-slate-600 px-1.5 py-0.5 rounded shrink-0">
                  {Math.round(suggestion.confidenceScore * 100)}%
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {suggestion.signalOriginGeography && (
                <span className="text-[8px] font-bold text-slate-300 bg-slate-700 px-1.5 py-0.5 rounded uppercase">
                  ORIGIN: {suggestion.signalOriginGeography}
                </span>
              )}
              {suggestion.recommendedReportGeography && (
                <span className="text-[8px] font-bold text-white bg-navy px-1.5 py-0.5 rounded uppercase">
                  SKU: {suggestion.recommendedReportGeography}
                </span>
              )}
              {suggestion.vertical && (
                <span className="text-[8px] font-bold text-slate-400 bg-slate-800 border border-slate-600 px-1.5 py-0.5 rounded uppercase">
                  {suggestion.vertical}
                </span>
              )}
            </div>

            {suggestion.trigger && (
              <div className="text-gray-400 text-[9px] mt-1.5 leading-relaxed line-clamp-2">{suggestion.trigger}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
