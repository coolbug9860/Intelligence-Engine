import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useState, useRef } from 'react';
import { Network, Cpu, Zap, Activity, Shield, Orbit, Atom, Radio, Fingerprint, Compass } from 'lucide-react';

interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
  type: 'core' | 'signal' | 'nexus';
  pulseDelay: number;
}

interface Edge {
  id: string;
  source: string;
  target: string;
}

const STRATEGIC_NODES = [
  'MACRO_SIGNAL', 'VERTICAL_SYNC', 'REGIME_FLUX', 'STRUCTURAL_PILLAR',
  'SUPERCYCLE_ALPHA', 'INTELLIGENCE_NEXUS', 'PROPAGATION_VECTOR',
  'FORECAST_MODEL', 'DATA_RECON', 'RELATIONAL_GRID'
];

const STAGE_LABELS: Record<string, string> = {
  'INGESTING GLOBAL DATA...': 'INGESTING DATA STREAMS',
  'SIGNAL STREAM RECALIBRATING...': 'RECALIBRATING SIGNALS',
  'NEXUS REVERSION ACTIVE': 'ACTIVATING NEXUS',
  'MAPPING': 'MAPPING SIGNALS',
  'INTELLIGENCE MAPPED': 'SYNTHESIS COMPLETE',
  'NO OPPORTUNITIES IDENTIFIED': 'SCAN COMPLETE',
  'CRITICAL ERROR': 'ERROR DETECTED',
  '': 'INITIALIZING'
};

interface IntelligenceGraphAssemblyProps {
  status?: string;
}

