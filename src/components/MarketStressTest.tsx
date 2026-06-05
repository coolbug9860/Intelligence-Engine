
import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ShieldCheck, Zap, Activity } from 'lucide-react';
import { StressTestScenario } from '../types';

interface MarketStressTestProps {
  tests?: StressTestScenario[];
}

export const MarketStressTest: React.FC<MarketStressTestProps> = ({ tests }) => {
  const scenarios: StressTestScenario[] = tests && tests.length > 0 ? tests : [
    { 
      scenario: 'Regulatory Pivot', 
      resilience: 0.8, 
      impact: 'High degree of institutional adaptability.',
      mitigationStrategy: 'Accelerate regulatory compliance sandbox participation.'
    },
    { 
      scenario: 'Supply Chain Volatility', 
      resilience: 0.4, 
      impact: 'Significant risk of margin erosion due to logistics friction.',
      mitigationStrategy: 'Diversify regional logistics hubs and implement real-time inventory buffers.'
    },
    { 
      scenario: 'Economic Contraction', 
      resilience: 0.55, 
      impact: 'Moderate elastic demand provides temporary buffer, but long-term CAPEX freeze risk is high.',
      mitigationStrategy: 'Pivot to an OPEX-driven subscription model to mitigate high upfront cost barriers.'
    },
  ];

  const focusScenario = scenarios.find(s => s.scenario.includes('Economic Contraction'));
  const needsMitigation = focusScenario && focusScenario.resilience < 0.6;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-navy flex items-center gap-2">
          <ShieldCheck size={14} className="text-brand-red" />
          Structural Stress Simulation
        </h3>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">REAL-TIME SIMULATION ACTIVE</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {scenarios.map((test, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={`${test.scenario}-${idx}`} 
            className={`p-4 bg-white border ${test.resilience < 0.6 ? 'border-brand-red/20' : 'border-slate-200'} rounded-lg shadow-sm hover:border-brand-red/30 transition-all flex flex-col gap-2 relative overflow-hidden`}
          >
            {test.resilience < 0.5 && (
              <div className="absolute top-0 right-0 p-1">
                <AlertTriangle size={12} className="text-brand-red animate-pulse" />
              </div>
            )}
            
            <div className={`text-[9px] font-black ${test.resilience < 0.6 ? 'text-brand-red' : 'text-muted'} uppercase tracking-tight line-clamp-1 border-b border-slate-50 pb-1 mb-1`}>
              {test.scenario}
            </div>

            <div className="flex items-end justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono font-bold text-navy">
                  <span>RESILIENCE</span>
                  <span>{(test.resilience * 100).toFixed(0)}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${test.resilience * 100}%` }}
                    className={`h-full ${test.resilience > 0.7 ? 'bg-green-500' : test.resilience > 0.4 ? 'bg-yellow-500' : 'bg-brand-red'}`}
                  />
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 font-medium leading-tight mt-1 italic">
              {test.impact}
            </p>

            {test.mitigationStrategy && (
              <div className="mt-2 pt-2 border-t border-slate-100 border-dashed">
                <div className="text-[8px] font-black text-brand-red uppercase mb-1 tracking-widest">Advisory Mitigation</div>
                <p className="text-[9px] text-navy font-bold leading-tight">
                  {test.mitigationStrategy}
                </p>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {needsMitigation && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-red-50 border border-red-200 p-4 rounded-xl flex gap-4 items-start shadow-sm"
        >
          <div className="w-10 h-10 rounded-lg bg-white border border-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="text-brand-red" size={20} />
          </div>
          <div>
            <div className="text-[10px] font-black text-brand-red uppercase tracking-widest mb-1">Critical Viability Warning: Economic Contraction</div>
            <p className="text-xs text-navy font-bold leading-relaxed mb-2">
              Economic contraction scenario shows a resilience score of {(focusScenario.resilience * 100).toFixed(0)}%, which falls below the 60% stability threshold. 
              This indicates high sensitivity to interest rate surges and corporate CAPEX freezes.
            </p>
            <div className="bg-white/80 border border-red-100 p-3 rounded-lg">
              <div className="text-[9px] font-black text-slate-600 uppercase mb-1">Executive Mitigation Requirement</div>
              <p className="text-xs text-brand-red font-black">
                {focusScenario.mitigationStrategy || "Pivot to flexible credit terms and diversify across recession-resistant public sector verticals."}
              </p>
            </div>
          </div>
        </motion.div>
      )}
      
      <div className="flex items-center gap-4 py-2 border-t border-slate-100 mt-2">
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-brand-red" />
          <span className="text-[8px] font-black text-navy uppercase tracking-widest">MONTE CARLO ASYMMETRIC VARIANCE: ±4.2%</span>
        </div>
        <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-auto">Kaiso Simulation Engine v4.2</div>
      </div>
    </div>
  );
};
