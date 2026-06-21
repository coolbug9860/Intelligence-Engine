
import React from 'react';
import { motion } from 'motion/react';
import { Shield, Zap, RefreshCw, BarChart, Database } from 'lucide-react';
import { IntelligenceProfile as ProfileType } from '../types';

interface IntelligenceProfileProps {
  profile?: ProfileType;
  fallbackScore: number;
  isCompact?: boolean;
}

export const IntelligenceProfile: React.FC<IntelligenceProfileProps> = ({ profile, fallbackScore, isCompact }) => {
  // Derive profile from score if not present (backward compatibility)
  const activeProfile: ProfileType = profile || {
    evidenceWeight: fallbackScore / 10,
    systemicResilience: (fallbackScore * 0.85) / 10,
    calibrationIntegrity: (fallbackScore * 0.9) / 10,
    groundingDelta: 0.8,
    overallConfidence: fallbackScore / 10,
  };

  const metrics = [
    { 
      label: 'Evidence Weight', 
      value: activeProfile.evidenceWeight, 
      icon: Shield, 
      color: 'bg-brand-red', 
      desc: 'Grounding strength in primary sources.' 
    },
    { 
      label: 'Systemic Resilience', 
      value: activeProfile.systemicResilience, 
      icon: Zap, 
      color: 'bg-navy', 
      desc: 'Likelihood of trend stability under stress.' 
    },
    { 
      label: 'Calibration Integrity', 
      value: activeProfile.calibrationIntegrity, 
      icon: RefreshCw, 
      color: 'bg-light-blue', 
      desc: 'Consistency of logical derivation.' 
    },
    { 
      label: 'Grounding Ratio', 
      value: activeProfile.groundingDelta || 0, 
      icon: Database, 
      color: 'bg-green-600', 
      desc: 'Proportion of grounded evidence vs AI inference.' 
    },
  ];

  if (isCompact) {
    return (
      <div
        className="flex justify-center gap-1 h-3 mt-1 px-2 cursor-help"
        title={`Intelligence Profile (hover bars for %): ${metrics.map(m => m.label).join(' · ')}`}
      >
        {metrics.map((m, idx) => (
          <div key={m.label} title={`${m.label}: ${(m.value * 100).toFixed(0)}%`} className="flex-1 bg-slate-100 rounded-full overflow-hidden flex flex-col justify-end">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${m.value * 100}%` }}
              className={`w-full ${m.color}`}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div id="intelligence-profile-container" className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-navy flex items-center gap-2">
          <BarChart size={14} className="text-brand-red" />
          Intelligence Profile
        </h3>
        <div className="text-[10px] font-mono font-bold text-muted">
          COMPOSITE: {(activeProfile.overallConfidence * 10).toFixed(1)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {metrics.map((m, idx) => (
          <div key={m.label} className="group relative">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <m.icon size={12} className="text-muted group-hover:text-brand-red transition-colors" />
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">{m.label}</span>
              </div>
              <span className="text-[10px] font-mono font-bold text-navy">
                {(m.value * 100).toFixed(0)}%
              </span>
            </div>
            
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${m.value * 100}%` }}
                transition={{ duration: 1, delay: idx * 0.1, ease: 'easeOut' }}
                className={`h-full ${m.color} relative`}
              >
                <div className="absolute inset-0 bg-white/20 animate-shimmer bg-[length:200%_100%]"></div>
              </motion.div>
            </div>

            <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 left-0 right-0 z-10 pointer-events-none">
              <div className="bg-navy text-white text-[8px] font-bold px-2 py-1 rounded shadow-xl uppercase tracking-widest border border-white/20">
                {m.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
