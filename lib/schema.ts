import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Positioned text — the output of PDF extraction
 * ------------------------------------------------------------------ */

/** A single run of text with its position on the page, in PDF user units. */
export interface TextItem {
  str: string;
  /** Left edge, origin top-left (y already flipped from PDF's bottom-left origin). */
  x: number;
  /** Top edge, increasing downwards. */
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface PageText {
  pageNumber: number;
  width: number;
  height: number;
  items: TextItem[];
}

export interface ExtractedDocument {
  pages: PageText[];
  numPages: number;
  /** Concatenated text of page 1, used for template detection. */
  firstPageText: string;
}

/* ------------------------------------------------------------------ *
 * Grid — the output of row/column clustering
 * ------------------------------------------------------------------ */

/** One clustered visual line, mapped onto detected columns. */
export interface GridRow {
  /** One entry per detected column; '' when that column was empty on this row. */
  cells: string[];
  /** Vertical centre of the row, for debugging and ordering. */
  y: number;
  pageNumber: number;
  /** The positioned items that produced this row, kept for the LLM fallback. */
  items: TextItem[];
  /** True when this row was folded into the previous one as wrapped narration. */
  merged?: boolean;
  /**
   * The cells of every printed line that makes up this row — the row's own
   * line first, then each wrapped line folded into it.
   *
   * Kept so an exporter can reproduce the statement's own line breaks instead
   * of the space-joined narration. Absent when the row never wrapped.
   */
  sourceLines?: string[][];
}

export interface Grid {
  rows: GridRow[];
  /** Left edge x of each detected column. */
  columnEdges: number[];
  columnCount: number;
}

/* ------------------------------------------------------------------ *
 * Normalized transaction
 * ------------------------------------------------------------------ */

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const TransactionSchema = z.object({
  serial: z.number().int().nonnegative(),
  /** ISO yyyy-MM-dd */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO yyyy-MM-dd'),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  narration: z.string(),
  /**
   * The narration exactly as the statement laid it out, one entry per printed
   * line. Some accounting imports require the original line breaks.
   */
  narrationLines: z.array(z.string()).optional(),
  refNo: z.string().optional(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  balance: z.number(),
  confidence: ConfidenceSchema,
  issues: z.array(z.string()),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const StatementMetaSchema = z.object({
  bankName: z.string(),
  templateId: z.string(),
  /** Already masked — only the last 4 digits survive extraction. */
  accountNumberMasked: z.string().optional(),
  accountName: z.string().optional(),
  periodFrom: z.string().optional(),
  periodTo: z.string().optional(),
  openingBalance: z.number().nullable(),
  closingBalance: z.number().nullable(),
  /** 'template' when a bank template matched, 'llm' when column mapping was inferred. */
  parsedBy: z.enum(['template', 'llm']),
  pageCount: z.number().int().positive(),
  /** Stated transaction count, when the PDF prints one. */
  statedTransactionCount: z.number().int().nonnegative().optional(),
});
export type StatementMeta = z.infer<typeof StatementMetaSchema>;

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type RowStatus = 'ok' | 'warning' | 'error';

export interface RowValidation {
  serial: number;
  status: RowStatus;
  messages: string[];
  /** balance[i-1] - debit + credit, when it could be computed. */
  expectedBalance?: number;
  actualBalance?: number;
  delta?: number;
}

export interface ValidationCheck {
  id: 'running-balance' | 'footer-reconciliation' | 'date-monotonicity' | 'completeness';
  label: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
  /** Serial numbers of the rows that broke this check. */
  offendingRows: number[];
}

export interface ValidationReport {
  ok: boolean;
  checks: ValidationCheck[];
  rows: RowValidation[];
  summary: {
    transactionCount: number;
    totalDebits: number;
    totalCredits: number;
    openingBalance: number | null;
    closingBalance: number | null;
    /** openingBalance + credits - debits, for display next to closingBalance. */
    computedClosingBalance: number | null;
    errorRows: number;
    warningRows: number;
  };
}

/* ------------------------------------------------------------------ *
 * API contract
 * ------------------------------------------------------------------ */

export const CONVERT_ERROR_CODES = [
  'PASSWORD_REQUIRED',
  'PASSWORD_INCORRECT',
  'SCANNED_PDF_UNSUPPORTED',
  'NOT_A_PDF',
  'FILE_TOO_LARGE',
  'NO_TRANSACTIONS_FOUND',
  'UNSUPPORTED_LAYOUT',
  'LLM_CONSENT_REQUIRED',
  'LLM_UNAVAILABLE',
  'RATE_LIMITED',
  'PARSE_FAILED',
] as const;
export type ConvertErrorCode = (typeof CONVERT_ERROR_CODES)[number];

export interface ConvertErrorBody {
  ok: false;
  code: ConvertErrorCode;
  message: string;
}

export interface ConvertSuccessBody {
  ok: true;
  transactions: Transaction[];
  meta: StatementMeta;
  validation: ValidationReport;
  /** Non-fatal notes worth showing the user (e.g. "fell back to LLM mapping"). */
  notices: string[];
}

export type ConvertResponse = ConvertSuccessBody | ConvertErrorBody;

export class ConvertError extends Error {
  constructor(
    readonly code: ConvertErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConvertError';
  }
}
