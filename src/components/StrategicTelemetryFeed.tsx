import { motion, AnimatePresence } from 'motion/react';
import { Terminal, Database, Shield, Zap, Search, Activity, Cpu, Globe, Lock, Unlock, Server, Binary, BarChart, TrendingUp, Layers, Eye, RefreshCw } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';

interface TelemetryLog {
  id: string;
  text: string;
  type: 'process' | 'success' | 'warning' | 'alert' | 'data';
  timestamp: string;
  icon: any;
}

const INTELLIGENCE_TASKS = [
  { text: 'DECRYPTING RELATIONAL ENTROPY...', icon: Unlock, type: 'process' },
  { text: 'RESOLVING STRUCTURAL ASYMMETRIES...', icon: Zap, type: 'process' },
  { text: 'CALIBRATING FORECAST VECTORS...', icon: TrendingUp, type: 'data' },
  { text: 'CROSS-PILLAR SYNC: ACTIVE', icon: Shield, type: 'success' },
  { text: 'ISOLATING ANOMALOUS OVERLAYS...', icon: Search, type: 'alert' },
  { text: 'NEXUS NODE HANDSHAKE: VERIFIED', icon: Lock, type: 'success' },
  { text: 'MAPPING COMPETITIVE WHITESPACE...', icon: Eye, type: 'process' },
  { text: 'TRACING SIGNAL PROPAGATION...', icon: Activity, type: 'data' },
  { text: 'CALCULATING REGIME SHIFT PROBABILITY...', icon: Cpu, type: 'data' },
  { text: 'SYNTHESIZING ASYMMETRIC LOGIC...', icon: Binary, type: 'process' },
  { text: 'INGESTING GLOBAL XML ARTIFACTS...', icon: Database, type: 'process' },
  { text: 'NORMAlIZING TAXONOMY VECTORS...', icon: Layers, type: 'process' },
  { text: 'DETECTING SUPERCYCLE ACCELERATION...', icon: Zap, type: 'alert' },
  { text: 'GEOGRAPHIC ISOLATION: NOMINAL', icon: Globe, type: 'success' },
  { text: 'EXECUTING HEURISTIC FILTER_7...', icon: Server, type: 'process' },
  { text: 'SCRUBBING DUPLICATE SIGNATURES...', icon: RefreshCw, type: 'process' },
  { text: 'EVALUATING SOURCE AUTHORITY...', icon: Shield, type: 'data' },
  { text: 'DIVERSITY PROTECTION PROTOCOL: ENGAGED', icon: Lock, type: 'success' },
];

export function StrategicTelemetryFeed() {
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let logInterval: any;
    let progressInterval: any;

    const addLog = () => {
      const task = INTELLIGENCE_TASKS[Math.floor(Math.random() * INTELLIGENCE_TASKS.length)];
      const newLog: TelemetryLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: task.text,
        type: task.type as any,
        timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        icon: task.icon
      };

      setLogs(prev => [newLog, ...prev].slice(0, 30));
    };

    logInterval = setInterval(addLog, 600);

    progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 98) return prev;
        const jump = Math.random() > 0.8 ? 3 : 0.5;
        return Math.min(99, prev + jump);
      });
    }, 100);

    return () => {
      clearInterval(logInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-50 text-navy font-sans p-6 overflow-hidden relative border-y border-slate-200 select-none">
      {/* ── Background Detail ── */}
      <div className="absolute inset-0 opacity-[0.4]" style={{ 
        backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
        backgroundSize: '24px 24px'
      }}></div>
      
      {/* ── Sublte Glow ── */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[300px] bg-white/60 blur-[80px] rounded-full pointer-events-none"></div>

      {/* ── Command Header ── */}
      <div className="shrink-0 mb-6 pb-4 border-b border-slate-200 relative z-10 flex justify-between items-end">
        <div className="space-y-3 flex-1 max-w-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-navy flex items-center justify-center shadow-lg shadow-navy/10">
              <Terminal className="text-white animate-pulse" size={18} />
            </div>
            <div>
              <h3 className="text-xs font-black tracking-[0.3em] uppercase text-navy">Command Telemetry</h3>
              <p className="text-[9px] text-slate-400 font-bold tracking-widest uppercase">Proxy: Established</p>
            </div>
          </div>
          
          <div className="space-y-1.5">
             <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-slate-500">
               <span>Relational Alignment</span>
               <span className="font-mono">{progress.toFixed(1)}%</span>
             </div>
             <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden p-[1px]">
               <motion.div 
                 className="h-full bg-navy rounded-full"
                 animate={{ width: `${progress}%` }}
               />
             </div>
          </div>
        </div>

        <div className="flex gap-4">
           <div className="text-right">
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">CPU_LOAD</div>
              <div className="text-xs font-bold font-mono text-navy">78.2%</div>
           </div>
           <div className="text-right">
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">LATENCY</div>
              <div className="text-xs font-bold font-mono text-navy">1.2ms</div>
           </div>
        </div>
      </div>

      {/* ── Feed Section ── */}
      <div className="flex-1 overflow-hidden relative z-10 border border-slate-200/50 bg-white/40 backdrop-blur-sm rounded-xl p-4">
        <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white/80 to-transparent pointer-events-none z-20"></div>
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white/80 to-transparent pointer-events-none z-20"></div>
        
        <div className="h-full flex flex-col gap-3 overflow-y-auto no-scrollbar mask-gradient-v">
          <AnimatePresence initial={false}>
            {logs.map((log, i) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex items-start gap-4 text-[10px] leading-relaxed font-mono ${i === 0 ? 'text-navy font-bold' : 'text-slate-400'}`}
              >
                <span className="shrink-0 opacity-40">[{log.timestamp}]</span>
                <span className={`shrink-0 ${i === 0 ? 'animate-pulse' : 'opacity-40'}`}>
                  <log.icon size={12} />
                </span>
                <span className="flex-1 tracking-tight">
                  <span className={
                    log.type === 'alert' ? 'text-amber-600' : 
                    log.type === 'success' ? 'text-emerald-600' : 
                    log.type === 'data' ? 'text-blue-600' : ''
                  }>
                    {log.text}
                  </span>
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Command Footer ── */}
      <div className="shrink-0 mt-4 pt-4 border-t border-slate-200 flex justify-between items-center text-[8px] tracking-[0.2em] font-black uppercase text-slate-400 relative z-10">
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
            <span>Matrix: Online</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span>Auth: Verified</span>
          </div>
        </div>
        <div className="flex items-center gap-4 font-mono font-bold italic">
          <span>{new Date().toISOString()}</span>
          <RefreshCw size={12} className="animate-spin-slow opacity-40" />
        </div>
      </div>
    </div>
  );
}
