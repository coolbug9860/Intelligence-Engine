
import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface IntelligenceEvolutionProps {
  data?: number[];
  label?: string;
}

export const IntelligenceEvolution: React.FC<IntelligenceEvolutionProps> = ({ data, label }) => {
  const values = data && data.length > 0 ? data : [0.1, 0.2, 0.15, 0.3, 0.45, 0.4, 0.6, 0.8, 0.9, 0.95];
  
  const width = 200;
  const height = 40;
  const padding = 4;
  
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * (width - padding * 2) + padding,
    y: height - (v * (height - padding * 2) + padding)
  }));

  const pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');

  const getTrajectory = () => {
    const start = values[0];
    const end = values[values.length - 1];
    const diff = end - start;
    if (diff > 0.3) return { text: 'SURGING', icon: <TrendingUp size={12} className="text-green-500" />, color: 'text-green-500' };
    if (diff < -0.3) return { text: 'DECLINING', icon: <TrendingDown size={12} className="text-brand-red" />, color: 'text-brand-red' };
    return { text: 'STEADY', icon: <Minus size={12} className="text-blue-500" />, color: 'text-blue-500' };
  };

  const trajectory = getTrajectory();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-navy">
          Intelligence Evolution (30D)
        </h3>
        <div className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest ${trajectory.color}`}>
          {trajectory.icon} {trajectory.text}
        </div>
      </div>

      <div className="relative bg-slate-50/50 rounded p-4 border border-slate-100 overflow-hidden group">
        {/* GRID LINES */}
        <div className="absolute inset-0 flex flex-col justify-between p-2 opacity-20">
          <div className="h-[1px] w-full bg-slate-300"></div>
          <div className="h-[1px] w-full bg-slate-300"></div>
          <div className="h-[1px] w-full bg-slate-300 border-dashed"></div>
        </div>

        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="relative z-10">
          <motion.path 
            d={pathD}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand-red"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
          />
          
          {/* FILL GRADIENT (optional/minimal) */}
          <motion.path 
            d={`${pathD} L ${points[points.length-1].x} ${height} L ${points[0].x} ${height} Z`}
            className="fill-brand-red/5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          />

          {/* END POINT PULSE */}
          <motion.circle 
            cx={points[points.length-1].x} 
            cy={points[points.length-1].y} 
            r="3" 
            className="fill-brand-red"
            initial={{ scale: 0 }}
            animate={{ scale: [1, 1.5, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
          />
        </svg>

        <div className="flex justify-between mt-1 px-1">
          <span className="text-[7px] font-bold text-slate-300 uppercase">T-30D</span>
          <span className="text-[7px] font-bold text-slate-300 uppercase">PRESENT</span>
        </div>
      </div>
      <p className="text-[9px] text-muted font-medium italic leading-tight">
        * Signal velocity derived from thematic cluster density across the global 30-day lookback window.
      </p>
    </div>
  );
};
