import type { Grid, GridRow, PageText, TextItem } from '@/lib/schema';
import { isAmountLike } from '@/lib/parse/parseAmount';
import { isDateLike } from '@/lib/parse/parseDate';

export interface GridOptions {
  /** Two items belong to the same row when their baselines differ by less than this × median line height. */
  rowToleranceFactor?: number;
  /** Two column peaks closer than this many PDF units are the same column. */
  minColumnGap?: number;
  /** A column peak must be supported by at least this fraction of rows. */
  columnSupportRatio?: number;
}

const DEFAULTS = {
  rowToleranceFactor: 0.4,
  /** Narrowest vertical whitespace ribbon that counts as a column gutter. */
  minColumnGap: 6,
  columnSupportRatio: 0.1,
} as const;

/**
 * Fraction of rows allowed to leak across a gutter before it stops counting as
 * one. Real statements have the odd over-long narration that crowds the next
 * column; that must not collapse two columns into one.
 */
const GUTTER_LEAK_RATIO = 0.08;

/**
 * A bin starts a new column when its row coverage jumps by this fraction of the
 * table's busiest bin.
 */
const RISE_RATIO = 0.15;

/**
 * Consecutive bins of identical coverage absorbed into a climb before it is
 * treated as the flat body of a column.
 */
const MAX_PLATEAU_BINS = 2;

/** Fewest transaction rows needed before their gutters are trusted. */
const MIN_BAND_ROWS = 5;

/**
 * Narrowest gutter between two columns of the transaction band.
 *
 * Statements butt columns as close as 4pt, so the band profile is binned at
 * single-unit resolution — a 3pt grid straddles a gutter that tight and loses
 * it. An inter-word space at typical statement font sizes is about 2pt, which
 * stays safely under this threshold.
 */
const BAND_MIN_GAP = 3;
const BAND_BIN_WIDTH = 1;

/**
 * Share of transaction rows allowed to have ink inside a gutter.
 *
 * Generous on purpose. Cells are assigned by their *left edge*, so a boundary
 * that lands a few units early still captures every cell of its column — but a
 * gutter missed entirely welds two columns together for good.
 */
const BAND_LEAK_RATIO = 0.2;

/**
 * How far a run must reach past a column boundary before it is treated as two
 * cells that pdf.js welded together. Both an absolute and a relative floor,
 * because column widths vary by an order of magnitude across banks.
 */
const MIN_MERGE_OVERHANG = 12;
const MIN_MERGE_OVERHANG_RATIO = 0.06;

/** Boundaries closer than this describe the same column edge. */
const BOUNDARY_MERGE_TOLERANCE = 8;

/** Histogram resolution for left-edge clustering, in PDF units (~half a character). */
const BIN_WIDTH = 3;
/** An item may start this far left of a column edge and still belong to it. */
const COLUMN_SNAP_TOLERANCE = 2.5;

/**
 * Turns positioned text into a table: rows clustered by baseline, cells
 * assigned to columns detected from the left-edge histogram.
 *
 * Rows are returned unmerged — the wrapped-narration fold is a separate step
 * (`mergeWrappedRows`) because it needs to know which column holds the date and
 * which hold amounts, and that only becomes known once a template matches.
 */
export function buildGrid(pages: PageText[], options: GridOptions = {}): Grid {
  const opts = { ...DEFAULTS, ...options };

  const clustered: Array<{ pageNumber: number; items: TextItem[]; y: number }> = [];
  for (const page of pages) {
    for (const row of clusterRows(page, opts.rowToleranceFactor)) {
      clustered.push({ pageNumber: page.pageNumber, items: row, y: medianOf(row.map((i) => i.y)) });
    }
  }

  const columnEdges = detectColumns(clustered.map((r) => r.items), opts);

  const rows: GridRow[] = clustered.map((row) => ({
    // Only transaction rows may have welded runs split apart. Header rows are
    // matched by their label text, and cutting a wide header like
    // "Withdrawal Amount (INR)" in half would break that matching.
    cells: assignCells(row.items, columnEdges, isBandRow(row.items)),
    y: row.y,
    pageNumber: row.pageNumber,
    items: row.items,
  }));

  return { rows, columnEdges, columnCount: columnEdges.length };
}

/* ------------------------------------------------------------------ *
 * Row clustering
 * ------------------------------------------------------------------ */

