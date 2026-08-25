import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { solidPng } from './png';

/**
 * Renders a synthetic bank statement PDF that looks like the real thing:
 * right-aligned amount columns, wrapped narration spilling over several lines,
 * repeated page headers, and a reconciling footer.
 *
 * Deliberately faithful, because a fixture that is easier to parse than a real
 * statement proves nothing.
 */

export interface ColumnSpec {
  label: string;
  x: number;
  width: number;
  align: 'left' | 'right';
}

export interface StatementSpec {
  outputPath: string;
  /** Lines printed above the table on page 1 (bank name, account details). */
  headerLines: string[];
  columns: ColumnSpec[];
  /** One entry per table row; cells align with `columns`. */
  rows: string[][];
  footerLines: string[];
  /** When set, the PDF is encrypted and needs this password to open. */
  password?: string;
  landscape?: boolean;
  rowsPerPage?: number;
  /** Rendered under the header on every page, e.g. a statement period. */
  subHeader?: string;
}

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const BODY_SIZE = 8;
const LINE_HEIGHT = 11;

export async function renderStatement(spec: StatementSpec): Promise<void> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: spec.landscape ? 'landscape' : 'portrait',
    margin: 28,
    ...(spec.password
      ? { userPassword: spec.password, ownerPassword: `${spec.password}-owner`, pdfVersion: '1.7' as const }
      : {}),
  });

  const stream = createWriteStream(spec.outputPath);
  doc.pipe(stream);

  const bottom = doc.page.height - 40;
  let y = 0;

  const drawPageHeader = (first: boolean) => {
    y = 32;
    if (first) {
      for (const [i, line] of spec.headerLines.entries()) {
        doc.font(i === 0 ? FONT_BOLD : FONT).fontSize(i === 0 ? 13 : 8.5);
        doc.text(line, 32, y, { lineBreak: false });
        y += i === 0 ? 18 : 11;
      }
      y += 6;
    } else if (spec.subHeader) {
      doc.font(FONT).fontSize(8);
      doc.text(spec.subHeader, 32, y, { lineBreak: false });
      y += 14;
    }
    drawColumnHeaders();
  };

  const drawColumnHeaders = () => {
    doc.font(FONT_BOLD).fontSize(BODY_SIZE);
    for (const col of spec.columns) {
      doc.text(col.label, col.x, y, { width: col.width, align: col.align, lineBreak: false });
    }
    y += LINE_HEIGHT;
    doc.moveTo(30, y - 2).lineTo(doc.page.width - 30, y - 2).lineWidth(0.5).stroke();
    y += 2;
    doc.font(FONT).fontSize(BODY_SIZE);
  };

  assertColumnsFit(doc, spec);
  drawPageHeader(true);

  for (const row of spec.rows) {
    const wrapped = wrapRow(doc, row, spec.columns);

    if (y + wrapped.length * LINE_HEIGHT > bottom - 60) {
      doc.addPage();
      drawPageHeader(false);
    }

    for (const line of wrapped) {
      for (const [c, col] of spec.columns.entries()) {
        const text = line[c] ?? '';
        if (text === '') continue;
        doc.text(text, col.x, y, { width: col.width, align: col.align, lineBreak: false });
      }
      y += LINE_HEIGHT;
    }
  }

  y += 6;
  doc.moveTo(30, y).lineTo(doc.page.width - 30, y).lineWidth(0.5).stroke();
  y += 8;
  doc.font(FONT_BOLD).fontSize(BODY_SIZE);
  for (const line of spec.footerLines) {
    if (y > bottom) {
      doc.addPage();
      y = 40;
    }
    doc.text(line, 32, y, { lineBreak: false });
    y += LINE_HEIGHT;
  }

  doc.end();
  await once(stream, 'finish');
}

/** The narration column is the widest left-aligned one. */
function narrationColumnIndex(columns: ColumnSpec[]): number {
  let best = -1;
  let bestWidth = 0;
  columns.forEach((col, i) => {
    if (col.align === 'left' && col.width > bestWidth) {
      best = i;
      bestWidth = col.width;
    }
  });
  return best;
}

/**
 * Splits one logical row into the visual lines a bank would print: the
 * narration wraps, every other cell stays on the first line. This is the
 * pattern the parser's wrapped-row merge has to undo.
 */
function wrapRow(doc: PDFKit.PDFDocument, row: string[], columns: ColumnSpec[]): string[][] {
  const index = narrationColumnIndex(columns);
  if (index === -1) return [row];

  const column = columns[index]!;
  const narration = row[index] ?? '';
  const chunks = wrapToWidth(doc, narration, column.width);
  if (chunks.length <= 1) return [row];

  const first = [...row];
  first[index] = chunks[0]!;

  const continuations = chunks.slice(1).map((chunk) => {
    const line = columns.map(() => '');
    line[index] = chunk;
    return line;
  });

  return [first, ...continuations];
}

