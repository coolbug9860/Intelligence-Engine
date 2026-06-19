import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ExternalLink,
  FileText,
  Clock,
  Briefcase,
  Download,
  X,
  Bookmark,
  Loader2,
  Image as ImageIcon,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { ExportDossier } from '../components/ExportDossier';
import { ReportSuggestion } from '../types';
import { generateFullBrief } from '../services/geminiService';

// ─── helpers ────────────────────────────────────────────────────────────────

const confidenceColor = (score: number) => {
  if (score >= 8.5) return { bar: 'bg-[#D62828]', text: 'text-[#D62828]', badge: 'bg-red-50 text-[#D62828] border-red-100' };
  if (score >= 7)   return { bar: 'bg-amber-500',   text: 'text-amber-600',   badge: 'bg-amber-50 text-amber-700 border-amber-100' };
  return              { bar: 'bg-[#69B8E1]',   text: 'text-[#1A3668]',  badge: 'bg-blue-50 text-blue-700 border-blue-100' };
};

const TrendBadge = ({ label, direction, withSource }: { label?: string; direction?: string; withSource?: boolean }) => {
  if (!label || !direction || direction === 'UNKNOWN') return null;
  const cfg = {
    RISING:   { icon: TrendingUp,   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    DECLINING:{ icon: TrendingDown, cls: 'bg-red-50 text-[#D62828] border-red-200' },
    STABLE:   { icon: Minus,        cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  }[direction] ?? { icon: Minus, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border uppercase tracking-wider ${cfg.cls}`}>
        <Icon size={11} strokeWidth={2.5} />
        {label}
      </span>
      {withSource && (
        <span className="text-[9px] text-slate-400 pl-1 tracking-wide">Google Trends · 12mo</span>
      )}
    </span>
  );
};

const SectionDivider = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 my-6">
    <div className="h-px flex-1 bg-slate-200" />
    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">{label}</span>
    <div className="h-px flex-1 bg-slate-200" />
  </div>
);

// ─── main component ──────────────────────────────────────────────────────────

export default function OpportunityDetail() {
  const [s, setS] = useState<ReportSuggestion | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [verdict, setVerdict] = useState<'COMMISSIONED' | 'SOLD' | 'PASSED' | null>(null);
  const [savingVerdict, setSavingVerdict] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('kaiso_opportunity');
      if (!raw) { setLoadError(true); return; }
      const parsed: ReportSuggestion = JSON.parse(raw);
      setS(parsed);
      const wl = JSON.parse(localStorage.getItem('kaiso_watchlist') || '[]') as string[];
      setPinned(wl.includes(parsed.id));
    } catch { setLoadError(true); }
  }, []);

  const toggleWatchlist = () => {
    if (!s) return;
    const wl = JSON.parse(localStorage.getItem('kaiso_watchlist') || '[]') as string[];
    const titles = JSON.parse(localStorage.getItem('kaiso_watchlist_titles') || '{}') as Record<string,string>;
    const isIn = wl.includes(s.id);
    const newWl = isIn ? wl.filter(id => id !== s.id) : [...wl, s.id];
    const newTitles = { ...titles };
    if (!isIn) newTitles[s.id] = s.reportTitle; else delete newTitles[s.id];
    localStorage.setItem('kaiso_watchlist', JSON.stringify(newWl));
    localStorage.setItem('kaiso_watchlist_titles', JSON.stringify(newTitles));
    setPinned(!isIn);
  };

  const handleGenerateBrief = async () => {
    if (!s) return;
    setGeneratingBrief(true);
    try {
      const b = await generateFullBrief(s);
      setBrief(b);
    } catch (err: any) {
      const msg = err.message || JSON.stringify(err);
      const isQuota = msg.includes('exceeded its monthly spending cap') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
      setBrief(isQuota
        ? 'ERROR: Monthly AI spend cap reached. Brief generation is currently suspended.'
        : `ERROR: Brief synthesis failed (${err.message || 'Internal AI Error'}).`
      );
    } finally { setGeneratingBrief(false); }
  };

  const downloadBrief = () => {
    if (!brief || !s) return;
    const blob = new Blob([brief], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Kaiso_Brief_${s.reportTitle.replace(/\s+/g, '_')}.txt`;
    a.click();
  };

  const handleExportDocx = async () => {
    if (!brief || !s || exportingDocx) return;
    setExportingDocx(true);
    try {
      const token = localStorage.getItem('kaiso_auth_token') ?? '';
      const response = await fetch('/api/brief/export-docx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ briefText: brief, suggestion: s }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `Server error ${response.status}`);
      }

      // Stream response to file download
      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `KAISO_Brief_${s.reportTitle.replace(/[^a-zA-Z0-9]+/g, '_').substring(0, 60)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`DOCX export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportingDocx(false);
    }
  };

  const handleExportSnapshot = async () => {
    if (!s || exporting) return;
    setExporting(true);
    try {
      await new Promise(r => setTimeout(r, 80));
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
      document.body.appendChild(container);
      const root = createRoot(container);
      await new Promise<void>(resolve => {
        root.render(<ExportDossier ref={(el) => { if (el) resolve(); }} suggestion={s} />);
        setTimeout(resolve, 300);
      });
      const el = container.firstElementChild as HTMLElement;
      if (!el) throw new Error('Export component did not mount');
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false, imageTimeout: 15000 });
      root.unmount();
      document.body.removeChild(container);
      const imgData = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = imgData;
      link.download = `KAISO_SNAPSHOT_${s.id.substring(0, 8)}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert(`Snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setExporting(false); }
  };

  // ── Ground-truth feedback loop: record the commercial outcome ──────────────
  const recordVerdict = async (value: 'COMMISSIONED' | 'SOLD' | 'PASSED') => {
    if (!s || savingVerdict) return;
    setSavingVerdict(true);
    try {
      const token = localStorage.getItem('kaiso_auth_token') ?? '';
      const response = await fetch('/api/outcomes/verdict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          opportunityId: s.id,
          verdict: value,
          vertical: s.vertical,
          marketKeyword: s.marketKeyword,
          reportTitle: s.reportTitle,
          strategicPillar: s.strategicPillar,
          opportunityScore: (s as any).opportunityScore,
          trendScore: s.trendScore,
          trendDirection: s.trendDirection,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `Server error ${response.status}`);
      }
      setVerdict(value);
    } catch (err) {
      alert(`Failed to record verdict: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingVerdict(false);
    }
  };

  // ── loading / error states ─────────────────────────────────────────────────

  if (loadError) return (
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center">
      <div className="text-center">
        <div className="text-navy font-bold text-lg mb-2">No opportunity data found.</div>
        <p className="text-sm text-slate-500 mb-4">Open this page by clicking a signal card in the Intelligence OS.</p>
        <button onClick={() => window.close()} className="text-xs text-[#D62828] hover:underline">Close Tab</button>
      </div>
    </div>
  );

  if (!s) return (
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center">
      <div className="text-navy text-sm font-bold animate-pulse">Loading intelligence signal...</div>
    </div>
  );

  const cc = confidenceColor(s.confidenceScore ?? 0);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F7F8FA] font-sans text-ink">

      {/* ── TOP BAR ── */}
      <div className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-start justify-between gap-6">

          {/* left: identity */}
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className="w-9 h-9 bg-[#1A3668] rounded-sm flex items-center justify-center font-bold text-white text-lg shrink-0 shadow">K</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-[9px] font-black px-2 py-0.5 bg-[#1A3668] text-white rounded-sm uppercase tracking-widest">{s.vertical}</span>
                {s.strategicPillar && <span className="text-[9px] font-black px-2 py-0.5 bg-[#D62828] text-white rounded-sm uppercase tracking-widest">{s.strategicPillar}</span>}
                {s.signalType && <span className="text-[9px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-sm uppercase tracking-widest border border-slate-200">{s.signalType}</span>}

              </div>
              <h1 className="text-[15px] font-bold text-[#1A3668] leading-snug tracking-tight">
                {s.reportTitle}
              </h1>
              {s.sourceArticleUrl && (
                <a href={s.sourceArticleUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-slate-400 hover:text-[#D62828] transition-colors text-[10px] uppercase tracking-tighter">
                  <ExternalLink size={10} /> Source
                </a>
              )}
            </div>
          </div>

          {/* right: actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleExportSnapshot} disabled={exporting}
              className="flex items-center gap-2 bg-[#1A3668] text-white px-4 py-2 rounded-full font-black text-[10px] uppercase tracking-widest shadow hover:bg-[#D62828] transition-all disabled:opacity-50">
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
              {exporting ? 'Generating…' : 'Export Snapshot'}
            </button>
            <button onClick={() => window.close()} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-navy">
              <X size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 items-start">

        {/* ════════════════════════════════════════════════════════════════
            LEFT COLUMN — main reading content
        ════════════════════════════════════════════════════════════════ */}
        <div className="space-y-6 min-w-0">

          {/* ── ZONE 0: ACTION VERDICT ── */}
          {(s as any).actionVerdict && (
            <div className={`rounded-xl border-2 overflow-hidden ${
              (s as any).actionVerdict === 'PUBLISH NOW'
                ? 'border-[#D62828] bg-[#D62828]/5'
                : (s as any).actionVerdict === 'MONITOR'
                ? 'border-amber-300 bg-amber-50/60'
                : 'border-slate-200 bg-slate-50'
            }`}>
              <div className={`px-6 py-4 flex items-center justify-between ${
                (s as any).actionVerdict === 'PUBLISH NOW' ? 'bg-[#D62828]' :
                (s as any).actionVerdict === 'MONITOR'     ? 'bg-amber-400'  :
                'bg-slate-300'
              }`}>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white">
                    Commissioning Decision
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/70 border border-white/30 px-2 py-0.5 rounded">
                    {(s as any).actionVerdict}
                    {(s as any).actionUrgency === 'HIGH' && (s as any).actionVerdict === 'PUBLISH NOW' && ' · URGENT'}
                  </span>
                </div>
                {typeof (s as any).actionScore === 'number' && (
                  <span className="text-[10px] font-black text-white/80">
                    Action Score: <span className="text-white">{(s as any).actionScore}/100</span>
                  </span>
                )}
              </div>
              <div className="px-6 py-4">
                <p className={`text-[13px] font-semibold leading-relaxed ${
                  (s as any).actionVerdict === 'PUBLISH NOW' ? 'text-[#D62828]' :
                  (s as any).actionVerdict === 'MONITOR'     ? 'text-amber-800' :
                  'text-slate-500'
                }`}>
                  {(s as any).actionReason}
                </p>
                {(s as any).actionUrgency && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Urgency:</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${
                      (s as any).actionUrgency === 'HIGH'   ? 'bg-red-100 text-red-700'    :
                      (s as any).actionUrgency === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {(s as any).actionUrgency}
                    </span>
                    {s.marketExecutionWindow && (
                      <span className="text-[9px] text-slate-400">· Window: {s.marketExecutionWindow}</span>
                    )}
                  </div>
                )}

                {/* ── Ground-Truth Feedback: record the human commercial outcome ── */}
                <div className="mt-4 pt-4 border-t border-slate-200/70">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Record Commercial Outcome
                  </p>
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Record commercial outcome">
                    {([
                      { value: 'COMMISSIONED', label: 'Commissioned', active: 'bg-[#1A3668] text-white border-[#1A3668]', idle: 'bg-white text-[#1A3668] border-[#1A3668]/30 hover:border-[#1A3668]' },
                      { value: 'SOLD',         label: 'Sold',         active: 'bg-emerald-600 text-white border-emerald-600', idle: 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-600' },
                      { value: 'PASSED',       label: 'Passed',       active: 'bg-slate-500 text-white border-slate-500', idle: 'bg-white text-slate-500 border-slate-300 hover:border-slate-500' },
                    ] as const).map(({ value, label, active, idle }) => {
                      const isActive = verdict === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => recordVerdict(value)}
                          disabled={savingVerdict}
                          aria-pressed={isActive}
                          className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isActive ? active : idle}`}
                        >
                          {savingVerdict && isActive && <Loader2 size={11} className="animate-spin" />}
                          {label}
                        </button>
                      );
                    })}
                    {verdict && (
                      <span className="text-[10px] font-bold text-emerald-600 ml-1">✓ Recorded</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── ZONE 1: RATIONALE ── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Why This Opportunity</span>
            </div>
            <div className="px-6 py-5 space-y-5">

              {/* commercial rationale — the most important field */}
              <p className="text-[13px] leading-relaxed text-slate-800 font-medium">
                {s.b2bCommercialRationale || s.rationale}
              </p>

              {/* trigger */}
              {s.trigger && (
                <div className="border-l-2 border-[#D62828] pl-4 bg-red-50/40 py-2 pr-3 rounded-r-md">
                  <p className="text-[10px] font-black text-[#D62828] uppercase tracking-widest mb-1">Signal Trigger</p>
                  <p className="text-[12px] text-slate-700 leading-relaxed italic">{s.trigger}</p>
                </div>
              )}

              {/* nexus */}
              {s.nexusConnection && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                  <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">Nexus Intelligence</p>
                  <p className="text-[12px] text-indigo-900 font-semibold leading-relaxed">{s.nexusConnection}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── ZONE 2: REPORT STRUCTURE ── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Report Structure</span>
              {s.thematicCluster && (
                <span className="text-[9px] font-bold px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full border border-blue-200 uppercase tracking-wide">
                  {s.thematicCluster}
                </span>
              )}
            </div>
            <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* segmentation axes */}
              {s.suggestedSegmentationAxes && s.suggestedSegmentationAxes.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Segmentation Axes</p>
                  <div className="space-y-2">
                    {s.suggestedSegmentationAxes.map((axis, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#D62828] shrink-0" />
                        <span className="text-[11px] text-slate-700 leading-snug">{axis}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* keyword + pillar */}
              <div className="space-y-4">
                {s.marketKeyword && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Target Keyword</p>
                    <p className="text-[13px] font-bold text-[#1A3668]">{s.marketKeyword}</p>
                  </div>
                )}
                {/* SEO markers */}
                {s.trendingKeywords && s.trendingKeywords.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">SEO Markers</p>
                    <div className="flex flex-wrap gap-1.5">
                      {s.trendingKeywords.map((tag, i) => (
                        <span key={i} className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── ZONE 3: COMPETITIVE WHITE SPACE ── */}
          {(s.competitorWhiteSpace || s.competitorContext || s.whiteSpaceStatus) && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Competitive White Space</span>
                {s.whiteSpaceLabel && s.whiteSpaceStatus !== 'UNKNOWN' && (
                  <span className={`text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-wider ${
                    s.whiteSpaceStatus === 'CONFIRMED_GAP'
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : s.whiteSpaceStatus === 'PARTIAL_COVERAGE'
                      ? 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                      : 'bg-red-100 text-red-600 border border-red-200'
                  }`}>
                    {s.whiteSpaceLabel}
                  </span>
                )}
              </div>
              <div className="px-6 py-5 space-y-4">

                {/* Live competitor scan results */}
                {s.whiteSpaceStatus && s.whiteSpaceStatus !== 'UNKNOWN' && (
                  <div className={`rounded-lg p-4 border ${
                    s.whiteSpaceStatus === 'CONFIRMED_GAP'
                      ? 'bg-green-50 border-green-200'
                      : s.whiteSpaceStatus === 'PARTIAL_COVERAGE'
                      ? 'bg-yellow-50 border-yellow-200'
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Publisher Scan Results</p>
                      {typeof s.whiteSpaceScore === 'number' && (
                        <span className="text-[9px] font-black text-slate-400">
                          Gap Score: <span className={`${s.whiteSpaceScore >= 70 ? 'text-green-600' : s.whiteSpaceScore >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>{s.whiteSpaceScore}/100</span>
                        </span>
                      )}
                    </div>
                    {s.whiteSpaceGapReason && (
                      <p className="text-[12px] font-semibold text-slate-700 leading-snug mb-3">{s.whiteSpaceGapReason}</p>
                    )}
                    {s.whiteSpaceCompetitors && s.whiteSpaceCompetitors.length > 0 ? (
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Reports Found At:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {s.whiteSpaceCompetitors.map((c, i) => (
                            <span key={i} className="text-[9px] font-bold px-2 py-0.5 bg-white border border-red-200 text-red-600 rounded">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(['Grand View Research', 'MarketsandMarkets', 'Mordor Intelligence', 'Allied Market Research']).map((c, i) => (
                          <span key={i} className="text-[9px] font-bold px-2 py-0.5 bg-white border border-green-200 text-green-600 rounded">
                            ✓ {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Gemini-assessed entry gap (always shown if present) */}
                {s.competitorWhiteSpace && (
                  <div className="bg-[#1A3668]/5 border border-[#1A3668]/10 rounded-lg p-4">
                    <p className="text-[9px] font-black text-[#1A3668] uppercase tracking-widest mb-2">Identified Entry Gap (AI Assessment)</p>
                    <p className="text-[13px] font-bold text-[#D62828] leading-snug">{s.competitorWhiteSpace}</p>
                  </div>
                )}
                {s.competitorContext && (
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Landscape Context</p>
                    <p className="text-[12px] text-slate-600 leading-relaxed">{s.competitorContext}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── ZONE 4: BRIEF OUTPUT (when generated) ── */}
          {brief && (
            <div className="bg-slate-900 text-slate-200 p-8 rounded-xl font-mono text-xs">
              <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                <span className="text-[#69B8E1] text-[10px] font-bold uppercase tracking-widest">KAISO INTERNAL STRATEGY BRIEF · CONFIDENTIAL</span>
                <div className="flex items-center gap-3">
                  <button onClick={downloadBrief} className="flex items-center gap-2 hover:text-white transition-colors text-slate-400 text-[10px]">
                    <Download size={12} /> .txt
                  </button>
                  <button
                    onClick={handleExportDocx}
                    disabled={exportingDocx}
                    className="flex items-center gap-2 bg-white text-[#1A3668] hover:bg-[#D62828] hover:text-white font-black px-3 py-1.5 rounded text-[10px] uppercase tracking-wider transition-all disabled:opacity-50"
                  >
                    {exportingDocx
                      ? <><Loader2 size={11} className="animate-spin" /> Building…</>
                      : <><FileText size={11} /> Export .docx</>
                    }
                  </button>
                </div>
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">{brief}</div>
            </div>
          )}

        </div>

        {/* ════════════════════════════════════════════════════════════════
            RIGHT COLUMN — sticky decision panel
        ════════════════════════════════════════════════════════════════ */}
        <div className="lg:sticky lg:top-[76px] space-y-4">

          {/* ── CONFIDENCE SCORE ── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Confidence Index</p>
            <div className="flex items-end gap-3 mb-3">
              <span className={`text-4xl font-black font-mono ${cc.text}`}>{(s.confidenceScore ?? 0).toFixed(1)}</span>
              <span className="text-slate-300 text-2xl font-thin mb-1">/ 10</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mb-3">
              <div className={`h-full ${cc.bar} rounded-full transition-all duration-700`} style={{ width: `${(s.confidenceScore ?? 0) * 10}%` }} />
            </div>
            {/* Google Trends row with context label */}
            {s.trendDirectionLabel && s.trendDirection !== 'UNKNOWN' && (
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <TrendingUp size={10} className="text-slate-400" />
                    Search Demand Trend
                  </span>
                  <span className="text-[9px] text-slate-400 italic">Google Trends · 12mo</span>
                </div>
                <TrendBadge label={s.trendDirectionLabel} direction={s.trendDirection} />
              </div>
            )}
          </div>

          {/* ── COMMERCIAL SNAPSHOT ── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">At a Glance</p>

            {s.estimatedCAGRRange && (
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Est. CAGR</span>
                <span className="text-[11px] font-black text-[#D62828] text-right">{s.estimatedCAGRRange.split(',')[0]}</span>
              </div>
            )}

            {s.marketExecutionWindow && (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold flex items-center gap-1.5">
                  <Clock size={11} className="text-[#D62828]" /> Window
                </span>
                <span className="text-[11px] font-bold text-[#1A3668] text-right">{s.marketExecutionWindow}</span>
              </div>
            )}

            {s.primaryStakeholder && (
              <div className="flex items-start justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold flex items-center gap-1.5">
                  <Briefcase size={11} /> Buyer
                </span>
                <span className="text-[10px] font-black text-[#D62828] uppercase text-right leading-tight">{s.primaryStakeholder}</span>
              </div>
            )}

            {s.salesPotential && (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Commercial Flow</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${cc.badge}`}>{s.salesPotential}</span>
              </div>
            )}

            {s.executionRisk && (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold flex items-center gap-1.5">
                  <AlertTriangle size={11} /> Risk
                </span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${
                  s.executionRisk === 'Low'  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  s.executionRisk === 'High' ? 'bg-red-50 text-[#D62828] border-red-200' :
                                              'bg-amber-50 text-amber-700 border-amber-100'
                }`}>{s.executionRisk}</span>
              </div>
            )}

            {s.signalOriginGeography && (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Signal Origin</span>
                <span className="text-[9px] font-black bg-slate-100 text-[#1A3668] px-2 py-0.5 rounded">{s.signalOriginGeography}</span>
              </div>
            )}

            {s.recommendedReportGeography && (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Report SKU</span>
                <span className="text-[9px] font-black bg-[#1A3668] text-white px-2 py-0.5 rounded">{s.recommendedReportGeography}</span>
              </div>
            )}
          </div>

          {/* ── CREDIBILITY NOTE — only if score is decent ── */}
          {s.credibilityScore && s.credibilityScore >= 60 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={13} className="text-emerald-600" />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Signal Credibility</span>
                <span className="ml-auto text-[11px] font-black text-emerald-700">{s.credibilityScore}%</span>
              </div>
              {s.veracityRationale && (
                <p className="text-[10px] leading-relaxed text-slate-600 italic border-l-2 border-emerald-400 pl-3">
                  "{s.veracityRationale}"
                </p>
              )}
            </div>
          )}

          {/* ── PRIMARY CTA ── */}
          {!brief ? (
            <button
              onClick={handleGenerateBrief}
              disabled={generatingBrief}
              className="w-full bg-[#1A3668] hover:bg-[#D62828] text-white font-black py-4 rounded-xl flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg text-[11px] uppercase tracking-widest"
            >
              {generatingBrief
                ? <><RefreshCw className="animate-spin" size={16} /> Synthesizing Brief…</>
                : <><FileText size={16} /> Generate Analyst Brief</>
              }
            </button>
          ) : (
            <div className="space-y-2">
              <button
                onClick={handleExportDocx}
                disabled={exportingDocx}
                className="w-full bg-[#1A3668] hover:bg-[#D62828] text-white font-black py-4 rounded-xl flex items-center justify-center gap-2.5 transition-all text-[11px] uppercase tracking-widest shadow-lg disabled:opacity-50"
              >
                {exportingDocx
                  ? <><Loader2 size={16} className="animate-spin" /> Building DOCX…</>
                  : <><FileText size={16} /> Download as Word (.docx)</>
                }
              </button>
              <button
                onClick={downloadBrief}
                className="w-full bg-white border border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-[10px] uppercase tracking-wider"
              >
                <Download size={13} /> Plain Text (.txt)
              </button>
            </div>
          )}

          {/* ── WATCHLIST ── */}
          <button
            onClick={toggleWatchlist}
            className={`w-full py-3 rounded-xl border font-bold transition-all flex items-center justify-center gap-2 text-[10px] uppercase tracking-wider ${
              pinned
                ? 'bg-[#D62828] border-[#D62828] text-white shadow'
                : 'bg-white border-slate-300 text-slate-500 hover:border-[#1A3668] hover:text-[#1A3668]'
            }`}
          >
            <Bookmark size={13} fill={pinned ? 'currentColor' : 'none'} />
            {pinned ? 'Pinned to Watchlist' : 'Pin to Watchlist'}
          </button>

        </div>
      </div>
    </div>
  );
}
