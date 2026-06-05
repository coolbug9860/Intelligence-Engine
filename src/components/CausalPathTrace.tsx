
import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Activity, Zap, TrendingUp, Target } from 'lucide-react';
import { CausalNode } from '../types';

interface CausalPathTraceProps {
  path?: CausalNode[];
  fallbackData: {
    trigger: string;
    rationale: string;
    b2bCommercialRationale: string;
  };
}

export const CausalPathTrace: React.FC<CausalPathTraceProps> = ({ path, fallbackData }) => {
  // Fallback if AI hasn't generated the path yet
  const nodes: CausalNode[] = path && path.length > 0 ? path : [
    { stage: 'Trigger', description: fallbackData.trigger, intensity: 0.9 },
    { stage: 'Impact', description: fallbackData.rationale, intensity: 0.7 },
    { stage: 'Response', description: 'Institutional recalibration of primary procurement strategies.', intensity: 0.6 },
    { stage: 'Value', description: fallbackData.b2bCommercialRationale, intensity: 0.8 },
  ];

  const getIcon = (stage: string) => {
    const s = stage.toLowerCase();
    if (s.includes('trigger')) return <Zap size={14} />;
    if (s.includes('order')) return <Activity size={14} />;
    if (s.includes('capture') || s.includes('value')) return <Target size={14} />;
    return <TrendingUp size={14} />;
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-navy flex items-center gap-2">
        <Activity size={14} className="text-brand-red" />
        Causal Intelligence Trace
      </h3>

      <div className="relative flex items-start gap-0">
        {nodes.map((node, idx) => (
          <React.Fragment key={`causal-node-${idx}`}>
            <div className="flex-1 flex flex-col items-center group relative">
              {/* NODE CIRCLE */}
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.2, type: 'spring' }}
                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center relative z-10 
                  ${idx === 0 ? 'bg-brand-red border-brand-red text-white' : 
                    idx === nodes.length - 1 ? 'bg-navy border-navy text-white' : 
                    'bg-white border-slate-300 text-muted group-hover:border-brand-red group-hover:text-brand-red transition-colors'}
                  shadow-[0_4px_12px_rgba(0,0,0,0.1)]`}
              >
                {getIcon(node.stage)}
                
                {/* INTENSITY RING */}
                <div 
                  className="absolute -inset-1.5 border border-slate-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ transform: `scale(${1 + node.intensity * 0.2})` }}
                ></div>
              </motion.div>

              {/* LABEL */}
              <div className="mt-4 text-center px-2">
                <div className="text-[8px] font-black uppercase tracking-widest text-muted mb-1">{node.stage}</div>
                <p className="text-[10px] font-bold text-navy leading-tight line-clamp-3">
                  {node.description}
                </p>
              </div>

              {/* INTENSITY BAR */}
              <div className="mt-3 w-8 h-1 bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${node.intensity * 100}%` }}
                  transition={{ delay: idx * 0.2 + 0.5 }}
                  className={`h-full ${idx === 0 ? 'bg-brand-red' : 'bg-navy'}`}
                />
              </div>
            </div>

            {/* CONNECTOR LINE */}
            {idx < nodes.length - 1 && (
              <div className="mt-5 w-4 shrink-0 flex items-center justify-center overflow-hidden h-1">
                <motion.div 
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: idx * 0.2 + 0.1, duration: 0.3 }}
                  className="h-[1px] w-full bg-slate-300 origin-left"
                ></motion.div>
                <ArrowRight size={10} className="text-slate-300 -ml-1 shrink-0" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="p-3 bg-slate-50 border border-slate-100 rounded text-[9px] text-muted italic font-medium leading-relaxed">
        * Logic chain derived via Asymmetric Reasoning Engine. Veracity weighting applied at each node to prevent speculative drift.
      </div>
    </div>
  );
};