/** Wraps on measured glyph width, not a character count, so nothing is clipped. */
function wrapToWidth(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
  doc.font(FONT).fontSize(BODY_SIZE);
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    for (const piece of breakLongWord(doc, word, width)) {
      const candidate = current === '' ? piece : `${current} ${piece}`;
      if (doc.widthOfString(candidate) <= width) current = candidate;
      else {
        if (current) lines.push(current);
        current = piece;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Splits a token that cannot fit its column on its own.
 *
 * Long unbroken UPI and NEFT references are common and no space ever appears in
 * them, so without this the ink runs past the column and closes the gutter the
 * parser relies on to find the next column.
 */
function breakLongWord(doc: PDFKit.PDFDocument, word: string, width: number): string[] {
  if (doc.widthOfString(word) <= width) return [word];

  const pieces: string[] = [];
  let current = '';
  for (const ch of word) {
    if (current !== '' && doc.widthOfString(current + ch) > width) {
      pieces.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Rejects a layout whose headers or values would be clipped.
 *
 * Clipping is exactly the silent corruption this project exists to prevent — a
 * balance rendered as `4,70,243` instead of `4,70,243.01` would quietly poison
 * every golden file. Better to fail while generating fixtures.
 */
function assertColumnsFit(doc: PDFKit.PDFDocument, spec: StatementSpec): void {
  const pageWidth = doc.page.width;
  const problems: string[] = [];
  const narration = narrationColumnIndex(spec.columns);

  spec.columns.forEach((col, i) => {
    if (col.x + col.width > pageWidth - 20) {
      problems.push(`column "${col.label}" ends at ${col.x + col.width} beyond page width ${pageWidth}`);
    }
    doc.font(FONT_BOLD).fontSize(BODY_SIZE);
    const labelWidth = doc.widthOfString(col.label);
    if (labelWidth > col.width) {
      problems.push(`header "${col.label}" needs ${labelWidth.toFixed(1)} but column is ${col.width}`);
    }

    doc.font(FONT).fontSize(BODY_SIZE);
    if (i === narration) return; // narration is allowed to wrap
    for (const row of spec.rows) {
      const value = row[i] ?? '';
      const valueWidth = doc.widthOfString(value);
      if (valueWidth > col.width) {
        problems.push(`value "${value}" needs ${valueWidth.toFixed(1)} but column "${col.label}" is ${col.width}`);
        break;
      }
    }
  });

  if (problems.length) {
    throw new Error(`Fixture layout for ${spec.outputPath} would clip text:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * A PDF with no text layer at all — a full-page raster image standing in for
 * every page, the way an actual scanner or scanning app produces one. Vector
 * shapes alone would not exercise this correctly: a real scan is always a
 * raster image, and the detector's job is to notice exactly that.
 */
export async function renderScannedLookalike(outputPath: string): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  const page = solidPng(600, 850, [244, 244, 244]);
  doc.image(page, 0, 0, { width: doc.page.width, height: doc.page.height });

  doc.end();
  await once(stream, 'finish');
}

/**
 * A two-page digital statement whose second page is legitimately sparse — a
 * closing page with a small letterhead logo and a couple of disclaimer lines,
 * the way a real bank's trailing page looks. Nothing here should be treated
 * as a scan: the logo is far too small to be page content.
 */
export async function renderSparseTrailingPage(outputPath: string): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  doc.fontSize(9);
  for (let i = 0; i < 40; i++) {
    doc.text(`01-04-2025  Transaction narration line ${i}  1,000.00  ${(i + 1) * 1000}.00`);
  }

  doc.addPage();
  // A modest letterhead logo — small in both drawn size and source resolution.
  doc.image(solidPng(120, 120), 40, 40, { width: 60, height: 60 });
  doc.fontSize(8);
  doc.text('COMPUTER OUTPUT DOES NOT REQUIRE SIGNATURE.', 40, 140);
  doc.text('******END OF STATEMENT******', 40, 154);
  doc.text('Confidential', 40, 168);

  doc.end();
  await once(stream, 'finish');
}

/**
 * A two-page document where page 1 is a normal digital statement and page 2 is
 * an actual scan: almost no text, and one image covering the whole page at a
 * real scan resolution. The detector must still catch this and name page 2.
 */
export async function renderPartialScan(outputPath: string): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  doc.fontSize(9);
  for (let i = 0; i < 40; i++) {
    doc.text(`01-04-2025  Transaction narration line ${i}  1,000.00  ${(i + 1) * 1000}.00`);
  }

  doc.addPage();
  // A full-page raster at a real scan resolution, with only a stray watermark
  // as text — this is what a genuinely scanned page looks like.
  doc.image(solidPng(600, 800), 0, 0, { width: doc.page.width, height: doc.page.height });
  doc.fontSize(60).fillColor('white').text('DRAFT', 200, 400);

  doc.end();
  await once(stream, 'finish');
}