/**
 * Groups items into visual lines. A fixed pixel tolerance breaks on statements
 * that mix font sizes, so the threshold is derived from the page's own median
 * line height.
 */
export function clusterRows(page: PageText, toleranceFactor: number = DEFAULTS.rowToleranceFactor): TextItem[][] {
  if (page.items.length === 0) return [];

  const medianHeight = medianOf(page.items.map((i) => i.height)) || 10;
  const tolerance = Math.max(1, medianHeight * toleranceFactor);

  const sorted = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: TextItem[][] = [];
  let current: TextItem[] = [];
  let anchorY = Number.NEGATIVE_INFINITY;

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(item.y - anchorY) <= tolerance) {
      if (current.length === 0) anchorY = item.y;
      current.push(item);
    } else {
      rows.push(current.sort((a, b) => a.x - b.x));
      current = [item];
      anchorY = item.y;
    }
  }
  if (current.length) rows.push(current.sort((a, b) => a.x - b.x));

  return rows;
}

/* ------------------------------------------------------------------ *
 * Column detection
 * ------------------------------------------------------------------ */

/**
 * Finds the column boundaries of the table.
 *
 * Works on a *coverage profile*: for each vertical band of the page, how many
 * table rows have ink there. Column boundaries are where that profile rises
 * sharply — a gutter almost nobody occupies, immediately followed by a band
 * almost every row occupies.
 *
 * A rising edge beats the obvious alternatives:
 *
 *  - A left-edge histogram smears on right-aligned amount columns, and every
 *    bank right-aligns amounts.
 *  - A plain "empty gutter" test breaks on real statements, where the address
 *    banner spans the full width and column headers are wider than the values
 *    beneath them, so no band is ever truly empty.
 *
 * The boundary is placed where content *resumes*, so a right-aligned column
 * anchors on its widest value and every shorter value still falls inside it.
 *
 * Returns the left edge of each detected column, ascending.
 */
export function detectColumns(
  rows: TextItem[][],
  options: { minColumnGap: number; columnSupportRatio: number } = DEFAULTS,
): number[] {
  const fromBand = detectColumnsByTransactionBand(rows);
  if (fromBand.length >= 3) return fromBand;

  const fromProfile = detectColumnsByCoverage(rows, options.minColumnGap);
  if (fromProfile.length >= 3) return fromProfile;

  const fromPeaks = detectColumnsByLeftEdge(rows, options);
  return fromPeaks.length > fromProfile.length ? fromPeaks : fromProfile;
}

/**
 * A row belongs to the transaction band when it carries both a date and an
 * amount.
 *
 * That pair is what separates real transactions from everything else on the
 * page: the address banner has an account number but no date, the period line
 * has a date but no money, wrapped narration has neither, and the column
 * headers have neither. No template knowledge is needed, so this runs before
 * anything about the bank is known.
 */
function isBandRow(items: TextItem[]): boolean {
  let hasDate = false;
  let hasAmount = false;
  for (const item of items) {
    if (!hasDate && isDateLike(item.str)) hasDate = true;
    else if (!hasAmount && isAmountLike(item.str)) hasAmount = true;
    if (hasDate && hasAmount) return true;
  }
  return false;
}

/**
 * Column boundaries from the whitespace gutters of the transaction rows alone.
 *
 * Restricting the profile to the band is what makes plain gutter detection work
 * here. Across the whole page no band is ever empty — the address line spans
 * the full width and column headers are wider than the values beneath them — but
 * within the band every row has the same shape, so the gutters are pristine.
 *
 * Each boundary is placed at the *start* of its gutter, meaning "where the
 * previous column's ink stops". That is the one choice that works for both
 * alignments: a right-aligned amount may begin anywhere after it, and a
 * left-aligned cell begins immediately after it.
 */
export function detectColumnsByTransactionBand(rows: TextItem[][]): number[] {
  const band = rows.filter(isBandRow);
  if (band.length < MIN_BAND_ROWS) return [];

  const profile = buildCoverageProfile(band, 1, BAND_BIN_WIDTH);
  if (!profile) return [];

  const { minX, coverage } = profile;
  const minGapBins = Math.max(1, Math.round(BAND_MIN_GAP / BAND_BIN_WIDTH));

  // pdf.js merges two cells into a single text run when the gutter between them
  // is narrow, which puts ink right across the gap on those rows. A gutter is
  // therefore "mostly empty" rather than empty.
  const leak = Math.max(1, Math.floor(band.length * BAND_LEAK_RATIO));

  const edges: number[] = [minX];
  let runStart = -1;

  for (let b = 0; b < coverage.length; b++) {
    if (coverage[b]! <= leak) {
      if (runStart === -1) runStart = b;
      continue;
    }
    if (runStart > 0 && b - runStart >= minGapBins) {
      edges.push(minX + runStart * BAND_BIN_WIDTH);
    }
    runStart = -1;
  }

  return edges;
}

