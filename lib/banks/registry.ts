/**
 * Bank template registry.
 *
 * Adding a bank means adding one file under `templates/` and listing it here.
 * Nothing in the parsing, validation or export layers changes.
 */

export type AmountStyle =
  /** Separate Debit and Credit columns — the common Indian layout. */
  | 'separate-dr-cr'
  /** One amount column carrying its own sign or a Dr/Cr marker. */
  | 'signed-single'
  /** One amount column plus a separate Dr/Cr flag column. */
  | 'amount-plus-flag';

/**
 * How to find a column.
 *
 * A number is a literal index into the reconstructed grid. A string or RegExp
 * is matched against the header row, which is what templates should normally
 * use: header text survives layout drift, and it still resolves when pdf.js
 * welds two narrow columns into one run.
 */
export type ColumnLocator = number | string | RegExp;

export interface TemplateColumns {
  date: ColumnLocator;
  valueDate?: ColumnLocator;
  narration: ColumnLocator;
  refNo?: ColumnLocator;
  debit?: ColumnLocator;
  credit?: ColumnLocator;
  /** Used when the bank prints one amount column instead of debit/credit. */
  amount?: ColumnLocator;
  /** The Dr/Cr marker column that accompanies `amount`. */
  drCrFlag?: ColumnLocator;
  balance: ColumnLocator;
}

export interface BankTemplate {
  /** Stable identifier, e.g. `hdfc-savings-v1`. */
  id: string;
  bankName: string;
  /** Confidence from 0 to 1 that this template describes the given statement. */
  detect: (firstPageText: string) => number;
  /** Date formats this bank prints, most likely first. */
  dateFormats: string[];
  amountStyle: AmountStyle;
  columns: TemplateColumns;
  /**
   * Rows whose narration matches are carried lines, not transactions — the
   * "balance brought forward" line, page subtotals, and similar.
   */
  ignoreRow?: RegExp;
}

/**
 * Scores a statement against a list of marker patterns.
 *
 * Weighted so a strong, bank-unique signal (an IFSC prefix) counts for more
 * than a bank's name appearing somewhere on the page — a statement can mention
 * another bank in a NEFT narration.
 */
export function scoreMarkers(text: string, markers: Array<{ pattern: RegExp; weight: number }>): number {
  let score = 0;
  for (const marker of markers) {
    if (marker.pattern.test(text)) score += marker.weight;
  }
  return Math.min(1, score);
}

import { hdfcSavingsV1 } from './templates/hdfc';
import { sbiSavingsV1 } from './templates/sbi';
import { iciciSavingsV1 } from './templates/icici';
import { axisSavingsV1 } from './templates/axis';
import { kotakSavingsV1 } from './templates/kotak';
import { pnbSavingsV1 } from './templates/pnb';
import { bobSavingsV1 } from './templates/bob';
import { canaraSavingsV1 } from './templates/canara';
import { unionSavingsV1 } from './templates/union';
import { idfcFirstSavingsV1 } from './templates/idfc-first';

export const BANK_TEMPLATES: BankTemplate[] = [
  hdfcSavingsV1,
  sbiSavingsV1,
  iciciSavingsV1,
  axisSavingsV1,
  kotakSavingsV1,
  pnbSavingsV1,
  bobSavingsV1,
  canaraSavingsV1,
  unionSavingsV1,
  idfcFirstSavingsV1,
];

/** Below this, no template is trusted and the LLM fallback takes over. */
export const DETECTION_THRESHOLD = 0.7;

export interface DetectionResult {
  template: BankTemplate;
  confidence: number;
}

/** Runs every `detect()` and returns the candidates, strongest first. */
export function detectTemplates(firstPageText: string): DetectionResult[] {
  return BANK_TEMPLATES.map((template) => ({ template, confidence: clamp(template.detect(firstPageText)) }))
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

/** The winning template, or `null` when nothing clears the threshold. */
export function detectTemplate(firstPageText: string, hintId?: string): DetectionResult | null {
  const ranked = detectTemplates(firstPageText);

  // An explicit hint from the user wins whenever that template is plausible at
  // all — they know which bank the statement came from.
  if (hintId) {
    const hinted = ranked.find((r) => r.template.id === hintId) ?? findById(hintId);
    if (hinted) return { template: hinted.template, confidence: Math.max(hinted.confidence, DETECTION_THRESHOLD) };
  }

  const best = ranked[0];
  return best && best.confidence >= DETECTION_THRESHOLD ? best : null;
}

export function findById(id: string): DetectionResult | null {
  const template = BANK_TEMPLATES.find((t) => t.id === id);
  return template ? { template, confidence: 0 } : null;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
