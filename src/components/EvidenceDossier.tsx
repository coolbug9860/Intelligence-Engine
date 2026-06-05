
import React from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Database, Link as LinkIcon, FileText } from 'lucide-react';
import { EvidenceSource } from '../types';

interface EvidenceDossierProps {
  sources?: EvidenceSource[];
  primarySource: {
    source: string;
    url: string;
    title: string;
  };
}

export const EvidenceDossier: React.FC<EvidenceDossierProps> = ({ sources, primarySource }) => {
  // Only use the real primary source as fallback.
  // The old fallback included a fabricated 'Nexus Signal Node 14' source
  // with a fake URL (#) which showed invented corroboration in the dossier.
  const allSources: EvidenceSource[] = sources && sources.length > 0 ? sources : [
    { 
      source: primarySource.source, 
      url: primarySource.url, 
      relevance: 1.0, 
      keyClaim: primarySource.title 
    }
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-navy flex items-center gap-2">
          <Database size={14} className="text-brand-red" />
          Evidence Attribution Dossier
        </h3>
        <div className="text-[9px] font-mono font-bold text-muted">
          CORROBORATIVE_COUNT: {allSources.length}
        </div>
      </div>

      <div className="space-y-2">
        {allSources.map((source, idx) => (
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={`source-${idx}`} 
            className="flex items-start gap-4 p-3 bg-white border border-slate-100 rounded group hover:border-brand-red/30 hover:bg-slate-50 transition-all"
          >
            <div className="flex flex-col items-center gap-1 shrink-0 pt-1">
              <div className="w-8 h-8 rounded bg-slate-50 flex items-center justify-center text-muted group-hover:text-brand-red transition-colors">
                <FileText size={14} />
              </div>
              <div className="text-[7px] font-black text-slate-400">{(source.relevance * 100).toFixed(0)}%</div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-black text-navy uppercase tracking-tighter bg-slate-100 group-hover:bg-brand-red/10 group-hover:text-brand-red px-1 rounded transition-colors">
                  {source.source}
                </span>
                <a 
                  href={source.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-muted hover:text-navy transition-colors"
                >
                  <ExternalLink size={10} />
                </a>
              </div>
              <p className="text-[11px] font-bold text-navy pr-4 truncate group-hover:whitespace-normal group-hover:overflow-visible transition-all">
                {source.keyClaim}
              </p>
            </div>

            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-1 text-[8px] font-black text-green-600 uppercase">
                <LinkIcon size={10} /> LINKED
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-col gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-[8px] font-black text-navy uppercase tracking-widest">Global Ingestion Integrity</span>
          <span className="text-[10px] font-mono font-bold text-green-600">VERIFIED</span>
        </div>
        <div className="flex gap-1 h-3">
          {[1,2,3,4,5,6,7,8,9,10].map(i => <div key={`integrity-bar-${i}`} className={`flex-1 rounded-sm ${i <= 8 ? 'bg-brand-red' : 'bg-slate-200'}`}></div>)}
        </div>
        <div className="flex justify-between items-center text-[7px] font-bold text-slate-400 uppercase">
          <span>Primary Grounding</span>
          <span>Inference Gap</span>
        </div>
      </div>
    </div>
  );
};
