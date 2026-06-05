
import React from 'react';
import { motion } from 'motion/react';
import { 
  TrendingUp, 
  BarChart, 
  Gavel, 
  Cpu, 
  Layers, 
  Network, 
  Shield, 
  Zap,
  Activity,
  ArrowRight,
  Database,
  History,
  Target,
  Brain,
  ShieldCheck
} from 'lucide-react';
import { IntelligenceState } from '../services/intelligenceOrchestrator';

interface ExecutiveIntelligenceViewProps {
  data: IntelligenceState;
}

export const ExecutiveIntelligenceView: React.FC<ExecutiveIntelligenceViewProps> = ({ data }) => {
  const { evolutionAnalysis, priorityAnalysis, forecastAnalysis, memoryState, diagnostics } = data;

  return (
    <div className="p-8 space-y-12 bg-slate-50/50 min-h-full">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-2xl font-black text-navy uppercase tracking-tighter mb-1">Executive Analytics Dashboard</h2>
          <p className="text-[11px] text-muted font-bold uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            Asymmetric Intelligence Pipeline v1.4.2 // Cross-Vertical Synthesis Active
          </p>
        </div>
        <div className="flex gap-4">
          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col items-end">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Pipeline Velocity</span>
            <span className="text-xl font-black text-navy font-mono">{(diagnostics.executionTimeMs / 1000).toFixed(2)}S</span>
          </div>
          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col items-end">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Signals Ingested</span>
            <span className="text-xl font-black text-brand-red font-mono">{diagnostics.rawSignals}</span>
          </div>
        </div>
      </div>

      {/* TOP ROW: STRATEGIC PRIORITIES & EVOLUTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* PRIORITY QUADRANT */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xs font-black text-navy uppercase tracking-[0.2em] flex items-center gap-2">
              <Target size={16} className="text-brand-red" /> Strategic Prioritization Matrix
            </h3>
            <span className="text-[9px] font-bold text-muted uppercase">N=12 Clusters Analyzed</span>
          </div>
          <div className="p-6 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">High-Escalation Tiers</h4>
              {priorityAnalysis.assessments.filter(a => a.escalationTier === 'Tier 1 (Executive - Immediate)') .map((a, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  key={`priority-${a.cluster}-${i}`} 
                  className="p-4 bg-red-50 border border-red-100 rounded-xl flex justify-between items-center group cursor-default"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] font-black text-brand-red uppercase mb-1">IMMEDIATE ACTION REQ.</div>
                    <div className="text-[13px] font-bold text-navy truncate group-hover:whitespace-normal transition-all">{a.cluster}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[16px] font-black text-brand-red font-mono">{a.priorityScore}</div>
                    <div className="text-[8px] font-bold text-red-600 uppercase">SCORE</div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Structural Monitoring</h4>
              {priorityAnalysis.assessments.filter(a => a.escalationTier !== 'Tier 1 (Executive - Immediate)').slice(0, 3).map((a, i) => (
                <div key={`priority-low-${a.cluster}-${i}`} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center">
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">{a.escalationTier.split('(')[0]}</div>
                    <div className="text-[12px] font-bold text-navy truncate">{a.cluster}</div>
                  </div>
                  <div className="text-right">
                     <div className="text-[14px] font-black text-slate-400 font-mono italic">{a.priorityScore}</div>
                     <div className="text-[8px] font-bold text-slate-400 uppercase">RANK</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* EVOLUTION TRACKER */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xs font-black text-navy uppercase tracking-[0.2em] flex items-center gap-2">
              <History size={16} className="text-blue-600" /> Historical Evolution
            </h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
              <div>
                <div className="text-[9px] font-black text-blue-600 uppercase">Analysis Velocity</div>
                <div className="text-xs font-bold text-navy italic">"{evolutionAnalysis.summary}"</div>
              </div>
            </div>
            <div className="space-y-4">
              {evolutionAnalysis.assessments.slice(0, 4).map((e, i) => (
                <div key={`evo-${e.cluster}-${i}`} className="space-y-2">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-bold text-navy uppercase tracking-tight">{e.cluster}</span>
                    <span className={`text-[9px] font-black uppercase ${e.trajectory === 'Ascending' ? 'text-green-600' : 'text-blue-500'}`}>
                      {e.trajectory}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${e.velocity * 100}%` }}
                      className={`h-full ${e.trajectory === 'Ascending' ? 'bg-green-500' : 'bg-blue-500'}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MIDDLE ROW: FORECASTS & REASONING */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* FORECAST ENGINE */}
        <div className="bg-navy rounded-2xl shadow-xl overflow-hidden p-8 text-white relative">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <TrendingUp size={120} strokeWidth={1} />
          </div>
          <div className="relative z-10 space-y-8">
            <header className="flex justify-between items-center border-b border-white/10 pb-6">
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/60 flex items-center gap-2">
                <Brain size={18} className="text-brand-red animate-pulse" /> High-Fidelity Forecast Layer
              </h3>
              <div className="text-[10px] font-mono text-white/40">ENGINE_SIG: FRC_74</div>
            </header>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {forecastAnalysis.clusters.slice(0, 4).map((f: any, i: number) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  key={`forecast-${f.cluster}-${i}`} 
                  className="bg-white/5 border border-white/10 p-5 rounded-2xl hover:bg-white/10 transition-all cursor-default"
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] font-black text-brand-red uppercase tracking-widest">{f.classification}</span>
                    <Zap size={14} className="text-brand-red" />
                  </div>
                  <h4 className="text-[14px] font-bold leading-tight mb-2">{f.cluster}</h4>
                  <p className="text-[10px] text-white/60 leading-relaxed line-clamp-2 italic">Structural shift mapped to {f.signals?.length || 0} convergent signals.</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* MEMORY RECALL */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xs font-black text-navy uppercase tracking-[0.2em] flex items-center gap-2">
              <Database size={16} className="text-emerald-600" /> Persistence & Memory Snapshots
            </h3>
            <span className="text-[9px] font-mono font-bold text-muted uppercase">Session_Retain: Active</span>
          </div>
          <div className="p-6 flex-1 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                <div className="text-2xl font-black text-emerald-700 font-mono">{memoryState.cycles.length}</div>
                <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Active Cycles</div>
              </div>
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-center">
                <div className="text-2xl font-black text-indigo-700 font-mono">{memoryState.recurrences.length}</div>
                <div className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Recurrent Themes</div>
              </div>
            </div>
            
            <div className="space-y-3">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Persistent Themes</h4>
               <div className="flex flex-wrap gap-2">
                  {memoryState.themes.slice(0, 15).map((theme: any, i: number) => (
                    <span key={`theme-${theme.thematicCluster}-${i}`} className="px-3 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-full border border-slate-200 uppercase tracking-tighter">
                      {theme.thematicCluster}
                    </span>
                  ))}
               </div>
            </div>

            <div className="p-4 bg-slate-900 rounded-xl overflow-hidden relative">
               <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Cpu size={40} className="text-white" />
               </div>
               <div className="relative z-10">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Memory Logic Terminal</div>
                  <div className="font-mono text-[10px] text-emerald-400 space-y-1">
                     <div>{'>'} RECALL_SYNC: SUCCESSFUL</div>
                     <div>{'>'} THEME_INVENTORY: {memoryState.themes.length} ENTRIES</div>
                     <div>{'>'} PERSISTENCE_VERSION: 1.2.0</div>
                     <div className="animate-pulse">{'>'} STANDBY_BY_FOR_NEXT_CYCLE...</div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER DIAGNOSTICS */}
      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-wrap gap-12 justify-center text-[10px] font-bold uppercase tracking-widest text-muted">
        <div className="flex items-center gap-3">
          <span className="text-slate-400">ENGINE_STATUS:</span>
          {diagnostics.pipelineStages.map((stage, i) => (
             <span key={`footer-stage-${i}`} className="flex items-center gap-1.5">
               <ShieldCheck size={12} className="text-green-500" /> {stage}
             </span>
          ))}
        </div>
      </div>
    </div>
  );
};