interface CoverageProfile {
  minX: number;
  /** How many rows have ink in each bin. */
  coverage: Uint32Array;
  rowCount: number;
  binWidth: number;
}

/**
 * Counts rows, not items: two runs from the same row poking into a gutter is
 * one row's worth of evidence, not two.
 *
 * Only rows with three or more runs are considered — titles and footer prose
 * are one or two long runs that span the whole width.
 */
function buildCoverageProfile(rows: TextItem[][], minItems = 3, binWidth = BIN_WIDTH): CoverageProfile | null {
  const tabular = rows.filter((r) => r.length >= minItems);
  if (tabular.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const row of tabular) {
    for (const item of row) {
      if (item.x < minX) minX = item.x;
      const right = item.x + Math.max(item.width, 1);
      if (right > maxX) maxX = right;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) return null;

  const binCount = Math.ceil((maxX - minX) / binWidth) + 1;
  if (binCount > 100_000) return null;

  const coverage = new Uint32Array(binCount);
  for (const row of tabular) {
    const touched = new Set<number>();
    for (const item of row) {
      const from = Math.max(0, Math.floor((item.x - minX) / binWidth));
      const to = Math.min(binCount, Math.ceil((item.x + Math.max(item.width, 1) - minX) / binWidth));
      for (let b = from; b < to; b++) touched.add(b);
    }
    for (const b of touched) coverage[b]! += 1;
  }

  return { minX, coverage, rowCount: tabular.length, binWidth };
}

export function detectColumnsByCoverage(rows: TextItem[][], minGapWidth: number): number[] {
  const profile = buildCoverageProfile(rows);
  if (!profile) return [];

  const { minX, coverage, rowCount } = profile;
  let maxCoverage = 0;
  for (const c of coverage) if (c > maxCoverage) maxCoverage = c;
  if (maxCoverage === 0) return [];

  const candidates: number[] = [minX];

  // Rule 1: the start of a sustained rise in coverage. This is the primary signal.
  //
  // The rise is measured across a whole ascending run rather than bin to bin,
  // because a right-aligned column climbs gradually: the widest value starts
  // furthest left and each narrower one joins a little later. Testing adjacent
  // bins fires several times inside one column and shatters it.
  const riseThreshold = Math.max(2, maxCoverage * RISE_RATIO);
  for (const run of ascendingRuns(coverage)) {
    if (run.rise >= riseThreshold) candidates.push(minX + run.startBin * BIN_WIDTH);
  }

  // Rule 2: a wide, near-empty ribbon. Catches sparse columns — a cheque-number
  // column that is blank on most rows never produces a sharp rise.
  const leakTolerance = Math.max(1, Math.floor(rowCount * GUTTER_LEAK_RATIO));
  const minGapBins = Math.max(1, Math.round(minGapWidth / BIN_WIDTH));
  let runStart = -1;
  for (let b = 0; b < coverage.length; b++) {
    if (coverage[b]! <= leakTolerance) {
      if (runStart === -1) runStart = b;
      continue;
    }
    if (runStart > 0 && b - runStart >= minGapBins) candidates.push(minX + b * BIN_WIDTH);
    runStart = -1;
  }

  return mergeNearby(candidates, BOUNDARY_MERGE_TOLERANCE);
}

interface AscendingRun {
  /** First bin of the climb — the column's left edge. */
  startBin: number;
  /** Total gain from the valley floor to the top of the climb. */
  rise: number;
  /** Coverage the climb started from. Zero means it rose out of a gutter. */
  floor: number;
}

/**
 * Finds maximal stretches where row coverage climbs.
 *
 * Short plateaus are absorbed into a climb (a right-aligned column often has
 * two values of identical width), but a longer flat stretch ends the run — that
 * is the body of a column, not its edge.
 */
function ascendingRuns(coverage: Uint32Array): AscendingRun[] {
  const runs: AscendingRun[] = [];
  const n = coverage.length;
  let b = 0;

  while (b < n - 1) {
    // Walk to the floor of the next climb.
    while (b < n - 1 && coverage[b + 1]! <= coverage[b]!) b++;
    if (b >= n - 1) break;

    const floor = coverage[b]!;
    const startBin = b + 1;
    let e = b + 1;
    let flat = 0;

    while (e < n - 1) {
      const next = coverage[e + 1]!;
      const current = coverage[e]!;
      if (next > current) {
        flat = 0;
        e++;
      } else if (next === current && flat < MAX_PLATEAU_BINS) {
        flat++;
        e++;
      } else {
        break;
      }
    }

    runs.push({ startBin, rise: coverage[e]! - floor, floor });
    b = e;
  }

  return runs;
}

/** Collapses boundaries that describe the same edge, keeping the leftmost. */
function mergeNearby(values: number[], tolerance: number): number[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || value - last > tolerance) out.push(value);
  }
  return out;
}

