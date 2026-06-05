import React from 'react';
import { motion } from 'motion/react';
import { X, FileText, ChevronRight, CheckCircle2, Zap, Target, Search, BarChart3, Globe, ShieldCheck } from 'lucide-react';

interface DocumentationViewProps {
  onClose: () => void;
}

const DocumentationView: React.FC<DocumentationViewProps> = ({ onClose }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 bg-white z-[100] flex flex-col font-sans text-navy overflow-hidden"
    >
      {/* HEADER */}
      <header className="h-[70px] border-b border-slate-200 flex items-center justify-between px-8 bg-slate-50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-red flex items-center justify-center rounded-sm">
            <FileText size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-tighter">Strategic Tutorial & Operational Guide</h1>
            <p className="text-[10px] text-muted font-bold uppercase tracking-[0.2em] opacity-60">Version 3.0 // Proprietary Intelligence Protocol</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 hover:bg-slate-200 rounded transition-colors text-[10px] font-extrabold uppercase tracking-tight border border-slate-300 shadow-sm"
        >
          <X size={16} /> Exit Tutorial
        </button>
      </header>

      {/* CONTENT GRID */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-5xl mx-auto py-16 px-8">
          
          {/* HERO SECTION */}
          <section className="mb-20 text-center">
            <div className="inline-block px-4 py-1.5 bg-navy text-white text-[10px] font-black uppercase tracking-[0.4em] mb-8 rounded-full">The Kaiso Intelligence Hub</div>
            <h2 className="text-6xl font-black tracking-tighter mb-8 leading-[0.9]">Transforming Global <span className="text-brand-red underline decoration-4 underline-offset-8">Noise</span> into Investment-Grade <span className="text-brand-red underline decoration-4 underline-offset-8">Signal</span>.</h2>
            <p className="text-xl text-slate-500 font-medium max-w-3xl mx-auto leading-relaxed">
              An automated Strategic Command Center engineered for Kaiso Research & Consulting. We monetize global volatility by identifying the commercial research opportunities before they hit the mainstream.
            </p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-24">
            <div className="space-y-4">
              <div className="w-12 h-12 bg-slate-100 rounded flex items-center justify-center text-brand-red">
                <Target size={24} />
              </div>
              <h3 className="text-lg font-black uppercase tracking-tight">The Purpose</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                To eliminate the 40+ hours of manual market scanning. Kaiso intteligence engine automates discovery, identifies market gaps, and drafts publication-ready report outlines in seconds.
              </p>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 bg-slate-100 rounded flex items-center justify-center text-brand-red">
                <Globe size={24} />
              </div>
              <h3 className="text-lg font-black uppercase tracking-tight">Who it's For</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Senior Analysts, Consulting Partners, and Business Development teams looking for "Burning Platforms" to initiate high-value B2B report sales.
              </p>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 bg-slate-100 rounded flex items-center justify-center text-brand-red">
                <Zap size={24} />
              </div>
              <h3 className="text-lg font-black uppercase tracking-tight">How it Helps</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Positions Kaiso 2-4 weeks ahead of incumbents (Technavio, Grand View) by capturing emerging themes at the precise moment of "Strategic Inflection."
              </p>
            </div>
          </div>

          {/* SECTION: HOW IT WORKS */}
          <section className="mb-24">
            <div className="flex items-center gap-4 mb-12">
               <div className="h-[2px] flex-1 bg-slate-200"></div>
               <h2 className="text-xs font-black uppercase tracking-[0.5em] text-slate-400">The Intelligence Architecture</h2>
               <div className="h-[2px] flex-1 bg-slate-200"></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
               <div className="space-y-12">
                  <div className="relative pl-12 border-l-2 border-slate-100">
                     <div className="absolute -left-[11px] top-0 w-5 h-5 rounded-full bg-navy border-4 border-white shadow-sm font-black text-[8px] flex items-center justify-center text-white">1</div>
                     <h3 className="text-xl font-black uppercase tracking-tight mb-3">Multi-Node Ingestion</h3>
                     <p className="text-sm text-slate-600 leading-relaxed mb-4">
                        The "Nexus Gate" monitors 200+ global signals per hour. It aggregates from 40+ high-authority RSS nodes and integrates dedicated API layers for <strong>NewsAPI</strong> and <strong>NewsData.io</strong>.
                     </p>
                     <div className="bg-slate-50 p-4 border border-slate-200 rounded-sm">
                        <span className="text-[9px] font-black text-brand-red block mb-1 uppercase tracking-widest">Backend Ingestion</span>
                        <p className="text-[11px] text-slate-500 font-bold">Server-side RSS aggregation from 20+ stable feeds (CNBC, NYT, TechCrunch, CoinDesk, etc.) ensures reliable signal fidelity with per-feed error handling and automatic deduplication.</p>
                     </div>
                  </div>

                  <div className="relative pl-12 border-l-2 border-slate-100">
                     <div className="absolute -left-[11px] top-0 w-5 h-5 rounded-full bg-navy border-4 border-white shadow-sm font-black text-[8px] flex items-center justify-center text-white">2</div>
                     <h3 className="text-xl font-black uppercase tracking-tight mb-3">The Logic Filter (AI)</h3>
                     <p className="text-sm text-slate-600 leading-relaxed mb-4">
                        Powered by <strong>Gemini 3 Flash</strong>, the platform analyzes signals against the Kaiso Logic Filter: Signal Extraction → Market Gap Analysis → Pillar Mapping → Commercial Valuation.
                     </p>
                     <div className="flex gap-2">
                        {['Gemini 3 Flash', 'Logic Synthesis', 'Cross-Pillar Mapping'].map(tag => (
                          <span key={tag} className="px-2 py-1 bg-navy/5 text-[9px] font-black text-navy uppercase rounded-sm border border-navy/10">{tag}</span>
                        ))}
                     </div>
                  </div>

                  <div className="relative pl-12 border-l-2 border-slate-100 pb-4">
                     <div className="absolute -left-[11px] top-0 w-5 h-5 rounded-full bg-navy border-4 border-white shadow-sm font-black text-[8px] flex items-center justify-center text-white">3</div>
                     <h3 className="text-xl font-black uppercase tracking-tight mb-3">Commercial Validation</h3>
                     <p className="text-sm text-slate-600 leading-relaxed">
                        Only opportunities with a <strong>Confidence Score of 7.0+</strong> are promoted. Each brief identifies the C-Suite Stakeholder, Market Execution Window, and Nexus Correlation.
                     </p>
                  </div>
               </div>

               <div className="bg-navy p-10 text-white rounded-lg relative overflow-hidden">
                  <BarChart3 size={200} className="absolute -bottom-10 -right-10 text-white/5 rotate-12" />
                  <h3 className="text-2xl font-black uppercase tracking-tighter mb-8 border-b-2 border-brand-red pb-4">Strategic Pillar Framework</h3>
                  <div className="grid grid-cols-1 gap-2 font-mono">
                    {[
                      "Regulatory Trigger", "M&A Activity", "Technology Disruption",
                      "Supply Chain Decoupling", "Geographic Demand Shift", "Patent/IP Filing",
                      "Clinical Breakthrough", "Competitor White Space", "Emerging Application",
                      "ESG/Sustainability Mandate", "Investment Surge", "Consumer Behavior Shift",
                      "Cross-Vertical Convergence"
                    ].map((pillar, i) => (
                      <div key={pillar} className="flex items-center gap-3 py-1.5 border-b border-white/10 text-[10px] font-bold">
                         <span className="text-brand-red w-4">{(i + 1).toString().padStart(2, '0')}</span>
                         <span className="uppercase tracking-widest">{pillar}</span>
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          </section>

          {/* SECTION: 4 STEP TUTORIAL */}
          <section className="mb-24 bg-slate-50 p-12 rounded-xl">
             <h2 className="text-3xl font-black tracking-tighter mb-12 text-center uppercase">4-Step Report Generation Workflow</h2>
             <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                {[
                  { step: 1, title: 'Initialize', desc: 'Click "Start Research" to launch the multi-node ingestion protocol.' },
                  { step: 2, title: 'Analyze', desc: 'Filter by "Confidence Score 8.5+" to isolate high-impact market shocks.' },
                  { step: 3, title: 'Strategy', desc: 'Review the B2B Commercial Rationale and Target Stakeholder mapping.' },
                  { step: 4, title: 'Deploy', desc: 'Click "Generate Brief" for a 10-chapter outline and SEO-ready titles.' },
                ].map(item => (
                  <div key={item.step} className="text-center space-y-3">
                    <div className="w-10 h-10 bg-navy text-white rounded-full mx-auto flex items-center justify-center font-black text-xs">{item.step}</div>
                    <h4 className="font-extrabold uppercase text-xs tracking-widest">{item.title}</h4>
                    <p className="text-[11px] text-slate-500 font-medium">{item.desc}</p>
                  </div>
                ))}
             </div>
          </section>

          {/* SECTION: BENEFITS */}
          <section className="mb-12">
            <h2 className="text-2xl font-black tracking-tight mb-8">Strategic Benefits for Research Reports</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="p-8 border border-slate-200 hover:border-brand-red transition-colors group">
                  <ShieldCheck size={24} className="text-brand-red mb-4" />
                  <h4 className="font-black text-sm uppercase mb-3 tracking-tight">Source Veracity Certification</h4>
                  <p className="text-xs leading-relaxed text-slate-600 font-medium">Every signal is cross-referenced for authority. We do not tolerate fabricated data; every insight is anchored in a verified global news source with a technical justification for its veracity.</p>
               </div>
               <div className="p-8 border border-slate-200 hover:border-brand-red transition-colors group">
                  <BarChart3 size={24} className="text-brand-red mb-4" />
                  <h4 className="font-black text-sm uppercase mb-3 tracking-tight">Nexus Clustering</h4>
                  <p className="text-xs leading-relaxed text-slate-600 font-medium">Identify the "Market Tsunami." Our engine groups disparate signals into thematic clusters, allowing you to track massive category shifts before they become mainstream trends.</p>
               </div>
            </div>
          </section>

          <footer className="mt-24 pt-8 border-t border-slate-200 flex justify-between items-center text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400 font-mono">
            <span>© 2026 Kaiso Research and Consulting</span>
            <span className="flex items-center gap-2 text-navy/40"><Target size={12} /> Document Authorization: Senior Market Intelligence Architect</span>
          </footer>
        </div>
      </div>
    </motion.div>
  );
};

export default DocumentationView;
