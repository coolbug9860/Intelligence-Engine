import React from 'react';
import { ReportSuggestion } from '../types';
import { MapChart } from './MapChart';
import { Globe, ShieldCheck } from 'lucide-react';

interface GlobalHeatmapProps {
  suggestions: ReportSuggestion[];
  onMarkerClick: (suggestion: ReportSuggestion) => void;
}

export const GlobalHeatmap: React.FC<GlobalHeatmapProps> = ({ suggestions, onMarkerClick }) => {
  // Filter for geographic focus suggestions
  const geoSuggestions = suggestions.filter(s => s.isGeographicFocus);
const displaySuggestions = geoSuggestions.length > 0 ? geoSuggestions : suggestions;

  return (
    <div className="w-full h-full bg-slate-900 flex flex-col overflow-hidden relative">
      <div className="absolute top-6 left-6 z-10 space-y-2">
        <div className="flex items-center gap-3">
          <Globe className="text-brand-red animate-pulse" size={24} />
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest leading-none mb-1">Global Signal Density</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Geospatial asymmetric reasoning mapping</p>
          </div>
        </div>
        <div className="flex items-center gap-4 border-t border-white/10 pt-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={12} className="text-green-500" />
            <span className="text-[9px] font-bold text-slate-400 uppercase">Live Regional Nodes: 128</span>
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
        <MapChart suggestions={displaySuggestions} onMarkerClick={onMarkerClick} />
      </div>

      <div className="absolute bottom-6 left-6 p-4 bg-navy/80 backdrop-blur-md border border-white/10 rounded-lg max-w-sm">
        <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-2 pb-2 border-b border-white/10">Active Geo-Clusters</h4>
        <div className="space-y-3">
          {displaySuggestions.slice(0, 3).map((s, idx) => (
            <div key={`${s.id}-${idx}`} onClick={() => onMarkerClick(s)} className="cursor-pointer group">
              <div className="text-[9px] font-bold text-brand-red group-hover:text-white transition-colors">{s.reportTitle}</div>
              <div className="text-[8px] text-slate-400 font-mono mt-0.5">{s.thematicCluster}</div>
            </div>
          ))}
          {displaySuggestions.length > 3 && (
  <div className="text-[8px] font-bold text-slate-500 mt-2">
    + {displaySuggestions.length - 3} MORE REGIONAL SIGNALS
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