export function IntelligenceGraphAssembly({ status = '' }: IntelligenceGraphAssemblyProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [confidence, setConfidence] = useState(94.2);

  // Initialize Professional Logic
  useEffect(() => {
    const initialNodes: Node[] = Array.from({ length: 12 }).map((_, i) => ({
      id: `node-${i}`,
      x: 20 + Math.random() * 60,
      y: 20 + Math.random() * 60,
      label: STRATEGIC_NODES[i % STRATEGIC_NODES.length],
      type: i % 4 === 0 ? 'core' : i % 3 === 0 ? 'nexus' : 'signal',
      pulseDelay: Math.random() * 2
    }));
    setNodes(initialNodes);

    // Initial stable connections
    const initialEdges: Edge[] = [];
    for (let i = 0; i < 6; i++) {
      const s = initialNodes[Math.floor(Math.random() * initialNodes.length)].id;
      const t = initialNodes[Math.floor(Math.random() * initialNodes.length)].id;
      if (s !== t) initialEdges.push({ id: `stable-${i}`, source: s, target: t });
    }
    setEdges(initialEdges);
  }, []);

  // Neural Synthesis Cycle
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep(prev => (prev + 1) % 100);
      setConfidence(c => c + (Math.random() - 0.4) * 0.2);
      
      if (Math.random() > 0.7 && nodes.length > 0) {
        const source = nodes[Math.floor(Math.random() * nodes.length)].id;
        const target = nodes[Math.floor(Math.random() * nodes.length)].id;
        if (source !== target) {
          setEdges(prev => {
            const id = `path-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            return [...prev, { id, source, target }].slice(-12);
          });
        }
      }
    }, 800);
    return () => clearInterval(timer);
  }, [nodes]);

  return (
    <div className="relative w-full h-full bg-[#f8fafc] overflow-hidden flex flex-col font-sans select-none border-y border-slate-200">
      {/* ── Professional Background ── */}
      <div className="absolute inset-0 opacity-[0.4]" style={{ 
        backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
        backgroundSize: '24px 24px'
      }}></div>
      
      {/* Sublte Central Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-slate-200/40 blur-[120px] rounded-full pointer-events-none"></div>

      {/* ── Executive Header ── */}
      <div className="shrink-0 px-8 py-6 flex justify-between items-center bg-white/80 backdrop-blur-xl border-b border-slate-200/60 z-40 relative">
        <div className="flex items-center gap-6">
          <div className="w-12 h-12 rounded-xl bg-navy flex items-center justify-center shadow-lg shadow-navy/20 relative group">
            <Network className="text-white animate-pulse" size={24} />
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl"></div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-navy">Intelligence Synthesis</h3>
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 text-[8px] font-black uppercase tracking-widest border border-emerald-200">Active</span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold tracking-widest flex gap-4 uppercase font-mono">
              <span>Node_Assembly: {activeStep}%</span>
              <span>Sync_Auth: Verified</span>
            </p>
          </div>
        </div>

        <div className="flex gap-10">
          {[
            { label: 'Confidence', val: `${confidence.toFixed(2)}%`, icon: Shield, color: 'text-navy' },
            { label: 'Throughput', val: `${(activeStep * 8.4).toFixed(0)}mb/s`, icon: Activity, color: 'text-blue-600' },
            { label: 'Relational Flux', val: `0.${(activeStep + 240)}`, icon: Compass, color: 'text-emerald-600' }
          ].map((stat, i) => (
            <div key={`stat-${i}`} className="flex flex-col items-end">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1.5">
                <stat.icon size={10} /> {stat.label}
              </div>
              <div className={`text-sm font-black font-mono ${stat.color} tracking-tight`}>{stat.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main Neural Stage ── */}
      <div className="flex-1 relative overflow-hidden">
        <svg className="w-full h-full">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="25" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
            </marker>
          </defs>

          {/* Logic Paths */}
          <AnimatePresence>
            {edges.map(edge => {
              const sn = nodes.find(n => n.id === edge.source);
              const tn = nodes.find(n => n.id === edge.target);
              if (!sn || !tn) return null;

              return (
                <motion.line
                  key={edge.id}
                  x1={`${sn.x}%`}
                  y1={`${sn.y}%`}
                  x2={`${tn.x}%`}
                  y2={`${tn.y}%`}
                  stroke="#cbd5e1"
                  strokeWidth="0.75"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.6 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.5, ease: "easeInOut" }}
                />
              );
            })}
          </AnimatePresence>

          {/* Strategic Nodes */}
          {nodes.map(node => (
            <motion.g 
              key={node.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: node.pulseDelay }}
            >
              <circle
                cx={`${node.x}%`}
                cy={`${node.y}%`}
                r="18"
                className="fill-white stroke-slate-200 stroke-[1]"
                style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.02))' }}
              />
              <motion.circle
                cx={`${node.x}%`}
                cy={`${node.y}%`}
                r="22"
                fill="none"
                stroke={node.type === 'core' ? '#0F172A' : '#3b82f6'}
                strokeWidth="1"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ 
                  opacity: [0, 0.3, 0],
                  scale: [1, 1.4, 1] 
                }}
                transition={{ 
                  repeat: Infinity, 
                  duration: 2.5 + node.pulseDelay,
                  ease: "easeInOut" 
                }}
              />
              <circle
                cx={`${node.x}%`}
                cy={`${node.y}%`}
                r="4"
                className={`${node.type === 'core' ? 'fill-navy' : 'fill-blue-500'}`}
              />
              <text
                x={`${node.x}%`}
                y={`${node.y + 6}%`}
                textAnchor="middle"
                className="text-[7px] font-black uppercase tracking-[0.15em] fill-slate-400 font-mono pointer-events-none"
              >
                {node.label}
              </text>
            </motion.g>
          ))}
        </svg>

        {/* Dynamic Detail Panels */}
        <div className="absolute bottom-8 left-8 space-y-4 pointer-events-none hidden md:block">
           <div className="p-3 bg-white/60 backdrop-blur-md rounded-xl border border-slate-200 shadow-sm space-y-2 w-48">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Logic Layer 7</span>
                <Fingerprint size={12} className="text-navy opacity-40" />
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-navy"
                  animate={{ width: `${60 + (activeStep % 20)}%` }}
                />
              </div>
           </div>
           <div className="p-3 bg-white/60 backdrop-blur-md rounded-xl border border-slate-200 shadow-sm space-y-2 w-48">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Relational Grid</span>
                <Atom size={12} className="text-blue-500 opacity-40" />
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-blue-500"
                  animate={{ width: `${40 + (activeStep % 40)}%` }}
                />
              </div>
           </div>
        </div>
      </div>

      {/* ── Synthesis Progress Footer ── */}
      <div className="shrink-0 bg-white/80 border-t border-slate-200 p-8 z-40 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex gap-12 items-center">
          <div className="flex-1">
            <div className="flex justify-between items-end mb-4">
              <div className="text-[10px] font-black text-navy uppercase tracking-[0.3em] flex items-center gap-2">
                <Radio size={14} className="text-blue-600 animate-pulse" /> Intelligence Integration Matrix
              </div>
              <motion.div 
                className="text-sm font-black text-slate-400 leading-none font-mono uppercase tracking-widest flex items-center gap-2"
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <span className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                Active
              </motion.div>
            </div>
            <div className="relative group space-y-2">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                {STAGE_LABELS[status] || 'PROCESSING'}
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                 <motion.div 
                   className="h-full w-full bg-gradient-to-r from-navy via-blue-600 to-navy rounded-full relative"
                   animate={{
                     opacity: [0.7, 1, 0.7],
                   }}
                   transition={{
                     duration: 1.5,
                     repeat: Infinity,
                     ease: 'easeInOut'
                   }}
                 />
              </div>
              <div className="text-right text-[9px] font-mono text-slate-400">Processing...</div>
            </div>
          </div>

          <div className="shrink-0 flex gap-3">
             {[Shield, Orbit, Atom, Radio].map((Icon, i) => (
               <div key={`icon-${i}`} className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center transition-all hover:border-navy/20 hover:bg-white group cursor-default">
                  <Icon size={18} className="text-slate-400 group-hover:text-navy transition-colors" />
               </div>
             ))}
          </div>
        </div>
      </div>
    </div>
  );
}
