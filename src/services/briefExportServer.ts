/**
 * briefExportServer.ts
 *
 * Server-side DOCX generator for the Kaiso analyst brief.
 * Runs in Node.js (no browser compatibility issues).
 * Called by the /api/brief/export-docx endpoint in server.ts.
 * Returns a Buffer that the Express route streams back to the client.
 *
 * Design: Kaiso brand — Navy (#1A3668), Red (#D62828), clean professional layout.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  VerticalAlign,
  PageNumber,
  LevelFormat,
  TabStopType,
} from 'docx';

// ─────────────────────────────────────────────────────────────────────────────
// BRAND CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const NAVY   = '1A3668';
const RED    = 'D62828';
const LIGHT  = 'F0F4FA';
const GRAY   = '64748B';
const BORDER = 'CBD5E1';
const WHITE  = 'FFFFFF';

const PAGE_W    = 12240;
const PAGE_H    = 15840;
const MARGIN    = 1440;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9360

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const thinBorder  = { style: BorderStyle.SINGLE, size: 1, color: BORDER };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function spacer(before = 0, after = 0): Paragraph {
  return new Paragraph({ spacing: { before, after }, children: [] });
}

function rule(color = NAVY, thickness = 8): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    border: { bottom: { style: BorderStyle.SINGLE, size: thickness, color } },
    children: [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BRIEF TEXT PARSER
// ─────────────────────────────────────────────────────────────────────────────

type BlockType = 'h2' | 'h3' | 'bullet' | 'body' | 'verdict';

interface Block {
  type: BlockType;
  text: string;
  verdict?: 'COMMISSION' | 'DEFER' | 'PASS' | null;
}

function parseBrief(raw: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('## '))      blocks.push({ type: 'h2', text: line.replace(/^##\s+/, '') });
    else if (line.startsWith('### ')) blocks.push({ type: 'h3', text: line.replace(/^###\s+/, '') });
    else if (/^[-*•]\s/.test(line))  blocks.push({ type: 'bullet', text: line.replace(/^[-*•]\s+/, '') });
    else if (/^(COMMISSION|DEFER|PASS)/.test(line)) {
      const verdict = line.startsWith('COMMISSION') ? 'COMMISSION'
        : line.startsWith('DEFER') ? 'DEFER'
        : 'PASS';
      blocks.push({ type: 'verdict', text: line, verdict });
    } else {
      blocks.push({ type: 'body', text: line });
    }
  }
  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORECARD TABLE (cover page)
// ─────────────────────────────────────────────────────────────────────────────

function buildScorecardTable(s: any): Table {
  const score  = ((s.confidenceScore ?? 0) as number).toFixed(1);
  const cagr   = (s.estimatedCAGRRange as string | undefined)?.split(',')[0] ?? '—';
  const window = (s.marketExecutionWindow as string | undefined) ?? '—';
  const risk   = (s.executionRisk as string | undefined) ?? '—';
  const trend  = (s.trendDirectionLabel as string | undefined) ?? '—';
  const sales  = (s.salesPotential as string | undefined) ?? '—';

  const cellW = Math.floor(CONTENT_W / 3);

  const scoreCell = (label: string, value: string, highlight = false) =>
    new TableCell({
      borders: cellBorders,
      width: { size: cellW, type: WidthType.DXA },
      shading: { fill: highlight ? LIGHT : WHITE, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 180, right: 180 },
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          spacing: { before: 0, after: 40 },
          children: [new TextRun({ text: label, font: 'Arial', size: 16, color: GRAY, bold: true })],
        }),
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: value, font: 'Arial', size: 26, bold: true, color: highlight ? RED : NAVY })],
        }),
      ],
    });

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [cellW, cellW, cellW],
    rows: [
      new TableRow({ children: [
        scoreCell('CONFIDENCE INDEX', `${score} / 10`, true),
        scoreCell('EST. CAGR', cagr),
        scoreCell('EXECUTION WINDOW', window),
      ]}),
      new TableRow({ children: [
        scoreCell('EXECUTION RISK', risk),
        scoreCell('MARKET TREND', trend),
        scoreCell('COMMERCIAL FLOW', sales),
      ]}),
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COVER PAGE
// ─────────────────────────────────────────────────────────────────────────────

function buildCoverPage(s: any): (Paragraph | Table)[] {
  const dateStr  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const vertical = ((s.vertical as string | undefined) ?? 'MARKET INTELLIGENCE').toUpperCase();
  const pillar   = ((s.strategicPillar as string | undefined) ?? '').toUpperCase();

  return [
    rule(RED, 24),
    spacer(480),
    new Paragraph({
      spacing: { before: 0, after: 80 },
      children: [
        new TextRun({ text: 'KAISO', font: 'Arial', size: 52, bold: true, color: NAVY }),
        new TextRun({ text: '  RESEARCH & CONSULTING', font: 'Arial', size: 24, color: GRAY }),
      ],
    }),
    rule(NAVY, 4),
    spacer(320),
    new Paragraph({
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: 'REPORT COMMISSION BRIEF  ·  CONFIDENTIAL', font: 'Arial', size: 18, bold: true, color: RED })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text: s.reportTitle as string, font: 'Georgia', size: 44, bold: true, color: NAVY })],
    }),
    new Paragraph({
      spacing: { before: 40, after: 0 },
      children: [
        new TextRun({ text: 'Vertical: ',  font: 'Arial', size: 18, bold: true, color: GRAY }),
        new TextRun({ text: vertical,       font: 'Arial', size: 18, color: NAVY }),
        ...(pillar ? [
          new TextRun({ text: '   ·   ',   font: 'Arial', size: 18, color: BORDER }),
          new TextRun({ text: 'Pillar: ',  font: 'Arial', size: 18, bold: true, color: GRAY }),
          new TextRun({ text: pillar,       font: 'Arial', size: 18, color: NAVY }),
        ] : []),
        new TextRun({ text: '   ·   ',     font: 'Arial', size: 18, color: BORDER }),
        new TextRun({ text: 'Date: ',      font: 'Arial', size: 18, bold: true, color: GRAY }),
        new TextRun({ text: dateStr,        font: 'Arial', size: 18, color: NAVY }),
      ],
    }),
    spacer(200),
    rule(BORDER, 2),
    spacer(200),
    buildScorecardTable(s),
    spacer(600),
    rule(NAVY, 4),
    spacer(80),
    new Paragraph({
      children: [new TextRun({ text: 'KAISO Intelligence OS  ·  Internal Use Only  ·  Not for Distribution', font: 'Arial', size: 16, color: GRAY, italics: true })],
    }),
    new Paragraph({ pageBreakBefore: true, children: [] }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function buildBody(blocks: Block[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let bulletGroupRef = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const prev  = blocks[i - 1];

    switch (block.type) {
      case 'h2': {
        if (i > 0) paragraphs.push(spacer(280, 0));
        paragraphs.push(new Paragraph({
          spacing: { before: 0, after: 0 },
          shading: { fill: NAVY, type: ShadingType.CLEAR },
          children: [new TextRun({ text: `  ${block.text.toUpperCase()}  `, font: 'Arial', size: 22, bold: true, color: WHITE })],
        }));
        paragraphs.push(spacer(120, 0));
        break;
      }
      case 'h3': {
        paragraphs.push(spacer(180, 0));
        paragraphs.push(new Paragraph({
          spacing: { before: 0, after: 60 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RED } },
          children: [new TextRun({ text: block.text, font: 'Arial', size: 22, bold: true, color: NAVY })],
        }));
        break;
      }
      case 'bullet': {
        if (!prev || prev.type !== 'bullet') bulletGroupRef++;
        paragraphs.push(new Paragraph({
          numbering: { reference: `bullets-${bulletGroupRef}`, level: 0 },
          spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: block.text, font: 'Arial', size: 20, color: '1E293B' })],
        }));
        break;
      }
      case 'verdict': {
        const color = block.verdict === 'COMMISSION' ? '16A34A'
          : block.verdict === 'DEFER' ? 'D97706'
          : RED;
        paragraphs.push(spacer(160, 0));
        paragraphs.push(new Paragraph({
          spacing: { before: 0, after: 0 },
          shading: { fill: LIGHT, type: ShadingType.CLEAR },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color }, top: thinBorder, bottom: thinBorder, right: thinBorder },
          indent: { left: 240, right: 240 },
          children: [new TextRun({ text: block.text, font: 'Arial', size: 26, bold: true, color })],
        }));
        paragraphs.push(spacer(80, 0));
        break;
      }
      default: {
        paragraphs.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text: block.text, font: 'Arial', size: 20, color: '1E293B' })],
        }));
      }
    }
  }
  return paragraphs;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER & FOOTER
// ─────────────────────────────────────────────────────────────────────────────

function buildHeader(): Header {
  return new Header({
    children: [new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [
        new TextRun({ text: 'KAISO  ·  Report Commission Brief', font: 'Arial', size: 16, bold: true, color: NAVY }),
        new TextRun({ text: '\t', font: 'Arial', size: 16 }),
        new TextRun({ text: 'CONFIDENTIAL', font: 'Arial', size: 16, color: RED, bold: true }),
      ],
    })],
  });
}

function buildFooter(): Footer {
  return new Footer({
    children: [new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER } },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [
        new TextRun({ text: 'KAISO Research & Consulting  ·  kaisoresearch.com', font: 'Arial', size: 16, color: GRAY }),
        new TextRun({ text: '\t', font: 'Arial', size: 16 }),
        new TextRun({ text: 'Page ', font: 'Arial', size: 16, color: GRAY }),
        new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: GRAY }),
      ],
    })],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NUMBERING CONFIG
// ─────────────────────────────────────────────────────────────────────────────

function buildNumberingConfig(blocks: Block[]) {
  const groups: number[] = [];
  let ref = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], prev = blocks[i - 1];
    if (b.type === 'bullet' && (!prev || prev.type !== 'bullet')) {
      groups.push(++ref);
    }
  }
  return groups.map(r => ({
    reference: `bullets-${r}`,
    levels: [{
      level: 0, format: LevelFormat.BULLET, text: '▪', alignment: AlignmentType.LEFT,
      style: {
        run: { font: 'Arial', size: 20, color: RED },
        paragraph: { indent: { left: 480, hanging: 240 } },
      },
    }],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — returns a Buffer
// ─────────────────────────────────────────────────────────────────────────────

export async function generateBriefDocxBuffer(
  briefText: string,
  suggestion: any
): Promise<Buffer> {
  const blocks          = parseBrief(briefText);
  const numberingConfig = buildNumberingConfig(blocks);
  const coverChildren   = buildCoverPage(suggestion);
  const bodyChildren    = buildBody(blocks);

  const doc = new Document({
    numbering: { config: numberingConfig },
    styles: {
      default: { document: { run: { font: 'Arial', size: 20 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial', color: NAVY },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        children: coverChildren,
      },
      {
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1080, right: MARGIN, bottom: 1080, left: MARGIN } } },
        headers: { default: buildHeader() },
        footers: { default: buildFooter() },
        children: bodyChildren,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
