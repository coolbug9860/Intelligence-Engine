import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  X,
  Search,
  Sparkles,
  FileText,
  AlertTriangle,
  Cpu,
  Database,
  Loader2,
} from 'lucide-react';

import { useHelpSearch } from '../hooks/useHelpSearch';
import type { HelpEntry, HelpSource, ScoredEntry } from '../services/helpTypes';

interface HelpPanelProps {
  onClose: () => void;
}

/**
 * In-App Help / Search modal.
 *
 * Reuses the `DocumentationView` modal conventions (full-screen motion panel,
 * red icon header, Exit button). Renders the search box, the instant local
 * answer with cited sources and a `local`/`llm` provenance badge, ranked
 * suggestions as selectable items, and the explicit "Ask AI" fallback control.
 *
 * The LLM fallback is reachable ONLY via the "Ask AI" button (Req 6.1) and is
 * disabled once the session budget is exhausted (Req 7.3). A 502 keeps the
 * closest local candidates visible alongside an "unavailable" notice (Req 10.2).
 */
const HelpPanel: React.FC<HelpPanelProps> = ({ onClose }) => {
  const {
    query,
    setQuery,
    result,
    answer,
    isAsking,
    askFailed,
    askAi,
    llmBudgetRemaining,
  } = useHelpSearch();

  // A suggestion the user clicked: shows that entry's body WITHOUT any fallback.
  const [selectedEntry, setSelectedEntry] = useState<HelpEntry | null>(null);

  // Esc closes the panel (Req 11.3).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Any new query invalidates a manual selection. The hook clears its own
  // failure flag on a query change, so the stale notice goes away with it.
  useEffect(() => {
    setSelectedEntry(null);
  }, [query]);

  // The fallback failure (incl. 502) is surfaced through hook STATE, not a
  // thrown error: the hook never rejects, so derive the notice from `askFailed`
  // and keep the local matches on screen (Req 10.2).
  const handleAskAi = useCallback(() => {
    void askAi();
  }, [askAi]);

  const mode = result?.mode ?? 'suggestions';
  const topMatches = result?.topMatches ?? [];
  const budgetExhausted = llmBudgetRemaining <= 0;
  const canShowAskAi = mode === 'suggestions' || mode === 'needs-llm';

  // What to render in the answer area, in priority order:
  // 1. A user-selected suggestion (always local provenance).
  // 2. A resolved answer from the hook (local hit or LLM fallback).
  const displayBody = selectedEntry ? selectedEntry.body : answer?.answer ?? null;
  const displaySources: HelpSource[] = selectedEntry
    ? [{ id: selectedEntry.id, title: selectedEntry.title, sourceDoc: selectedEntry.sourceDoc }]
    : answer?.sources ?? [];
  const provenance: 'local' | 'llm' = selectedEntry ? 'local' : answer?.mode ?? 'local';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 bg-white z-[100] flex flex-col font-sans text-navy overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Help and Search"
    >
      {/* HEADER */}
      <header className="h-[70px] border-b border-slate-200 flex items-center justify-between px-8 bg-slate-50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-red flex items-center justify-center rounded-sm">
            <Search size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-tighter">Help &amp; Knowledge Base</h1>
            <p className="text-[10px] text-muted font-bold uppercase tracking-[0.2em] opacity-60">
              Ask about any metric, section, verdict, or pipeline rule
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 hover:bg-slate-200 rounded transition-colors text-[10px] font-extrabold uppercase tracking-tight border border-slate-300 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          aria-label="Close help"
        >
          <X size={16} /> Close
        </button>
      </header>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-3xl mx-auto py-10 px-8">
          {/* SEARCH BOX */}
          <div className="relative mb-8">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="What does opportunityScore mean?"
              aria-label="Search help"
              className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:border-brand-red transition-shadow"
            />
          </div>

          {/* ARIA-LIVE region for async answer updates (Req 11.4) */}
          <div aria-live="polite" className="sr-only">
            {isAsking
              ? 'Asking AI for an explanation.'
              : displayBody
                ? `Answer ready from ${provenance === 'llm' ? 'AI' : 'local knowledge base'}.`
                : ''}
          </div>

          {/* ANSWER AREA — reserve min height to avoid layout shift */}
          <div className="min-h-[120px]">
            {displayBody ? (
              <article className="border border-slate-200 rounded-lg p-6 bg-white shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                    Explanation
                  </span>
                  <ProvenanceBadge mode={provenance} />
                </div>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {displayBody}
                </p>
                {displaySources.length > 0 && <SourceList sources={displaySources} />}
              </article>
            ) : (
              !isAsking && (
                <p className="text-sm text-slate-400 font-medium py-6">
                  {query.trim()
                    ? 'No confident local answer. Pick a suggestion below or ask the AI.'
                    : 'Start typing to search the knowledge base.'}
                </p>
              )
            )}

            {isAsking && (
              <div className="flex items-center gap-2 text-sm text-slate-500 font-medium py-6">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Asking AI for a grounded explanation…
              </div>
            )}
          </div>

          {/* 502 / unavailable notice (Req 10.2) */}
          {askFailed && (
            <div
              role="status"
              className="mt-4 flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs font-semibold leading-relaxed">
                AI explanation unavailable right now — here are the closest local matches.
              </p>
            </div>
          )}

          {/* SUGGESTIONS + ASK AI (only when not showing a resolved answer) */}
          {!displayBody && !isAsking && (
            <div className="mt-6">
              {topMatches.length > 0 && (
                <>
                  <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                    Suggestions
                  </h2>
                  <ul className="space-y-2">
                    {topMatches.map((m: ScoredEntry) => (
                      <li key={m.entry.id}>
                        <button
                          onClick={() => setSelectedEntry(m.entry)}
                          className="w-full text-left p-4 border border-slate-200 rounded-lg hover:border-brand-red hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-bold text-navy">{m.entry.title}</span>
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                              {m.entry.category}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{m.entry.body}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {canShowAskAi && (
                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={handleAskAi}
                    disabled={budgetExhausted || isAsking}
                    aria-disabled={budgetExhausted || isAsking}
                    title={
                      budgetExhausted
                        ? 'AI budget for this session is exhausted. Showing local results only.'
                        : 'Ask the AI for a grounded explanation'
                    }
                    className="flex items-center gap-2 px-5 py-2.5 bg-navy text-white rounded-lg text-xs font-extrabold uppercase tracking-tight transition-colors hover:bg-navy/90 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                  >
                    <Sparkles size={14} aria-hidden="true" /> Ask AI
                  </button>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {budgetExhausted
                      ? 'AI budget exhausted this session'
                      : `${llmBudgetRemaining} AI lookups left`}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/** Small badge indicating whether the answer came from local KB or the LLM. */
const ProvenanceBadge: React.FC<{ mode: 'local' | 'llm' }> = ({ mode }) => {
  const isLlm = mode === 'llm';
  return (
    <span
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
        isLlm
          ? 'bg-navy/5 text-navy border-navy/15'
          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isLlm ? <Cpu size={11} aria-hidden="true" /> : <Database size={11} aria-hidden="true" />}
      {isLlm ? 'AI' : 'Local'}
    </span>
  );
};

/** Renders the cited knowledge base sources backing an answer (Req 11.1). */
const SourceList: React.FC<{ sources: HelpSource[] }> = ({ sources }) => (
  <div className="mt-5 pt-4 border-t border-slate-100">
    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Sources</span>
    <ul className="mt-2 space-y-1.5">
      {sources.map((s) => (
        <li key={s.id} className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <FileText size={12} className="text-slate-400 shrink-0" aria-hidden="true" />
          <span className="font-bold text-navy">{s.title}</span>
          {s.sourceDoc && <span className="text-slate-400">· {s.sourceDoc}</span>}
        </li>
      ))}
    </ul>
  </div>
);

export default HelpPanel;
