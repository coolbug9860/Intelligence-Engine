/**
 * HowItWorks.tsx
 *
 * A self-explaining, presentation-ready walkthrough of the KAISO Intelligence OS
 * pipeline — built for non-technical stakeholders. Reached via `?page=how-it-works`
 * (wired in main.tsx) and the "How It Works" button in the app header.
 *
 * Everything below is driven by the REAL live pipeline (server.ts ingestion fan-out
 * + intelligenceOrchestrator stages + post-pipeline enrichment). Source statuses are
 * honest: LIVE / CONDITIONAL / DORMANT.
 */

import { motion } from 'motion/react';
import type { ReactNode, FC } from 'react';
import {
  Newspaper, FileText, Landmark, Globe2, Scale, Lightbulb, Search, Activity,
  Gauge, BrainCircuit, ShieldCheck, CheckCircle2, Layers, Copy, Network,
  TrendingUp, Sparkles, ArrowRight, ArrowDown, CircleDollarSign, Eye, XCircle,
  ChevronRight,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT (single source of truth — keep these aligned with the real pipeline)
// ─────────────────────────────────────────────────────────────────────────────

type Status = 'LIVE' | 'CONDITIONAL' | 'DORMANT';

interface SourceCard {
  icon: ReactNode;
  name: string;
  what: string;       // what it is, plain English
  tells: string;      // what it tells the engine
  status: Status;
}

const INPUT_SOURCES: SourceCard[] = [
  {
    icon: <Newspaper size={22} />,
    name: 'RSS + NewsAPI',
    what: '54 curated global B2B news feeds plus a news search API.',
    tells: 'What the market is talking about right now.',
    status: 'LIVE',
  },
  {
    icon: <FileText size={22} />,
    name: 'SEC EDGAR',
    what: 'Official US public-company filings (10-K, 10-Q, 8-K).',
    tells: 'What big US companies formally tell regulators they are spending on or worried about.',
    status: 'LIVE',
  },
  {
    icon: <Globe2 size={22} />,
    name: 'EU TED',
    what: 'European Union public procurement and tender notices.',
    tells: 'What European governments are getting ready to buy.',
    status: 'LIVE',
  },
  {
    icon: <Landmark size={22} />,
    name: 'UK FTS + Contracts Finder',
    what: 'UK government contract and tender notices.',
    tells: 'What the UK public sector is getting ready to buy.',
    status: 'LIVE',
  },
  {
    icon: <Scale size={22} />,
    name: 'US Federal Register',
    what: 'Official US government regulatory notices.',
    tells: 'What new US rules and regulations are coming.',
    status: 'LIVE',
  },
  {
    icon: <Lightbulb size={22} />,
    name: 'EU EPO Patents',
    what: 'European Patent Office filings.',
    tells: 'What is being invented and patented across Europe.',
    status: 'LIVE',
  },
];

const SUPPORT_SOURCES: SourceCard[] = [
  {
    icon: <Search size={22} />,
    name: 'SAM.gov',
    what: 'US government contract opportunity database.',
    tells: 'Pulls the actual contract when a Federal Register notice references one. Runs only when triggered.',
    status: 'CONDITIONAL',
  },
  {
    icon: <TrendingUp size={22} />,
    name: 'Google Trends',
    what: 'Public search-interest data. A GitHub Action fetches it every 12h and caches it in Upstash, so the app reads it reliably instead of being blocked.',
    tells: 'Whether public interest in a topic is rising, stable, or declining.',
    status: 'LIVE',
  },
  {
    icon: <Activity size={22} />,
    name: 'Tavily (Whitespace)',
    what: 'Live web-search check against real published reports.',
    tells: 'Whether the market is already flooded with similar reports — or wide open.',
    status: 'LIVE',
  },
  {
    icon: <Gauge size={22} />,
    name: 'BLS (Reference)',
    what: 'US Bureau of Labor Statistics sector cost data.',
    tells: 'Connected and ready, but intentionally does not affect any score today.',
    status: 'DORMANT',
  },
];

interface Stage {
  icon: ReactNode;
  title: string;
  what: string;
  why: string;
}

const STAGES: Stage[] = [
  {
    icon: <BrainCircuit size={20} />,
    title: 'AI Signal Extraction',
    what: 'Gemini reads every signal and proposes ~8–10 candidate report topics.',
    why: 'This is the brain. It turns thousands of raw items into a short list of real business ideas.',
  },
  {
    icon: <ShieldCheck size={20} />,
    title: 'Source Authority',
    what: 'Each idea is tagged by how trustworthy its source is (an SEC filing outranks a blog).',
    why: 'A topic backed by official filings is more believable than one from a single news story.',
  },
  {
    icon: <CheckCircle2 size={20} />,
    title: 'Validation',
    what: 'Sanity checks trim over-confident or weakly-supported claims.',
    why: 'Stops the engine from overselling an idea the evidence cannot back up.',
  },
  {
    icon: <CircleDollarSign size={20} />,
    title: 'Scoring',
    what: 'Each idea gets an Opportunity Score from 0–100 — the main ranking number.',
    why: 'This is how good the business opportunity is. Commercial value drives it.',
  },
  {
    icon: <Sparkles size={20} />,
    title: 'Freshness',
    what: 'Newer signals are weighted higher; stale ones decay.',
    why: 'A topic breaking today matters more than one from three months ago.',
  },
  {
    icon: <Copy size={20} />,
    title: 'Deduplication',
    what: 'Near-identical ideas are merged, keeping the strongest version.',
    why: 'You see one clean opportunity, not five copies of the same theme.',
  },
  {
    icon: <Layers size={20} />,
    title: 'Diversity',
    what: 'The final set is spread across industries so no single sector dominates.',
    why: 'A balanced shortlist across verticals, not ten reports about the same market.',
  },
];

interface Verdict {
  icon: ReactNode;
  label: string;
  color: string;       // tailwind text/border accent
  bg: string;
  meaning: string;
  trigger: string;
}

const VERDICTS: Verdict[] = [
  {
    icon: <CheckCircle2 size={26} />,
    label: 'PUBLISH NOW',
    color: 'text-green-700',
    bg: 'bg-green-50 border-green-200',
    meaning: 'Commission this report. The market gap is real and the score is high.',
    trigger: 'A clear market gap (no — or only light — competitor coverage), search interest not declining, and an Opportunity Score of 68 or higher.',
  },
  {
    icon: <Eye size={26} />,
    label: 'MONITOR',
    color: 'text-amber-700',
    bg: 'bg-amber-50 border-amber-200',
    meaning: 'Promising, but not yet. Keep watching it.',
    trigger: 'Decent score, but the gap or timing is not yet convincing enough.',
  },
  {
    icon: <XCircle size={26} />,
    label: 'PASS',
    color: 'text-red-700',
    bg: 'bg-red-50 border-red-200',
    meaning: 'Skip it for now.',
    trigger: 'Market already saturated, search interest declining, score below 45, or high execution risk paired with critical regulation.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    LIVE: 'bg-green-100 text-green-700 border-green-300',
    CONDITIONAL: 'bg-amber-100 text-amber-700 border-amber-300',
    DORMANT: 'bg-slate-100 text-slate-500 border-slate-300',
  };
  return (
    <span className={`text-[9px] font-extrabold tracking-widest px-2 py-0.5 rounded-full border ${map[status]}`}>
      {status}
    </span>
  );
}

const Reveal: FC<{ children: ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
};

function SectionHeading({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  return (
    <div className="max-w-3xl mx-auto text-center mb-12">
      <div className="text-[11px] font-extrabold tracking-[0.3em] text-brand-red uppercase mb-3">{kicker}</div>
      <h2 className="text-3xl md:text-4xl font-serif font-black text-navy mb-4">{title}</h2>
      {subtitle && <p className="text-muted text-sm md:text-base leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function SourceTile({ s }: { s: SourceCard }) {
  return (
    <div className="group bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md hover:border-brand-blue/40 transition-all h-full flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-md bg-navy/5 text-brand-blue flex items-center justify-center">{s.icon}</div>
        <StatusBadge status={s.status} />
      </div>
      <h3 className="font-extrabold text-navy text-sm mb-1">{s.name}</h3>
      <p className="text-[12px] text-slate-600 leading-relaxed mb-3">{s.what}</p>
      <div className="mt-auto pt-3 border-t border-slate-100">
        <div className="text-[9px] font-bold tracking-widest text-muted uppercase mb-1">Tells us</div>
        <p className="text-[12px] text-navy font-medium leading-snug">{s.tells}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-bg text-ink font-sans">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-baseline gap-2 select-none">
            <span className="font-black text-brand-blue uppercase tracking-tight">KAISO</span>
            <span className="text-muted text-[10px] tracking-widest uppercase">Intelligence OS</span>
          </div>
          <a
            href="/"
            className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-navy hover:text-brand-red transition-colors"
          >
            Back to App <ArrowRight size={14} />
          </a>
        </div>
      </div>

      {/* HERO */}
      <header className="relative overflow-hidden bg-navy text-white">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '28px 28px' }} />
        <div className="relative max-w-4xl mx-auto px-6 py-24 text-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/20 text-[10px] font-bold tracking-[0.25em] uppercase mb-6">
              <Network size={12} className="text-accent-blue" /> How the engine works
            </div>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-4xl md:text-5xl font-serif font-black leading-tight mb-6">
              From raw market signals to a <span className="text-accent-blue">ready-to-commission</span> report decision.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-white/70 text-base md:text-lg leading-relaxed max-w-2xl mx-auto">
              KAISO Intelligence Engine watches the world's business signals, finds where there is genuine demand for a
              premium research report, and tells you exactly which ones to publish — each scored and
              stamped <strong className="text-white">PUBLISH NOW</strong>, <strong className="text-white">MONITOR</strong>, or <strong className="text-white">PASS</strong>.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="flex flex-wrap justify-center gap-6 mt-12 text-center">
              <Stat number="6" label="Live signal sources" />
              <Stat number="~8–10" label="Opportunities per run" />
              <Stat number="$3k–$5k" label="Value per report" />
            </div>
          </Reveal>
          <Reveal delay={0.2}>
            <div className="mt-12 flex justify-center text-white/40 animate-bounce">
              <ArrowDown size={22} />
            </div>
          </Reveal>
        </div>
      </header>

      {/* THE BIG PICTURE — end-to-end flow */}
      <section className="py-20 px-6 bg-white">
        <SectionHeading
          kicker="The big picture"
          title="The whole journey, in one line"
          subtitle="Signals come in on the left. They get read, scored, and filtered. A ranked list of report opportunities comes out on the right."
        />
        <Reveal>
          <FlowDiagram />
        </Reveal>
      </section>

      {/* WHERE SIGNALS COME FROM */}
      <section className="py-20 px-6 bg-slate-50 border-y border-slate-200">
        <SectionHeading
          kicker="Step 1 — Inputs"
          title="Where the signals come from"
          subtitle="Six live sources feed the engine. Each one answers a different question about the market."
        />
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {INPUT_SOURCES.map((s, i) => (
            <Reveal key={s.name} delay={i * 0.05}>
              <SourceTile s={s} />
            </Reveal>
          ))}
        </div>

        <div className="max-w-6xl mx-auto mt-12">
          <Reveal>
            <h3 className="text-center text-[11px] font-extrabold tracking-[0.3em] text-muted uppercase mb-6">
              Plus three supporting checks
            </h3>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {SUPPORT_SOURCES.map((s, i) => (
              <Reveal key={s.name} delay={i * 0.05}>
                <SourceTile s={s} />
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="text-center text-[11px] text-muted mt-6 max-w-2xl mx-auto leading-relaxed">
              All sources are merged into one common format and passed through a fast, no-cost keyword
              filter before the AI ever sees them — so the engine spends its effort only on relevant signals.
            </p>
          </Reveal>
        </div>
      </section>

      {/* HOW A SIGNAL BECOMES AN OPPORTUNITY */}
      <section className="py-20 px-6 bg-white">
        <SectionHeading
          kicker="Step 2 — The assembly line"
          title="How a signal becomes an opportunity"
          subtitle="Every candidate topic passes through these stations in order. Each one either sharpens it or filters it out."
        />
        <div className="max-w-3xl mx-auto space-y-4">
          {STAGES.map((stage, i) => (
            <Reveal key={stage.title} delay={i * 0.04}>
              <div className="flex gap-4 items-start bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-10 h-10 rounded-full bg-navy text-white flex items-center justify-center font-bold text-sm">
                    {i + 1}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-brand-blue">{stage.icon}</span>
                    <h3 className="font-extrabold text-navy text-sm">{stage.title}</h3>
                  </div>
                  <p className="text-[13px] text-slate-700 leading-relaxed">{stage.what}</p>
                  <p className="text-[12px] text-muted leading-relaxed mt-1">
                    <span className="font-bold text-brand-red uppercase tracking-wide text-[10px] mr-1">Why</span>
                    {stage.why}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* HOW WE SCORE */}
      <section className="py-20 px-6 bg-navy text-white">
        <SectionHeading
          kicker="Step 3 — The score"
          title="How the Opportunity Score is built"
          subtitle="One number from 0 to 100 decides the ranking. It is built from three parts multiplied together."
        />
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
              <ScorePart
                title="Commercial Value"
                role="The engine"
                desc="Will buyers pay? Is the market measurable, searchable, and big enough? This drives the score up."
                tone="up"
              />
              <ScorePart
                title="Evidence Gate"
                role="The brake"
                desc="How well-supported is the idea? Weak evidence can only pull the score down — never inflate it."
                tone="down"
              />
              <ScorePart
                title="Risk Discount"
                role="The reality check"
                desc="Heavy regulation or hard execution shrinks the score to reflect real-world difficulty."
                tone="down"
              />
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-center font-mono text-sm">
              <span className="px-3 py-2 rounded bg-white/10 border border-white/15">Commercial Value</span>
              <span className="text-accent-blue font-bold">×</span>
              <span className="px-3 py-2 rounded bg-white/10 border border-white/15">Evidence Gate</span>
              <span className="text-accent-blue font-bold">×</span>
              <span className="px-3 py-2 rounded bg-white/10 border border-white/15">Risk Discount</span>
              <span className="text-accent-blue font-bold">=</span>
              <span className="px-4 py-2 rounded bg-brand-red font-extrabold">Opportunity Score</span>
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            <p className="text-center text-white/60 text-[12px] mt-6 max-w-2xl mx-auto leading-relaxed">
              Key idea: a commercially weak topic can never be rescued by strong evidence. Evidence and
              risk can only hold a score back — real buyer demand is what lifts it.
            </p>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="text-center text-white/50 text-[11px] mt-3 max-w-2xl mx-auto leading-relaxed">
              The score is also gently nudged by how past reports in the same industry actually sold —
              see the learning loop below.
            </p>
          </Reveal>
        </div>
      </section>

      {/* THE VERDICT */}
      <section className="py-20 px-6 bg-slate-50 border-y border-slate-200">
        <SectionHeading
          kicker="Step 4 — The verdict"
          title="The final call"
          subtitle="After scoring, two extra checks — market gap and search trend — decide the recommendation."
        />
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
          {VERDICTS.map((v, i) => (
            <Reveal key={v.label} delay={i * 0.07}>
              <div className={`rounded-lg border p-6 h-full ${v.bg}`}>
                <div className={`flex items-center gap-3 mb-3 ${v.color}`}>
                  {v.icon}
                  <h3 className="font-black text-lg tracking-tight">{v.label}</h3>
                </div>
                <p className="text-[13px] text-navy font-medium leading-relaxed mb-4">{v.meaning}</p>
                <div className="pt-3 border-t border-black/5">
                  <div className="text-[9px] font-bold tracking-widest text-muted uppercase mb-1">Triggered when</div>
                  <p className="text-[12px] text-slate-700 leading-relaxed">{v.trigger}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* QUALITY CONTROLS — council, learning loop, deeper analytics */}
      <section className="py-20 px-6 bg-white">
        <SectionHeading
          kicker="Step 5 — Safeguards & learning"
          title="What runs behind the verdict"
          subtitle="A few more layers make the recommendations sharper over time and harder to game."
        />
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
          <Reveal>
            <OutputCard
              icon={<Scale size={22} />}
              title="AI Council review"
              desc="Borderline 'Monitor' picks get a second opinion from a 3-role AI council — a Skeptic, a Buyer, and a Chairman who weighs both. It is advisory only and never changes the score."
            />
          </Reveal>
          <Reveal delay={0.05}>
            <OutputCard
              icon={<Activity size={22} />}
              title="Learning loop"
              desc="The engine tracks how its past picks actually performed and quietly adjusts future scores per industry — so its judgement improves with every cycle."
            />
          </Reveal>
          <Reveal delay={0.1}>
            <OutputCard
              icon={<Network size={22} />}
              title="Deeper analytics"
              desc="Behind the scenes it also maps how signals relate, forecasts momentum, and ranks priority — powering the dashboard views beyond the headline shortlist."
            />
          </Reveal>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="py-20 px-6 bg-white">
        <SectionHeading
          kicker="The output"
          title="What you get at the end"
          subtitle="One run produces a ranked, decision-ready shortlist — not a pile of raw data."
        />
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
          <Reveal>
            <OutputCard
              icon={<Layers size={22} />}
              title="A ranked shortlist"
              desc="Around 8–10 report opportunities, ordered best-first, each with its Opportunity Score and a clear PUBLISH / MONITOR / PASS stamp."
            />
          </Reveal>
          <Reveal delay={0.05}>
            <OutputCard
              icon={<FileText size={22} />}
              title="One-click report brief"
              desc="For any opportunity, the engine writes a full commission document — the starting point for a $3k–$5k syndicated research report."
            />
          </Reveal>
          <Reveal delay={0.1}>
            <OutputCard
              icon={<Network size={22} />}
              title="The reasoning behind it"
              desc="Each opportunity shows its supporting signals, market gap, and trend direction — so the recommendation is never a black box."
            />
          </Reveal>
          <Reveal delay={0.15}>
            <OutputCard
              icon={<Sparkles size={22} />}
              title="Memory across runs"
              desc="The engine remembers what it surfaced before, so the same ideas do not resurface every day and genuinely new ones stand out."
            />
          </Reveal>
        </div>

        <Reveal>
          <div className="max-w-3xl mx-auto mt-16 text-center">
            <a
              href="/"
              className="inline-flex items-center gap-2 px-8 py-3 rounded bg-brand-red text-white text-sm font-extrabold uppercase tracking-widest hover:bg-brand-red/90 transition-colors shadow-lg"
            >
              Open the live engine <ChevronRight size={16} />
            </a>
          </div>
        </Reveal>
      </section>

      <footer className="py-10 px-6 bg-navy text-white/50 text-center text-[11px]">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="font-black text-white uppercase tracking-tight">KAISO</span>
          <span className="tracking-widest uppercase">Intelligence OS</span>
        </div>
        Market intelligence for Kaiso Research &amp; Consulting.
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div className="px-4">
      <div className="text-3xl font-serif font-black text-accent-blue">{number}</div>
      <div className="text-[10px] tracking-widest uppercase text-white/50 mt-1">{label}</div>
    </div>
  );
}

function ScorePart({ title, role, desc, tone }: { title: string; role: string; desc: string; tone: 'up' | 'down' }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-5 h-full">
      <div className="flex items-center gap-2 mb-2">
        <span className={tone === 'up' ? 'text-green-400' : 'text-amber-400'}>
          {tone === 'up' ? <TrendingUp size={18} /> : <Gauge size={18} />}
        </span>
        <span className="text-[9px] font-bold tracking-widest uppercase text-white/40">{role}</span>
      </div>
      <h3 className="font-extrabold text-white mb-2">{title}</h3>
      <p className="text-[12px] text-white/60 leading-relaxed">{desc}</p>
    </div>
  );
}

function OutputCard({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm h-full">
      <div className="w-11 h-11 rounded-md bg-navy/5 text-brand-blue flex items-center justify-center mb-4">{icon}</div>
      <h3 className="font-extrabold text-navy text-sm mb-2">{title}</h3>
      <p className="text-[13px] text-slate-600 leading-relaxed">{desc}</p>
    </div>
  );
}

// The end-to-end flow centerpiece.
function FlowDiagram() {
  const steps = [
    { icon: <Globe2 size={20} />, label: '6 Signal Sources', sub: 'News, filings, tenders, patents' },
    { icon: <Search size={20} />, label: 'Keyword Filter', sub: 'Keep only relevant signals' },
    { icon: <BrainCircuit size={20} />, label: 'Gemini AI', sub: 'Proposes report topics' },
    { icon: <CircleDollarSign size={20} />, label: 'Scoring Line', sub: 'Rank, dedupe, diversify' },
    { icon: <CheckCircle2 size={20} />, label: 'Verdict', sub: 'Publish / Monitor / Pass' },
    { icon: <Layers size={20} />, label: 'Ranked Output', sub: '~8–10 opportunities' },
  ];
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 lg:gap-0">
        {steps.map((step, i) => (
          <div key={step.label} className="flex flex-col lg:flex-row items-center lg:flex-1">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.12 }}
              className="flex-1 w-full bg-white border border-slate-200 rounded-lg p-4 text-center shadow-sm hover:border-brand-blue/40 transition-colors"
            >
              <div className="w-11 h-11 mx-auto rounded-full bg-navy text-white flex items-center justify-center mb-2">
                {step.icon}
              </div>
              <div className="font-extrabold text-navy text-[12px] leading-tight">{step.label}</div>
              <div className="text-[10px] text-muted mt-1 leading-tight">{step.sub}</div>
            </motion.div>
            {i < steps.length - 1 && (
              <div className="flex items-center justify-center text-brand-red shrink-0 px-1">
                <ArrowRight size={18} className="hidden lg:block" />
                <ArrowDown size={18} className="lg:hidden" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
