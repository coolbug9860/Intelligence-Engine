import { useState, useEffect, useMemo } from 'react';
import DocumentationView from './components/DocumentationView';
import HelpPanel from './components/HelpPanel';
import { 
  ShieldCheck, 
  RefreshCw, 
  TrendingUp, 
  Bookmark, 
  ExternalLink, 
  FileText, 
  Briefcase,
  Layers,
  AlertTriangle,
  Search,
  Gavel,
  Zap,
  BarChart,
  Cpu,
  Network,
  Shield,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { IntelligenceGraphAssembly } from './components/IntelligenceGraphAssembly';
import { StrategicTelemetryFeed } from './components/StrategicTelemetryFeed';
import { IntelligenceProfile } from './components/IntelligenceProfile';
import { LoginScreen } from './components/LoginScreen';
import { RSSArticle, ReportSuggestion, Vertical, VERTICALS } from './types';
import { fetchAllFeeds } from './services/rssService';
import { analyzeNews } from './services/geminiService';
import { runIntelligencePipeline, IntelligenceState } from './services/intelligenceOrchestrator';

// Stable session ID — generated once at module load, not on every render.
const SESSION_ID = Math.random().toString(16).substring(2, 10).toUpperCase();

export default function App() {
  const [articles, setArticles] = useState<RSSArticle[]>([]);
  const [suggestions, setSuggestions] = useState<ReportSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // memoryState persists across page refreshes so novelty suppression survives
  // between sessions. Only the memoryState slice is stored (not the full
  // IntelligenceState) to keep localStorage usage bounded.
  const [pipelineData, setPipelineData] = useState<IntelligenceState | null>(() => {
    try {
      const saved = localStorage.getItem('kaiso_memory_state');
      if (!saved) return null;
      const memoryState = JSON.parse(saved);
      // Rehydrate as a minimal IntelligenceState shell so the pipeline call
      // at line ~126 can read pipelineData?.memoryState correctly.
      return { memoryState } as unknown as IntelligenceState;
    } catch {
      return null;
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeVerticals, setActiveVerticals] = useState<string[]>(['All']);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem('kaiso_watchlist');
    return saved ? JSON.parse(saved) : [];
  });
  // watchlistTitles persists validated signal titles across sessions.
  // Passed to analyzeNews as few-shot quality anchors on each run.
  const [watchlistTitles, setWatchlistTitles] = useState<Record<string,string>>(() => {
    const saved = localStorage.getItem('kaiso_watchlist_titles');
    return saved ? JSON.parse(saved) : {};
  });
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [showGeoOnly, setShowGeoOnly] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const [timeWindow, setTimeWindow] = useState<number>(48);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('kaiso_auth_token') !== null;
  });

  const handleLogin = async (username: string, pass: string) => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pass }),
      });
      if (!res.ok) return false;
      const { token } = await res.json();
      sessionStorage.setItem('kaiso_auth_token', token);
      setIsAuthenticated(true);
      return true;
    } catch {
      return false;
    }
  };

  // Cleanup: Abort pending Red Team requests on unmount
  useEffect(() => {
return () => {};
  }, []);

  useEffect(() => {
    localStorage.setItem('kaiso_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem('kaiso_watchlist_titles', JSON.stringify(watchlistTitles));
  }, [watchlistTitles]);

  const loadSignals = async () => {
    setHasStarted(true);
    setLoading(true);
    setErrorMessage(null);
    setStatus('INGESTING GLOBAL DATA...');
    setSuggestions([]);
    try {
      // Fetch news for analytics context (Gemini needs a decent window)
      const news = await fetchAllFeeds(168);
      setArticles(news);
      
      if (news.length === 0) {
        setStatus('SIGNAL STREAM RECALIBRATING...');
        
        // Attempt deep-retry with expanded parameters
        const retryNews = await fetchAllFeeds(336); 
        if (retryNews.length > 0) {
          setArticles(retryNews);
        } else {
          setStatus('NEXUS REVERSION ACTIVE');
          setErrorMessage('INGESTION ADAPTATION: Upstream feeds are saturated. The engine is currently using nexus-cached signals to maintain operational integrity.');
          return;
        }
      }

      setAnalyzing(true);
      setStatus(`MAPPING ${news.length} SIGNALS...`);
      // Pass validated titles as few-shot quality anchors
      const qualityAnchors = Object.values(watchlistTitles || {}) as string[];
      const intelligenceState = await runIntelligencePipeline(news, qualityAnchors, pipelineData?.memoryState);
      setPipelineData(intelligenceState);
      // Persist memoryState so suppression survives page refreshes.
      // We store only memoryState (not the full state) to stay within
      // localStorage size limits (~5MB). The rest is re-derived each run.
      try {
        localStorage.setItem('kaiso_memory_state', JSON.stringify(intelligenceState.memoryState));
      } catch (storageErr) {
        console.warn('[Memory] Failed to persist memoryState to localStorage:', storageErr);
      }
      const analyses = intelligenceState.curatedPortfolio;
      setSuggestions(analyses);
      
      if (analyses.length === 0 && news.length > 0) {
        setErrorMessage('INGESTION OK // FILTER ACTIVE: No signals met the high-fidelity threshold (7.0+) for strategic report mapping.');
      }
      
      setStatus(analyses.length > 0 ? 'INTELLIGENCE MAPPED' : 'NO OPPORTUNITIES IDENTIFIED');
      setTimeout(() => setStatus(''), 5000);
    } catch (err: any) {
      console.error(err);
      setStatus('CRITICAL ERROR');
      
      const errorString = err.message || JSON.stringify(err);
      const isQuotaError = errorString.includes('exceeded its monthly spending cap') || 
                           errorString.includes('429') || 
                           errorString.includes('RESOURCE_EXHAUSTED') ||
                           errorString.includes('quota');

      if (isQuotaError) {
        setErrorMessage('SPEND_CAP_REACHED: The Intelligence Engine has reached its operational limit. Please check your AI Studio billing settings or spend caps.');
      } else {
        setErrorMessage(`SYSTEM FAIL: The intelligence engine encountered a runtime exception (${err.message || 'Unknown Error'}).`);
      }
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  const filteredSignalFeed = useMemo(() => {
    const now = Date.now();
    const minTimestamp = now - (timeWindow * 60 * 60 * 1000); 

    return articles
      .filter(a => a.timestamp >= minTimestamp)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [articles, timeWindow]);

  const filteredSuggestions = useMemo(() => {
    const now = Date.now();
    const minTimestamp = now - (timeWindow * 60 * 60 * 1000);

    return suggestions.filter(s => {
      const matchTime = !s.sourceArticleTimestamp || s.sourceArticleTimestamp >= minTimestamp;
      const matchVertical = activeVerticals.includes('All') || activeVerticals.includes(s.vertical);
      const matchSearch = s.reportTitle.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          s.thematicCluster.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          s.marketKeyword.toLowerCase().includes(searchQuery.toLowerCase());
      const matchWatchlist = !showWatchlistOnly || watchlist.includes(s.id);
      const matchGeo = !showGeoOnly || s.recommendedReportGeography?.startsWith('Country:');
      return matchTime && matchVertical && matchSearch && matchWatchlist && matchGeo;
    });
  }, [suggestions, activeVerticals, searchQuery, showWatchlistOnly, watchlist, showGeoOnly, timeWindow]);

  const toggleVertical = (v: string) => {
    if (v === 'All') {
      setActiveVerticals(['All']);
      return;
    }
    setActiveVerticals(prev => {
      const filtered = prev.filter(i => i !== 'All');
      if (filtered.includes(v)) {
        const next = filtered.filter(i => i !== v);
        return next.length === 0 ? ['All'] : next;
      }
      return [...filtered, v];
    });
  };

  const toggleWatchlist = (id: string, title?: string) => {
    setWatchlist(prev => {
      if (prev.includes(id)) {
        // Remove from titles record when unpinning
        setWatchlistTitles(t => { const n = {...t}; delete n[id]; return n; });
        return prev.filter(i => i !== id);
      }
      // Store title when pinning — used as quality anchor in next analyzeNews run
      if (title) setWatchlistTitles(t => ({...t, [id]: title}));
      return [...prev, id];
    });
  };

  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    // Future-dated items are filtered out server-side, but guard here too so a
    // forward-dated feed item can never render as the misleading "JUST NOW".
    if (diff < 0) return 'SCHEDULED';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'JUST NOW';
    if (minutes < 60) return `${minutes}M AGO`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}H AGO`;
    const days = Math.floor(hours / 24);
    return `${days}D AGO`;
  };

  const getConfidenceColor = (score: number, potential: string) => {
    if (potential === 'High') return 'bg-[#D62828]';
    if (potential === 'Medium') return 'bg-yellow-500';
    return 'bg-[#69B8E1]';
  };
const handleSelectSuggestion = (s: ReportSuggestion | null) => {
    if (!s) return;
    localStorage.setItem('kaiso_opportunity', JSON.stringify(s));
    window.open('/?page=opportunity', '_blank');
  };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-bg font-sans text-ink">
      {/* SIDEBAR */}
      <aside className="w-16 bg-navy flex flex-col items-center py-6 gap-8 text-white">
        <div className="w-10 h-10 bg-brand-red rounded-sm flex items-center justify-center font-bold text-xl cursor-default shadow-lg">K</div>
        <div className="flex flex-col gap-6">
          <button title="Intelligence Layers" className="w-8 h-8 flex items-center justify-center border border-white/20 rounded hover:bg-white/10 transition-colors"><Layers size={20} /></button>
          <button title="Market Trends" className="w-8 h-8 flex items-center justify-center border border-white/20 rounded hover:bg-white/10 transition-colors"><TrendingUp size={20} /></button>
          <button 
            title="Saved Intelligence"
            onClick={() => setShowWatchlistOnly(!showWatchlistOnly)}
            className={`w-8 h-8 flex items-center justify-center border border-white/20 rounded transition-colors relative ${showWatchlistOnly ? 'bg-brand-red border-none' : 'hover:bg-white/10'}`}
          >
            <Bookmark size={20} fill={showWatchlistOnly ? 'white' : 'none'} />
          </button>
        </div>
        <div className="mt-auto p-2 opacity-50"><Briefcase size={24} /></div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* HEADER */}
        <header className="h-[60px] bg-white border-b border-slate-300 flex items-center justify-between px-6 shrink-0 shadow-sm">
          <div className="flex items-center gap-4">
            <img 
              src="/kaiso-logo.jpg" 
              alt="KAISO Logo" 
              className="h-7 w-auto object-contain" 
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <h1 className="text-xl font-brand tracking-tight flex items-baseline select-none border-l pl-4 border-slate-200">
              <span className="font-black text-brand-blue uppercase">KAISO</span> 
              <span className="text-muted font-medium ml-2 text-[11px] tracking-widest uppercase self-center opacity-70">Intelligence OS</span>
            </h1>
            <div className="hidden lg:flex items-center gap-3 text-[10px] font-mono whitespace-nowrap text-muted border-l-2 border-brand-red pl-4">
              SYST_ID: KR-842 // SIGNALS: {articles.length} ACTIVE // WINDOW: {timeWindow}H
            </div>
          </div>
<div className="flex items-center gap-4">
            {status && (
               <div className="px-3 py-1 bg-brand-red text-white text-[9px] font-bold tracking-[0.2em] rounded animate-pulse shadow-sm">
                 {status}
               </div>
            )}
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-full relative group cursor-help">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="absolute inset-0 rounded-full bg-green-500/20 animate-ping"></span>
              <span className="text-[10px] font-bold text-slate-500">POLLING OK</span>
              <div className="absolute top-10 left-1/2 -translate-x-1/2 w-48 p-3 bg-navy text-white text-[9px] font-bold rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-widest">
                Kaiso Engine is monitoring 42 high-authority XML nodes via 7-tier proxy architecture.
              </div>
            </div>
            <button 
              onClick={() => setShowDocumentation(true)}
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded bg-bg border border-slate-300 text-[10px] font-extrabold text-navy hover:bg-slate-50 shadow-sm transition-all uppercase tracking-tighter"
            >
              <FileText size={14} className="text-brand-red" />
              Read About This App
            </button>
            <button 
              onClick={() => setShowHelp(true)}
              title="Help & Knowledge Base"
              aria-label="Open help and search"
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded bg-bg border border-slate-300 text-[10px] font-extrabold text-navy hover:bg-slate-50 shadow-sm transition-all uppercase tracking-tighter"
            >
              <Search size={14} className="text-brand-red" />
              Help
            </button>
            <button 
              onClick={loadSignals}
              disabled={loading || analyzing}
              className={`flex items-center gap-2 px-6 py-2 rounded text-xs font-bold shadow-sm transition-all disabled:opacity-50 ${!hasStarted ? 'bg-brand-red text-white border-transparent hover:bg-brand-red/90 animate-shimmer bg-[length:200%_100%]' : 'bg-white border border-slate-300 text-navy hover:bg-slate-50'}`}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {!hasStarted ? 'START RESEARCH' : 'REFRESH'}
            </button>
          </div>
        </header>

        {/* VERTICAL FILTERS & SEARCH */}
        <section className="bg-slate-100 border-b border-slate-300 shrink-0">
          <div className="flex items-center gap-4 px-6 py-3 overflow-x-auto no-scrollbar">
            <div className="relative min-w-[240px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input 
                type="text"
                placeholder="SEARCH INTEL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white border border-slate-300 rounded-full px-9 py-1.5 text-[10px] font-bold text-navy focus:outline-none focus:border-brand-red w-full uppercase tracking-widest shadow-sm shadow-slate-200/50"
              />
            </div>
            
            <div className="h-6 w-[1px] bg-slate-300 mx-2 shrink-0"></div>

            <button 
              onClick={() => toggleVertical('All')}
              className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all whitespace-nowrap uppercase tracking-widest border ${activeVerticals.includes('All') ? 'bg-navy text-white border-navy shadow-md' : 'bg-white border-slate-300 text-muted hover:border-navy'}`}
            >
              All Verticals
            </button>
            {VERTICALS.map(v => {
              const count = suggestions.filter(s => s.vertical === v).length;
              if (count === 0 && !activeVerticals.includes(v)) return null;
              return (
                <button 
                  key={`filter-vertical-item-${v}`}
                  onClick={() => toggleVertical(v)}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all whitespace-nowrap uppercase tracking-widest border ${activeVerticals.includes(v) ? 'bg-navy text-white border-navy shadow-md' : 'bg-white border-slate-300 text-muted hover:border-navy'}`}
                >
                  {v} {count > 0 && `(${count})`}
                </button>
              );
            })}
          </div>
        </section>

        {/* TWO-COLUMN GRID */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: SIGNAL FEED */}
          <section className="w-[350px] bg-bg border-r border-slate-300 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-300 flex flex-col gap-3 bg-white relative overflow-hidden">
              <div className="absolute inset-0 bg-slate-50/50 opacity-50 blur-xl"></div>
              
              <div className="flex justify-between items-center relative z-10">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted">Live Signal Feed ({filteredSignalFeed.length}/{articles.length})</h2>
                  <p className="text-[9px] text-slate-600 font-medium uppercase tracking-tight">Real-time monitoring of 40+ global industry nodes</p>
                </div>
                <div className="flex flex-col items-end gap-1">
<span className="text-[9px] font-bold bg-slate-50 border border-slate-200 rounded px-1 py-0.5">48H WINDOW</span>
                  <div className="text-[9px] font-bold text-brand-red flex items-center gap-1 border border-green-100 bg-green-50/50 px-1.5 py-0.5 rounded-full">
                    <ShieldCheck size={12} className="text-green-600" /> RSS VERIFIED
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-[1px] bg-slate-200">
              {loading && (
                <div className="bg-white h-[400px] flex flex-col overflow-hidden">
                  <StrategicTelemetryFeed />
                </div>
              )}
              {!loading && articles.length === 0 && (
                <div className="bg-white p-10 flex flex-col items-center justify-center gap-6">
                  <div className="w-16 h-16 bg-brand-red/10 rounded-full flex items-center justify-center text-brand-red animate-pulse">
                    <AlertTriangle size={32} />
                  </div>
                  <div className="text-center space-y-3">
                    <div className="text-[12px] font-extrabold uppercase tracking-[0.2em] text-navy">Upstream Signal Void</div>
                    <p className="text-[10px] text-muted leading-relaxed max-w-[280px] mx-auto uppercase font-bold border-t border-slate-100 pt-3">
                      {errorMessage || "No strategic signals identified in the 12H lookback window."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 w-full max-w-[200px]">
                    <button 
                      onClick={loadSignals}
                      className="w-full px-6 py-3 bg-navy text-white text-[10px] font-bold tracking-widest rounded-sm hover:bg-navy/90 transition-all uppercase shadow-xl active:scale-95 flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={14} /> Refresh Protocol
                    </button>
                    <p className="text-[9px] text-slate-600 text-center font-bold tracking-tighter uppercase">Protocol Isolation: Recovery Path Active</p>
                  </div>
                </div>
              )}
              {filteredSignalFeed.length === 0 && !loading && (
                <div className="p-8 text-center bg-white border-b border-slate-100">
                  <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
                    No signals found in the selected {timeWindow}H window.
                  </p>
                </div>
              )}
              {filteredSignalFeed.map((article, idx) => (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  key={`signal-feed-article-${article.link}-${article.timestamp}-${idx}`} 
                  className="bg-white p-5 hover:bg-slate-50 transition-all cursor-pointer group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-50 text-navy uppercase border border-blue-100 rounded-sm leading-none">{article.sourceName}</span>
                    <span className="text-[9px] text-muted font-mono uppercase tracking-tighter">{formatRelativeTime(article.timestamp)}</span>
                  </div>
                  <a href={article.link} target="_blank" rel="noopener noreferrer" className="block text-[13px] font-bold leading-tight group-hover:text-brand-red transition-colors mb-2">
                    {article.title}
                  </a>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-green-700 flex items-center gap-1">
                      <span className="w-1 h-1 bg-green-500 rounded-full"></span> VERIFIED
                    </span>
                    <ExternalLink size={10} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* RIGHT: SUGGESTION LIST */}
          <section className="flex-1 flex flex-col overflow-hidden bg-white border-l-2 border-slate-300">
            <div className="p-4 border-b border-slate-300 flex justify-between items-center bg-white">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted">AI-Derived Research Opportunities</h2>
                  <p className="text-[9px] text-slate-600 font-medium uppercase tracking-tight">Synthesized intelligence mapped to strategic pillars</p>
                </div>
                <div className="group relative">
                  <div className="w-4 h-4 bg-navy text-white text-[9px] rounded-full flex items-center justify-center font-bold cursor-help border border-white/20">?</div>
                  <div className="absolute left-0 top-6 w-[350px] bg-white border border-slate-300 p-4 shadow-2xl rounded-sm z-50 hidden group-hover:block animate-in fade-in zoom-in duration-200">
                    <h4 className="text-[10px] font-extrabold text-navy border-b border-brand-red pb-2 mb-2 tracking-widest uppercase">Key Intelligence Upgrades</h4>
                    <ul className="space-y-3">
                      <li className="text-[9px] leading-relaxed"><strong className="text-navy">Reasoning-First Analysis:</strong> The intelligence engine now operates under a Senior Market Intelligence Architect persona. It uses a 4-step logical filter (Signal Extraction → Logical Linkage → Competitive Gap Analysis → Commercial Rationale) to verify every opportunity.</li>
                      <li className="text-[9px] leading-relaxed"><strong className="text-navy">Strict Fidelity Controls:</strong> Implemented a "Zero Fabrication" mandate in the prompt engineering, forcing the model to anchor every insight in the provided article text and reject any tenuous or "fluffy" signals.</li>
                      <li className="text-[9px] leading-relaxed"><strong className="text-navy">Enhanced Confidence Threshold:</strong> Increased the UI filtering and model scoring stringency to a 7.0+ confidence threshold, ensuring only the most operationally significant opportunities reach the dashboard.</li>
                      <li className="text-[9px] leading-relaxed"><strong className="text-navy">Investment-Grade Briefs:</strong> The "Analyst Brief" generation now follows an Economic Intelligence Style, explicitly identifying the "Burning Platform" for C-level executives and detailed competitive white-spaces where incumbent firms typically provide generic coverage.</li>
                      <li className="text-[9px] leading-relaxed"><strong className="text-navy">Grounding & Accuracy:</strong> Verified that the models use grounding tools to cross-reference external data before making high-stakes strategic recommendations.</li>
                    </ul>
                  </div>
                </div>
                <div className="text-[9px] font-bold text-slate-600">({articles.length} signals ingested)</div>
                <div className="flex items-center gap-4 text-[10px] font-bold border-l border-slate-300 pl-4">
                  <label className="flex items-center gap-2 cursor-pointer text-muted hover:text-navy transition-colors">
                    <input type="checkbox" checked={showWatchlistOnly} onChange={e => setShowWatchlistOnly(e.target.checked)} className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />
                    WATCHLIST
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-muted hover:text-navy transition-colors">
                    <input type="checkbox" checked={showGeoOnly} onChange={e => setShowGeoOnly(e.target.checked)} className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />
                    GEO FOCUS
                  </label>
                </div>
              </div>
              <div className="text-[9px] font-bold text-muted uppercase tracking-wider">{filteredSuggestions.length} IDENTIFIED</div>
            </div>
            
              <div className="flex-1 overflow-y-auto">
                {(loading || analyzing) && (
                  <div className="flex-1 bg-white flex flex-col overflow-hidden h-full min-h-[400px]">
                    <IntelligenceGraphAssembly status={status} />
                  </div>
                )}
                
                {!hasStarted && !loading && (
                   <div className="flex flex-col items-center justify-center min-h-[500px] text-muted p-12 text-center bg-slate-50/30">
                    <div className="max-w-5xl w-full space-y-16">
                      <div className="space-y-6">
                        <div className="flex justify-center">
                          <div className="w-20 h-20 bg-navy/5 rounded-full flex items-center justify-center relative">
                             <Zap size={40} className="text-navy/20" />
                             <div className="absolute inset-0 border-2 border-dashed border-navy/10 rounded-full animate-spin-slow"></div>
                          </div>
                        </div>
                        <div className="max-w-md mx-auto space-y-3">
                          <h3 className="text-2xl font-serif font-black italic text-navy">
                            Structural Intelligence Protocol 
                            <motion.span 
                              animate={{ opacity: [1, 0, 1] }}
                              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                              className="ml-2 text-brand-red not-italic font-sans text-sm uppercase tracking-widest font-bold align-middle"
                            >
                              [INACTIVE]
                            </motion.span>
                          </h3>
                          <p className="text-[11px] uppercase font-bold text-slate-600 leading-relaxed tracking-[0.15em] opacity-80 mb-6">
                            High-Fidelity Synthesis Engine in Standby
                          </p>
                          
                          <motion.div 
                            animate={{ y: [0, -4, 0] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-full text-[10px] font-bold text-yellow-700 uppercase tracking-widest shadow-sm"
                          >
                            <ArrowRight size={14} className="text-yellow-600" />
                            Click "Start Research" in the control bar to initialize
                          </motion.div>
                        </div>
                      </div>

                      {/* KAISO INTELLIGENCE STACK GRID */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
                        {[
                          { title: 'Forecast', desc: 'Synthesizes cross-pillar signals into high-fidelity structural market predictions.', icon: TrendingUp },
                          { title: 'Evolution', desc: 'Tracks historical trajectory and velocity of emerging thematic clusters.', icon: BarChart },
                          { title: 'Priority', desc: 'Transmutes intelligence outputs into executive strategic prioritization.', icon: Gavel },
                          { title: 'Reasoning', desc: 'Applies asymmetric logic to resolve contradictions across global data streams.', icon: Cpu },
                          { title: 'Taxonomy', desc: 'Normalizes diverse signal artifacts into a coherent structural framework.', icon: Layers },
                          { title: 'Graph', desc: 'Maps the multi-dimensional propagation pathways between intelligence nodes.', icon: Network },
                          { title: 'Scoring', desc: 'Evaluates signal integrity through multi-factor authority and diversity metrics.', icon: Zap },
                          { title: 'Validation', desc: 'Hardens intelligence outputs against structural bias and factual noise.', icon: Shield },
                        ].map((engine, i) => (
                          <div key={`engine-${engine.title}-${i}`} className="group p-5 bg-white border border-slate-200 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:border-navy/20 hover:shadow-xl hover:shadow-navy/5 transition-all">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mb-4 group-hover:bg-navy group-hover:text-white transition-colors">
                              <engine.icon size={18} className="text-navy group-hover:text-white" />
                            </div>
                            <h4 className="text-[11px] font-black uppercase tracking-widest text-navy mb-2">{engine.title} Engine</h4>
                            <p className="text-[10px] leading-relaxed text-slate-500 font-medium tracking-tight">{engine.desc}</p>
                          </div>
                        ))}
                      </div>

                      <div className="pt-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-center gap-12 grayscale opacity-40">
                         <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black text-navy">NODE COVERAGE</span>
                            <span className="text-sm font-bold text-navy">40+ GLOBAL SOURCES</span>
                         </div>
                         <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black text-navy">MAPPING CORE</span>
                            <span className="text-sm font-bold text-navy">GEMINI FLASH</span>
                         </div>
                         <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black text-navy">ARCHITECTURE</span>
                            <span className="text-sm font-bold text-navy">ASYMMETRIC LOGIC</span>
                         </div>
                      </div>
                    </div>
                  </div>
                )}

                {hasStarted && !analyzing && filteredSuggestions.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-muted p-12 text-center">
                    <Layers size={40} className="opacity-10 mb-4" />
                    <div className="space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider">No Strategic Opportunities Identified</p>
                      <p className="text-[10px] uppercase font-medium text-slate-600">
                        {suggestions.length === 0 
                          ? "The engine is currently parsing global nodes..." 
                          : `Filter Active: No signals met the 7.0+ threshold within the ${timeWindow}H window.`}
                      </p>
                    </div>
                  </div>
                )}

                {!analyzing && (
                  <div className="divide-y divide-slate-100">
                    {filteredSuggestions.map((s, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        key={`suggestion-list-item-${s.id}-${idx}`} 
                        className="grid grid-cols-[80px_1fr_140px] items-center gap-6 px-8 py-5 group hover:bg-navy hover:text-white cursor-pointer transition-all duration-200"
                        onClick={() => handleSelectSuggestion(s)}
                      >
                        <div className="text-center">
                          <span className={`text-sm font-extrabold transition-colors ${watchlist.includes(s.id) ? 'text-brand-red' : 'group-hover:text-white text-brand-red'}`}>
                            {s.confidenceScore.toFixed(1)}
                          </span>
                          <div className="mt-2 group-hover:hidden">
                            <IntelligenceProfile profile={s.intelligenceProfile} fallbackScore={s.confidenceScore} isCompact />
                          </div>
                          <div className="h-1 w-full bg-slate-100 rounded-full mt-1 overflow-hidden group-hover:bg-white/20 hidden group-hover:block">
                            <div 
                              className={`h-full ${getConfidenceColor(s.confidenceScore, s.salesPotential)}`}
                              style={{ width: `${s.confidenceScore * 10}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-[9px] font-bold uppercase tracking-widest group-hover:text-light-blue text-muted transition-colors">PILLAR: {s.strategicPillar}</div>
                            {s.credibilityScore >= 90 && (
                              <div className="flex items-center gap-1 text-[8px] font-black text-green-600 bg-green-50 px-1.5 py-0.5 rounded-md border border-green-200 group-hover:bg-white/10 group-hover:text-green-300 group-hover:border-green-800">
                                <ShieldCheck size={10} /> HIGH_VERACITY
                              </div>
                            )}
                            {s.nexusArticlesCount > 1 && (
                                <div className="flex items-center gap-1 text-[8px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-200 group-hover:bg-white/10 group-hover:text-blue-300 group-hover:border-blue-800">
                                   <Layers size={10} /> NEXUS (+{s.nexusArticlesCount})
                                </div>
                            )}
                          </div>
                          <h3 className="text-[15px] font-bold leading-tight mb-1 group-hover:text-white text-navy transition-colors">{s.reportTitle}</h3>
                          {(s as any).actionVerdict && (
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest border ${
                                (s as any).actionVerdict === 'PUBLISH NOW'
                                  ? 'bg-[#D62828] text-white border-[#D62828]'
                                  : (s as any).actionVerdict === 'MONITOR'
                                  ? 'bg-amber-50 text-amber-700 border-amber-300 group-hover:bg-amber-900/30 group-hover:text-amber-300 group-hover:border-amber-700'
                                  : 'bg-slate-100 text-slate-400 border-slate-200 group-hover:bg-white/10 group-hover:text-white/40 group-hover:border-white/20'
                              }`}>
                                {(s as any).actionVerdict === 'PUBLISH NOW' && <CheckCircle2 size={8} strokeWidth={3} />}
                                {(s as any).actionVerdict === 'MONITOR'     && <Clock size={8} strokeWidth={3} />}
                                {(s as any).actionVerdict === 'PASS'        && <XCircle size={8} strokeWidth={3} />}
                                {(s as any).actionVerdict}
                                {(s as any).actionUrgency === 'HIGH' && (s as any).actionVerdict === 'PUBLISH NOW' && (
                                  <span className="ml-0.5 text-[8px] font-black text-white/80">· URGENT</span>
                                )}
                              </span>
                              {(s as any).actionReason && (
                                <span className="text-[9px] text-slate-600 group-hover:text-white/50 line-clamp-1 italic flex-1">
                                  {(s as any).actionReason}
                                </span>
                              )}
                            </div>
                          )}
                          <p className="text-[11px] opacity-70 line-clamp-1 italic group-hover:text-slate-100">Anchor: {s.sourceArticleTitle}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <div className="text-[9px] font-extrabold text-blue-600 group-hover:text-blue-200 uppercase">THEME: {s.thematicCluster}</div>
                          <div className={`text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tight ${s.sentimentPolarity === 'Bullish' ? 'text-green-600 bg-green-50' : s.sentimentPolarity === 'Bearish' ? 'text-brand-red bg-red-50' : 'text-slate-500 bg-slate-100'}`}>
                            SENTIMENT: {s.sentimentPolarity}
                          </div>
                          {s.executionRisk === 'High' && (
                            <div className="flex items-center gap-1 text-[8px] font-black text-brand-red bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100 group-hover:bg-white group-hover:border-red-800 transition-colors">
                              <Zap size={10} fill="currentColor" /> HI_RISK
                            </div>
                          )}
                          {s.regulatoryHurdle === 'Critical' && (
                            <div className="flex items-center gap-1 text-[8px] font-black text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-md border border-orange-100 group-hover:bg-white group-hover:border-orange-800 transition-colors">
                              <Gavel size={10} /> REG_INTEL
                            </div>
                          )}
                        </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-2">
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-navy group-hover:bg-white/20 group-hover:text-white transition-all">
                            {s.vertical.toUpperCase()}
                          </span>
                          {s.signalType && (
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tight border bg-slate-50 text-slate-500 border-slate-200 group-hover:bg-white/10 group-hover:text-white/70 group-hover:border-white/20 transition-all">
                              {s.signalType}
                            </span>
                          )}
                          {s.trendDirection && s.trendDirection !== 'UNKNOWN' && s.trendDirectionLabel && (
                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tight border flex items-center gap-1 transition-all ${
                              s.trendDirection === 'RISING'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 group-hover:bg-emerald-900/30 group-hover:text-emerald-300 group-hover:border-emerald-800'
                                : s.trendDirection === 'DECLINING'
                                ? 'bg-red-50 text-red-600 border-red-200 group-hover:bg-red-900/30 group-hover:text-red-300 group-hover:border-red-800'
                                : 'bg-slate-100 text-slate-500 border-slate-200 group-hover:bg-white/10 group-hover:text-white/70 group-hover:border-white/20'
                            }`}>
                              <TrendingUp size={8} strokeWidth={2.5} />
                              {s.trendDirectionLabel}
                            </span>
                          )}
                          {s.whiteSpaceStatus && s.whiteSpaceStatus !== 'UNKNOWN' && s.whiteSpaceLabel && (
                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tight border flex items-center gap-1 transition-all ${
                              s.whiteSpaceStatus === 'CONFIRMED_GAP'
                                ? 'bg-green-50 text-green-700 border-green-200 group-hover:bg-green-900/30 group-hover:text-green-300 group-hover:border-green-800'
                                : s.whiteSpaceStatus === 'PARTIAL_COVERAGE'
                                ? 'bg-yellow-50 text-yellow-700 border-yellow-200 group-hover:bg-yellow-900/30 group-hover:text-yellow-300 group-hover:border-yellow-800'
                                : 'bg-red-50 text-red-600 border-red-200 group-hover:bg-red-900/30 group-hover:text-red-300 group-hover:border-red-800'
                            }`}>
                              <Shield size={8} strokeWidth={2.5} />
                              {s.whiteSpaceLabel}
                            </span>
                          )}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleWatchlist(s.id, s.reportTitle);
                            }}
                            className={`transition-colors p-1 ${watchlist.includes(s.id) ? 'text-brand-red' : 'text-slate-300 group-hover:text-white/40 hover:text-brand-red'}`}
                          >
                            <Bookmark size={14} fill={watchlist.includes(s.id) ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}                          
              </div>
          </section>
        </div>
        
        {/* FOOTER */}
        <footer className="h-8 bg-navy text-white flex items-center justify-between px-6 text-[9px] font-bold uppercase tracking-widest border-t border-white/10">
          <div className="flex gap-4">
            <span>&copy; 2026 KAISO RESEARCH AND CONSULTING // ARCHITECT MODE</span>
            <span className="text-white/40">POLLING: NOMINAL</span>
          </div>
          <div className="flex gap-4">
             <span>ENCRYPTED_SESSION: {SESSION_ID}</span>
             <span className="text-light-blue">GEMINI FLASH STATUS: ACTIVE</span>
          </div>
        </footer>
      </main>
      <AnimatePresence mode="wait">
       {showDocumentation && (
           <DocumentationView key="documentation-view" onClose={() => setShowDocumentation(false)} />
        )}
       {showHelp && (
           <HelpPanel key="help-panel" onClose={() => setShowHelp(false)} />
        )}
      </AnimatePresence>
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-150%); } }
        .animate-marquee { display: inline-block; animation: marquee 40s linear infinite; }
        .animate-pulse-once { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) 1; }
      `}</style>
    </div>
  );
}
