import { createHash } from 'node:crypto';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { BankTemplate } from '@/lib/banks/registry';
import { gridToMarkdown } from '@/lib/pdf/grid';
import { isAmountLike } from '@/lib/parse/parseAmount';
import { isDateLike } from '@/lib/parse/parseDate';
import { ConvertError, type Grid } from '@/lib/schema';
import type { StoredTemplate } from '@/lib/banks/learned/store';

/**
 * LLM fallback for statements no template recognises.
 *
 * The model's only job is to say *which column is which*. It never transcribes
 * a value: the mapping it returns is fed straight back into the same
 * deterministic parser every bank template uses. Language models transpose
 * digits, and in accounting software that is disqualifying.
 *
 * It is shown the reconstructed grid as a markdown table — not the PDF, not
 * page images — which keeps the payload small and the task narrow.
 *
 * Provider: Google Gemini, direct (not the Vercel AI Gateway). Swapping to a
 * different provider means changing the `model`/`google` import here — nothing
 * else in the pipeline depends on which provider answers this call.
 */

const MODEL = 'gemini-3.7-flash';

/** How many grid rows the model sees. Enough for the header plus a clear sample. */
const SAMPLE_ROWS = 45;

const ColumnIndex = z.number().int().min(0).max(63);

const MappingSchema = z.object({
  bankName: z.string().describe('The bank that issued this statement, or "Unknown bank".'),
  headerRowIndex: z
    .number()
    .int()
    .min(0)
    .describe('Zero-based index of the row in the table that holds the column headers.'),
  amountStyle: z
    .enum(['separate-dr-cr', 'signed-single', 'amount-plus-flag'])
    .describe(
      'separate-dr-cr: distinct debit and credit columns. signed-single: one amount column carrying a sign or Dr/Cr marker. amount-plus-flag: one amount column plus a separate Dr/Cr column.',
    ),
  dateFormat: z
    .string()
    .describe('Format of the transaction date, using dd, MM, MMM and yyyy/yy — for example dd/MM/yyyy or dd-MMM-yy.'),
  columns: z.object({
    date: ColumnIndex.describe('Column holding the transaction date.'),
    valueDate: ColumnIndex.nullable().describe('Column holding the value date, or null.'),
    narration: ColumnIndex.describe('Column holding the description or narration.'),
    refNo: ColumnIndex.nullable().describe('Column holding the cheque or reference number, or null.'),
    debit: ColumnIndex.nullable().describe('Debit/withdrawal column, or null when the layout is not separate-dr-cr.'),
    credit: ColumnIndex.nullable().describe('Credit/deposit column, or null when the layout is not separate-dr-cr.'),
    amount: ColumnIndex.nullable().describe('Single amount column, or null when debit and credit are separate.'),
    drCrFlag: ColumnIndex.nullable().describe('Column holding a Dr/Cr marker, or null.'),
    balance: ColumnIndex.describe('Column holding the running balance after the transaction.'),
  }),
});

export type InferredMapping = z.infer<typeof MappingSchema>;

export interface InferenceResult {
  template: BankTemplate;
  /** Row the model identified as the column header. */
  headerRowIndex: number;
  /** Layout key, so a mapping that reconciles can be stored under it. */
  fingerprint: string;
  /** The raw mapping, for converting to a storable record once it is proven. */
  mapping: InferredMapping;
  notices: string[];
}

/**
 * The words banks use to head a statement column.
 *
 * A cell only contributes to the fingerprint if it contains one of these, which
 * is what keeps customer-specific text — names, addresses, narration — out of
 * the key. Two customers at the same bank must fingerprint identically.
 */
const HEADER_WORDS = new Set([
  'amount', 'balance', 'branch', 'cheque', 'chq', 'closing', 'cr', 'credit', 'credits', 'date',
  'debit', 'debits', 'deposit', 'deposits', 'description', 'details', 'dr', 'id', 'instrument',
  'narration', 'no', 'number', 'particulars', 'ref', 'reference', 'remarks', 'running', 'serial',
  'sl', 'sr', 'tran', 'transaction', 'txn', 'type', 'utr', 'value', 'withdrawal', 'withdrawals',
]);

/** `HDFC0000123`, `IDIB000B854` — the four-letter bank code that opens an IFSC. */
const IFSC = /\b([A-Z]{4})0[A-Z0-9]{6}\b/;

/**
 * Fingerprints a statement's layout, so the same bank is recognised next time.
 *
 * Built from the issuing bank's IFSC prefix plus the shape of its table: the
 * column count and which known header words appear. The key has to be
 * computable *before* the model runs, which rules out keying on the header row
 * the model identifies — hence recognising headings by vocabulary instead.
 *
 * Rows carrying a date or an amount are skipped: those are transactions, and
 * letting their narration in would give two statements from the same account
 * different keys.
 */
export function layoutFingerprint(grid: Grid, statementText = ''): string {
  const ifsc = statementText.match(IFSC);

  const words = new Set<string>();
  for (const row of grid.rows) {
    const cells = row.cells.map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 3) continue;

    // Skip transaction rows; only headings should shape the key.
    if (cells.some((c) => isDateLike(c) || isAmountLike(c))) continue;

    for (const cell of cells) {
      if (cell.length > 32) continue;
      const tokens = cell.toLowerCase().split(/[^a-z]+/).filter(Boolean);
      if (tokens.some((t) => HEADER_WORDS.has(t))) words.add(tokens.join(' '));
    }
  }

  const signature = [ifsc?.[1] ?? 'unknown', grid.columnCount, [...words].sort().join('|')].join(':');
  return createHash('sha256').update(signature).digest('hex').slice(0, 32);
}