function detectColumnsByLeftEdge(
  rows: TextItem[][],
  options: { minColumnGap: number; columnSupportRatio: number },
): number[] {
  const bins = new Map<number, { count: number; sum: number }>();
  for (const row of rows) {
    for (const item of row) {
      const bin = Math.round(item.x / BIN_WIDTH);
      const entry = bins.get(bin) ?? { count: 0, sum: 0 };
      entry.count += 1;
      entry.sum += item.x;
      bins.set(bin, entry);
    }
  }
  if (bins.size === 0) return [];

  const minSupport = Math.max(3, Math.ceil(rows.length * options.columnSupportRatio));

  // Smooth over adjacent bins so a column that jitters by a unit or two still
  // registers as one peak rather than two weak ones.
  const smoothed = [...bins.entries()]
    .map(([bin, entry]) => {
      const left = bins.get(bin - 1)?.count ?? 0;
      const right = bins.get(bin + 1)?.count ?? 0;
      return { bin, weight: entry.count + left + right, count: entry.count, centroid: entry.sum / entry.count };
    })
    .filter((b) => b.weight >= minSupport)
    .sort((a, b) => b.weight - a.weight);

  // Greedily accept the strongest peaks, rejecting any that sit too close to a
  // peak already taken.
  const accepted: Array<{ x: number; weight: number }> = [];
  for (const peak of smoothed) {
    if (accepted.some((a) => Math.abs(a.x - peak.centroid) < options.minColumnGap)) continue;
    accepted.push({ x: peak.centroid, weight: peak.weight });
  }

  return accepted.map((a) => a.x).sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Cell assignment
 * ------------------------------------------------------------------ */

/** Places each item in the column whose left edge it starts at or after. */
export function assignCells(items: TextItem[], columnEdges: number[], allowSplit = false): string[] {
  const buckets: TextItem[][] = columnEdges.map(() => []);
  if (columnEdges.length === 0) return [items.map((i) => i.str).join(' ').trim()];

  for (const item of items) {
    if (!allowSplit) {
      buckets[columnOf(item.x, columnEdges)]!.push(item);
      continue;
    }
    for (const { column, piece } of splitAcrossColumns(item, columnEdges)) {
      buckets[column]!.push(piece);
    }
  }

  return buckets.map((bucket) => joinCell(bucket));
}

/** The column an x position falls in. */
function columnOf(x: number, columnEdges: number[]): number {
  let index = 0;
  for (let c = 0; c < columnEdges.length; c++) {
    if (x + COLUMN_SNAP_TOLERANCE >= columnEdges[c]!) index = c;
    else break;
  }
  return index;
}

interface PlacedPiece {
  column: number;
  piece: TextItem;
}

/**
 * Splits a text run that straddles a column boundary.
 *
 * pdf.js merges two neighbouring cells into a single run when the gutter
 * between them is narrow, which happens on real statements wherever a bank
 * packs its columns tightly. Left alone, a reference number ends up embedded in
 * the middle of the narration once the wrapped lines are folded together.
 *
 * The boundary's x position maps to an approximate character index, and the
 * true cut is always at a space — pdf.js inserts one when it merges. Snapping to
 * the nearest space makes the split exact in practice even though the character
 * index is only an estimate.
 *
 * Each piece is placed in the column whose boundary produced its cut rather
 * than by re-deriving a position: the gutter between two columns occupies real
 * width but only one space character, so any character-proportional estimate of
 * where a piece starts lands short.
 */
function splitAcrossColumns(item: TextItem, columnEdges: number[]): PlacedPiece[] {
  const startColumn = columnOf(item.x, columnEdges);
  const whole: PlacedPiece[] = [{ column: startColumn, piece: item }];

  if (item.width <= 0 || item.str.length < 2) return whole;

  const right = item.x + item.width;
  const cuts: Array<{ at: number; column: number }> = [];

  for (let c = startColumn + 1; c < columnEdges.length; c++) {
    const edge = columnEdges[c]!;
    if (edge >= right) break;

    // A run that merely fills its own column overhangs the boundary by a point
    // or two; one that has a whole extra cell welded on overhangs by that
    // cell's width. Only the latter is a merge worth undoing.
    const overhang = right - edge;
    if (overhang < MIN_MERGE_OVERHANG || overhang < item.width * MIN_MERGE_OVERHANG_RATIO) continue;

    const estimate = Math.round(((edge - item.x) / item.width) * item.str.length);
    const at = nearestSpace(item.str, estimate);
    if (at !== null && at > (cuts[cuts.length - 1]?.at ?? 0)) cuts.push({ at, column: c });
  }

  if (cuts.length === 0) return whole;

  const placed: PlacedPiece[] = [];
  const offsets = [0, ...cuts.map((c) => c.at), item.str.length];
  const columns = [startColumn, ...cuts.map((c) => c.column)];

  for (let i = 0; i < offsets.length - 1; i++) {
    const from = offsets[i]!;
    const to = offsets[i + 1]!;
    const text = item.str.slice(from, to).trim();
    if (text === '') continue;

    const column = columns[i]!;
    placed.push({
      column,
      // Anchor the piece at its column so intra-cell joining stays ordered.
      piece: {
        ...item,
        str: text,
        x: columnEdges[column]!,
        width: ((to - from) / item.str.length) * item.width,
      },
    });
  }

  return placed.length > 0 ? placed : whole;
}

/**
 * Index of the whitespace nearest `target`, or null when none is close enough.
 *
 * A run with no space near the boundary is a single long token that genuinely
 * overhangs its column — cutting it mid-token would corrupt the text, so it is
 * left whole.
 */
function nearestSpace(text: string, target: number): number | null {
  const maxDistance = Math.max(4, Math.round(text.length * 0.25));

  for (let distance = 0; distance <= maxDistance; distance++) {
    for (const index of distance === 0 ? [target] : [target - distance, target + distance]) {
      if (index <= 0 || index >= text.length) continue;
      if (/\s/.test(text[index]!)) return index;
    }
  }
  return null;
}

/**
 * Joins the runs inside one cell.
 *
 * PDF extraction splits text at arbitrary points, often mid-number, so a blind
 * `join(' ')` turns `1,23,456.78` into `1, 23,456.78`. Whitespace is inserted
 * only where the glyphs are actually far apart.
 */
function joinCell(items: TextItem[]): string {
  if (items.length === 0) return '';
  const sorted = [...items].sort((a, b) => a.x - b.x);

  let out = sorted[0]!.str;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const item = sorted[i]!;
    const gap = item.x - (prev.x + prev.width);
    const needsSpace = gap > prev.fontSize * 0.25 && !prev.str.endsWith(' ') && !item.str.startsWith(' ');
    out += needsSpace ? ` ${item.str}` : item.str;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Wrapped-narration merge
 * ------------------------------------------------------------------ */

export interface MergeSpec {
  /** Column index holding the transaction date. */
  dateColumn: number;
  /** Column indices holding money (debit, credit, amount, balance). */
  amountColumns: number[];
  /**
   * Columns a wrapped line is allowed to occupy — narration, and the reference
   * column when the bank wraps that too.
   */
  textColumns: number[];
  /** Date formats to try, from the matched template. */
  dateFormats?: readonly string[];
  /** Only rows in `[startIndex, endIndex)` participate; keeps headers and footers out. */
  startIndex?: number;
  endIndex?: number;
}

/**
 * Folds wrapped narration back into the transaction it belongs to.
 *
 * A long UPI or NEFT narration spills over two or three visual lines with empty
 * date and amount cells. Left alone these become phantom transactions or, worse,
 * push the running balance out of step. The rule: a row inside the transaction
 * band with no parseable date and no parseable amount is a continuation, and its
 * text is appended column-by-column to the row above.
 */
export function mergeWrappedRows(rows: GridRow[], spec: MergeSpec): GridRow[] {
  const start = spec.startIndex ?? 0;
  const end = spec.endIndex ?? rows.length;

  const out: GridRow[] = [];
  let lastRealIndex = -1;

  rows.forEach((row, index) => {
    const insideBand = index >= start && index < end;

    if (!insideBand || lastRealIndex === -1) {
      out.push(row);
      if (insideBand && isTransactionRow(row, spec)) lastRealIndex = out.length - 1;
      return;
    }

    if (isTransactionRow(row, spec)) {
      out.push(row);
      lastRealIndex = out.length - 1;
      return;
    }

    if (isBlank(row)) return;

    // Anything that is neither a transaction nor a wrapped line is structural —
    // a repeated header, a page banner, a totals line. Keep it as its own row so
    // the parser can skip it, and stop attaching to the transaction above.
    if (!isContinuationRow(row, spec)) {
      out.push(row);
      lastRealIndex = -1;
      return;
    }

    const target = out[lastRealIndex]!;
    const textColumns = new Set(spec.textColumns);

    out[lastRealIndex] = {
      ...target,
      // Only the text columns carry over. A continuation may also hold the
      // transaction time under the date, which is not narration and is dropped.
      cells: target.cells.map((cell, c) => {
        if (!textColumns.has(c)) return cell;
        const extra = row.cells[c]?.trim() ?? '';
        if (!extra) return cell;
        return cell ? `${cell} ${extra}` : extra;
      }),
      // The raw line structure is kept so exporters that must reproduce the
      // statement's own line breaks can do so. On the first fold the target's
      // own cells are still unmerged, which is what seeds the list.
      sourceLines: [...(target.sourceLines ?? [target.cells.map((c) => c.trim())]), row.cells.map((c) => c.trim())],
      items: [...target.items, ...row.items],
      merged: true,
    };
  });

  return out;
}

/** A real transaction row carries a date, or at least one money value. */
function isTransactionRow(row: GridRow, spec: MergeSpec): boolean {
  const hasDate = isDateLike(row.cells[spec.dateColumn], spec.dateFormats);
  const hasAmount = spec.amountColumns.some((c) => isAmountLike(row.cells[c]));
  return hasDate || hasAmount;
}

/**
 * A wrapped line only ever spills into the text columns.
 *
 * Requiring that — rather than merely "no date and no amount" — is what keeps
 * repeated page headers, "continued" banners and footer totals from being
 * swallowed into the transaction above them. Those rows put content in the date
 * column, which real wrapped narration never does, and folding one in corrupts
 * that transaction's date badly enough that the row is dropped entirely.
 */
function isContinuationRow(row: GridRow, spec: MergeSpec): boolean {
  const allowed = new Set(spec.textColumns);
  let hasText = false;

  for (let c = 0; c < row.cells.length; c++) {
    const cell = (row.cells[c] ?? '').trim();
    if (cell === '') continue;

    if (allowed.has(c)) {
      hasText = true;
      continue;
    }

    // Several banks print the transaction time on the line below its date.
    // That is part of the same transaction, not a structural row.
    if (BARE_TIME.test(cell)) continue;

    return false;
  }

  return hasText;
}

/** `14:06` or `14:06:13`, optionally with an am/pm suffix. */
const BARE_TIME = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?$/;

function isBlank(row: GridRow): boolean {
  return row.cells.every((c) => c.trim() === '');
}

/* ------------------------------------------------------------------ *
 * Debug / LLM rendering
 * ------------------------------------------------------------------ */

/**
 * Renders the grid as a markdown table.
 *
 * This is what the LLM fallback sees — never the raw PDF and never page images.
 * It keeps the prompt small and, more importantly, keeps the model's job to
 * "which column is which", not "read these numbers".
 */
export function gridToMarkdown(grid: Grid, maxRows = 60): string {
  const rows = grid.rows.slice(0, maxRows);
  const width = grid.columnCount || 1;

  const header = `| ${Array.from({ length: width }, (_, i) => `col${i}`).join(' | ')} |`;
  const divider = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  const body = rows.map((row) => {
    const cells = Array.from({ length: width }, (_, i) => escapePipes(row.cells[i] ?? ''));
    return `| ${cells.join(' | ')} |`;
  });

  return [header, divider, ...body].join('\n');
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}
