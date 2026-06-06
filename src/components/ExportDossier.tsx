import React from 'react';
import { ReportSuggestion } from '../types';

interface ExportDossierProps {
  suggestion: ReportSuggestion;
}

const C = {
  navy:       '#1A3668',
  red:        '#D62828',
  lightBlue:  '#69B8E1',
  bg:         '#F1F4F9',
  white:      '#FFFFFF',
  slate50:    '#F8FAFC',
  slate100:   '#F1F5F9',
  slate200:   '#E2E8F0',
  slate400:   '#94A3B8',
  slate600:   '#475569',
  slate700:   '#334155',
  slate900:   '#0F172A',
  green:      '#16A34A',
  greenBg:    '#F0FDF4',
  indigo:     '#4338CA',
  indigoBg:   '#EEF2FF',
  orange:     '#EA580C',
  orangeBg:   '#FFF7ED',
  amber:      '#D97706',
  amberBg:    '#FFFBEB',
};

const font = 'Arial, Helvetica, sans-serif';

export const ExportDossier = React.forwardRef<HTMLDivElement, ExportDossierProps>(
  ({ suggestion }, ref) => {
    const s = suggestion;

    const scoreColor = s.salesPotential === 'High' ? C.red
      : s.salesPotential === 'Medium' ? C.amber
      : C.lightBlue;

    const sentimentColor = s.sentimentPolarity === 'Bullish' ? C.green
      : s.sentimentPolarity === 'Bearish' ? C.red
      : C.slate600;

    // Commissioning verdict — the headline decision tile.
    const verdictColor = s.actionVerdict === 'PUBLISH NOW' ? C.red
      : s.actionVerdict === 'MONITOR' ? C.amber
      : C.slate600;
    const verdictBg = s.actionVerdict === 'PUBLISH NOW' ? '#FEF2F2'
      : s.actionVerdict === 'MONITOR' ? '#FEFCE8'
      : C.slate50;

    // White-space + trend, derived from real status (no emoji labels).
    const whiteSpaceText = s.whiteSpaceStatus === 'CONFIRMED_GAP' ? 'Confirmed Gap'
      : s.whiteSpaceStatus === 'PARTIAL_COVERAGE' ? 'Partial Coverage'
      : s.whiteSpaceStatus === 'COMMODITISED' ? 'Commoditised'
      : '—';
    const whiteSpaceColor = s.whiteSpaceStatus === 'CONFIRMED_GAP' ? C.green
      : s.whiteSpaceStatus === 'PARTIAL_COVERAGE' ? C.amber
      : s.whiteSpaceStatus === 'COMMODITISED' ? C.red
      : C.slate400;
    const trendText = s.trendDirection === 'RISING' ? 'Rising'
      : s.trendDirection === 'DECLINING' ? 'Declining'
      : s.trendDirection === 'STABLE' ? 'Stable'
      : '—';
    const trendColor = s.trendDirection === 'RISING' ? C.green
      : s.trendDirection === 'DECLINING' ? C.red
      : C.slate600;

    return (
      <div ref={ref} style={{
        width: '1100px',
        fontFamily: font,
        backgroundColor: C.white,
        color: C.slate700,
      }}>

        {/* HEADER */}
        <div style={{
          backgroundColor: C.navy,
          padding: '28px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div style={{
                width: '32px', height: '32px', backgroundColor: C.red,
                borderRadius: '4px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '18px', fontWeight: 900, color: C.white,
              }}>K</div>
              <span style={{ color: C.white, fontWeight: 900, fontSize: '14px', letterSpacing: '3px', textTransform: 'uppercase' }}>KAISO</span>
              <span style={{ color: C.lightBlue, fontWeight: 300, fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase' }}>Strategic Research OS</span>
            </div>
            <div style={{ color: C.white, fontWeight: 900, fontSize: '22px', lineHeight: 1.3, maxWidth: '660px' }}>
              {s.reportTitle}
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ backgroundColor: C.lightBlue, color: C.navy, fontSize: '9px', fontWeight: 900, padding: '3px 10px', borderRadius: '3px', letterSpacing: '2px', textTransform: 'uppercase' }}>{s.vertical}</span>
              <span style={{ backgroundColor: C.red, color: C.white, fontSize: '9px', fontWeight: 900, padding: '3px 10px', borderRadius: '3px', letterSpacing: '2px', textTransform: 'uppercase' }}>{s.strategicPillar}</span>
              <span style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: C.white, fontSize: '9px', fontWeight: 700, padding: '3px 10px', borderRadius: '3px', letterSpacing: '2px', textTransform: 'uppercase' }}>{s.thematicCluster}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: C.slate400, fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Confidence Index</div>
            <div style={{ color: C.white, fontWeight: 900, fontSize: '40px', lineHeight: 1 }}>{(s.confidenceScore ?? 0).toFixed(1)}</div>
            <div style={{ color: C.slate400, fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase' }}>/ 10.0</div>
          </div>
        </div>

        {/* SOURCE BAR */}
        <div style={{ backgroundColor: C.slate50, borderBottom: `1px solid ${C.slate200}`, padding: '10px 40px', display: 'flex', gap: '24px', alignItems: 'center' }}>
          <span style={{ fontSize: '9px', fontWeight: 900, color: C.red, textTransform: 'uppercase', letterSpacing: '2px' }}>SOURCE</span>
          <span style={{ fontSize: '10px', fontWeight: 700, color: C.slate700 }}>{s.sourceName}</span>
          <span style={{ color: C.slate200 }}>|</span>
          <span style={{ fontSize: '10px', color: C.slate600, flex: 1 }}>{s.sourceArticleTitle}</span>
          {(s.credibilityScore ?? 0) >= 60 && (
            <span style={{ fontSize: '9px', fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '1px' }}>● VERIFIED</span>
          )}
        </div>

        {/* MAIN BODY */}
        <div style={{ padding: '32px 40px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: '32px' }}>

          {/* LEFT COLUMN */}
          <div>

            {/* METRICS ROW */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '28px' }}>
              {[
                { label: 'Decision', value: s.actionVerdict ?? '—', color: verdictColor, bg: verdictBg },
                { label: 'Sales Potential', value: s.salesPotential, color: scoreColor, bg: C.slate50 },
                { label: 'Execution Window', value: s.marketExecutionWindow, color: C.navy, bg: C.slate50 },
                { label: 'Sentiment', value: s.sentimentPolarity, color: sentimentColor, bg: C.slate50 },
              ].map((m, i) => (
                <div key={i} style={{ backgroundColor: m.bg, border: `1px solid ${C.slate200}`, borderRadius: '6px', padding: '12px' }}>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: C.slate400, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px' }}>{m.label}</div>
                  <div style={{ fontSize: '11px', fontWeight: 900, color: m.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* RATIONALE */}
            {s.rationale && (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '10px', fontWeight: 900, color: C.navy, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '10px', borderBottom: `2px solid ${C.slate200}`, paddingBottom: '6px' }}>
                  Why This Market, Why Now
                </div>
                <div style={{ fontSize: '12px', color: C.slate700, lineHeight: 1.7, borderLeft: `3px solid ${C.lightBlue}`, paddingLeft: '14px' }}>
                  {s.rationale}
                </div>
              </div>
            )}

            {/* TRIGGER */}
            {s.trigger && (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '10px', fontWeight: 900, color: C.navy, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '10px', borderBottom: `2px solid ${C.slate200}`, paddingBottom: '6px' }}>
                  Primary Signal Trigger
                </div>
                <div style={{ backgroundColor: C.amberBg, border: `1px solid #FDE68A`, borderRadius: '6px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: C.amber, lineHeight: 1.5 }}>
                    {s.trigger}
                  </div>
                </div>
              </div>
            )}

            {/* B2B RATIONALE */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '10px', fontWeight: 900, color: C.navy, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '10px', borderBottom: `2px solid ${C.slate200}`, paddingBottom: '6px' }}>
                B2B Commercial Rationale
              </div>
              <div style={{ fontSize: '12px', color: C.slate700, lineHeight: 1.7, borderLeft: `3px solid ${C.red}`, paddingLeft: '14px' }}>
                {s.b2bCommercialRationale || s.rationale}
              </div>
            </div>

            {/* COMPETITOR WHITE SPACE */}
            <div>
              <div style={{ fontSize: '10px', fontWeight: 900, color: C.navy, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '10px', borderBottom: `2px solid ${C.slate200}`, paddingBottom: '6px' }}>
                Competitive White Space
              </div>
              <div style={{ backgroundColor: C.indigoBg, border: `1px solid #C7D2FE`, borderRadius: '6px', padding: '14px', marginBottom: '10px' }}>
                <div style={{ fontSize: '9px', fontWeight: 900, color: C.indigo, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Identified Entry Gap</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: C.red, lineHeight: 1.5 }}>{s.competitorWhiteSpace}</div>
              </div>
              {s.competitorContext && (
                <div style={{ fontSize: '11px', color: C.slate600, lineHeight: 1.6 }}>{s.competitorContext}</div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* MARKET KEYWORD */}
            <div style={{ backgroundColor: C.navy, borderRadius: '8px', padding: '18px' }}>
              <div style={{ fontSize: '10px', fontWeight: 900, color: C.lightBlue, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '10px' }}>Target Market Keyword</div>
              <div style={{ fontSize: '13px', fontWeight: 900, color: C.white, lineHeight: 1.5, wordBreak: 'break-word' }}>
                {s.marketKeyword}
              </div>
            </div>

            {/* COMMERCIAL PRECISION */}
            <div style={{ backgroundColor: C.slate50, border: `1px solid ${C.slate200}`, borderRadius: '8px', padding: '18px' }}>
              <div style={{ fontSize: '10px', fontWeight: 900, color: C.navy, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '14px' }}>Commercial Precision</div>
              {[
                { label: 'Opportunity Score', value: typeof s.opportunityScore === 'number' ? `${s.opportunityScore}/100` : '—', color: C.red },
                { label: 'White Space', value: whiteSpaceText, color: whiteSpaceColor },
                { label: 'Search Trend', value: trendText, color: trendColor },
                { label: 'Signal Credibility', value: `${s.credibilityScore ?? '—'}%`, color: C.green },
                { label: 'Primary Stakeholder', value: s.primaryStakeholder ?? '—', color: C.red },
              ].map((m, i, arr) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < arr.length - 1 ? `1px solid ${C.slate200}` : 'none' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, color: C.slate400, textTransform: 'uppercase', letterSpacing: '1px' }}>{m.label}</span>
                  <span style={{ fontSize: '10px', fontWeight: 900, color: m.color, textTransform: 'uppercase', maxWidth: '160px', textAlign: 'right' }}>{m.value}</span>
                </div>
              ))}
            </div>

            {/* KEYWORDS */}
            <div style={{ backgroundColor: C.slate50, border: `1px solid ${C.slate200}`, borderRadius: '8px', padding: '18px' }}>
              <div style={{ fontSize: '10px', fontWeight: 900, color: C.navy, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px' }}>Strategic SEO Markers</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {(s.trendingKeywords ?? []).map((kw, i) => (
                  <span key={i} style={{ fontSize: '9px', fontWeight: 700, color: C.slate600, backgroundColor: C.white, border: `1px solid ${C.slate200}`, borderRadius: '4px', padding: '3px 8px' }}>#{kw}</span>
                ))}
              </div>
            </div>

            {/* VERACITY */}
            <div style={{ backgroundColor: C.greenBg, border: `1px solid #BBF7D0`, borderRadius: '8px', padding: '18px' }}>
              <div style={{ fontSize: '10px', fontWeight: 900, color: C.green, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '10px' }}>✓ Veracity Protocol</div>
              <div style={{ fontSize: '10px', color: C.slate600, lineHeight: 1.6, fontStyle: 'italic', borderLeft: `3px solid ${C.green}`, paddingLeft: '10px' }}>
                "{s.veracityRationale ?? 'Source classified as verified media.'}"
              </div>
            </div>

          </div>
        </div>

        {/* FOOTER */}
        <div style={{ backgroundColor: C.navy, padding: '14px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase' }}>
            © 2026 KAISO RESEARCH AND CONSULTING // CONFIDENTIAL INTELLIGENCE SNAPSHOT
          </span>
          <span style={{ color: C.lightBlue, fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
            kaisoresearch.com
          </span>
        </div>

      </div>
    );
  }
);

ExportDossier.displayName = 'ExportDossier';