/**
 * Turns the model's column indices into the header labels printed above them.
 *
 * Storing labels rather than indices means a learned layout is resolved by the
 * same header matching a hand-written template uses, so it still works when a
 * later statement lays its columns out slightly differently. Returns null if the
 * header row does not actually carry a label for a required field.
 */
export function toStoredTemplate(mapping: InferredMapping, grid: Grid, key: string): StoredTemplate | null {
  const header = grid.rows[mapping.headerRowIndex];
  if (!header) return null;

  const label = (index: number | null): string | undefined => {
    if (index === null) return undefined;
    const cell = (header.cells[index] ?? '').trim();
    return cell === '' ? undefined : cell;
  };

  const { columns } = mapping;
  const date = label(columns.date);
  const narration = label(columns.narration);
  const balance = label(columns.balance);
  if (!date || !narration || !balance) return null;

  return {
    key,
    bankName: mapping.bankName,
    dateFormats: [mapping.dateFormat],
    amountStyle: mapping.amountStyle,
    columns: {
      date,
      narration,
      balance,
      ...optionalLabel('valueDate', label(columns.valueDate)),
      ...optionalLabel('refNo', label(columns.refNo)),
      ...optionalLabel('debit', label(columns.debit)),
      ...optionalLabel('credit', label(columns.credit)),
      ...optionalLabel('amount', label(columns.amount)),
      ...optionalLabel('drCrFlag', label(columns.drCrFlag)),
    },
    learnedAt: new Date().toISOString(),
    timesUsed: 1,
  };
}

function optionalLabel(field: string, value: string | undefined): Record<string, string> {
  return value ? { [field]: value } : {};
}

export async function inferColumnMapping(grid: Grid, firstPageText: string): Promise<InferenceResult> {
  const fingerprint = layoutFingerprint(grid, firstPageText);

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new ConvertError(
      'LLM_UNAVAILABLE',
      'AI-assisted mapping is not configured on this server (GOOGLE_GENERATIVE_AI_API_KEY is unset).',
    );
  }

  const table = gridToMarkdown(grid, SAMPLE_ROWS);

  let mapping: InferredMapping;
  try {
    const { object } = await generateObject({
      model: google(MODEL),
      schema: MappingSchema,
      temperature: 0,
      system:
        'You map the columns of Indian bank statement tables. You are given a table that was reconstructed from a PDF, with generic column names col0, col1, col2 and so on. ' +
        'Identify which column index holds each field. Do not transcribe or restate any values — return only column indices and the layout description. ' +
        'Indian statements are day-first. Amount columns are usually right-aligned and may be empty on rows where the opposite column is used.',
      prompt: [
        'Statement cover text (for the bank name only):',
        firstPageText.slice(0, 800),
        '',
        'Reconstructed table:',
        table,
      ].join('\n'),
    });
    mapping = object;
  } catch (err) {
    if (err instanceof ConvertError) throw err;
    throw new ConvertError(
      'LLM_UNAVAILABLE',
      'AI-assisted mapping could not be completed. Please try again, or pick your bank from the dropdown.',
    );
  }

  assertUsableMapping(mapping);

  return {
    template: toTemplate(mapping, fingerprint),
    headerRowIndex: mapping.headerRowIndex,
    fingerprint,
    mapping,
    notices: [
      `No built-in template matched, so the column mapping was inferred with AI and then parsed deterministically. Detected layout: ${mapping.bankName}.`,
    ],
  };
}

/**
 * Rejects a mapping that cannot produce a sound parse.
 *
 * Better to fail loudly than to run a parser against a mapping that is missing
 * the balance column or claims a layout it did not identify columns for.
 */
function assertUsableMapping(mapping: InferredMapping): void {
  const { columns, amountStyle } = mapping;

  const hasMovement =
    amountStyle === 'separate-dr-cr'
      ? columns.debit !== null || columns.credit !== null
      : columns.amount !== null;

  if (!hasMovement) {
    throw new ConvertError(
      'UNSUPPORTED_LAYOUT',
      'The inferred column mapping did not identify where the transaction amounts are.',
    );
  }

  if (amountStyle === 'amount-plus-flag' && columns.drCrFlag === null) {
    throw new ConvertError(
      'UNSUPPORTED_LAYOUT',
      'The layout was reported as having a separate Dr/Cr flag column, but no such column was identified.',
    );
  }
}

/** Wraps the inferred mapping in the same shape a hand-written template has. */
function toTemplate(mapping: InferredMapping, fingerprint: string): BankTemplate {
  const { columns } = mapping;
  const optional = (index: number | null) => (index === null ? undefined : index);

  return {
    id: `llm-inferred-${fingerprint.slice(0, 8)}`,
    bankName: mapping.bankName,
    detect: () => 0, // never auto-detected; only reached through the fallback
    dateFormats: [mapping.dateFormat],
    amountStyle: mapping.amountStyle,
    columns: {
      date: columns.date,
      valueDate: optional(columns.valueDate),
      narration: columns.narration,
      refNo: optional(columns.refNo),
      debit: optional(columns.debit),
      credit: optional(columns.credit),
      amount: optional(columns.amount),
      drCrFlag: optional(columns.drCrFlag),
      balance: columns.balance,
    },
    ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
  };
}

