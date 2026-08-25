import { createHash } from 'node:crypto';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { BankTemplate } from '@/lib/banks/registry';
import { gridToMarkdown } from '@/lib/pdf/grid';
import { ConvertError, type Grid } from '@/lib/schema';

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
 * different provider means changing the `model`/`google` import here and the
 * consent copy in components/UploadPanel.tsx — nothing else in the pipeline
 * depends on which provider answers this call.
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
  notices: string[];
}

/**
 * Inferred mappings, keyed by a fingerprint of the layout.
 *
 * A bank is inferred once and then handled deterministically forever after,
 * within the life of the process. There is no database in v1, so this cache is
 * per-instance — correctness never depends on it, only cost.
 */
const MAPPING_CACHE = new Map<string, InferredMapping>();

/** Fingerprints the layout by its header row and column count. */
export function layoutFingerprint(grid: Grid): string {
  const header = grid.rows.find((row) => row.cells.filter((c) => c.trim() !== '').length >= 3);
  const signature = `${grid.columnCount}:${(header?.cells ?? []).map((c) => c.trim().toLowerCase()).join('|')}`;
  return createHash('sha256').update(signature).digest('hex').slice(0, 32);
}

export async function inferColumnMapping(grid: Grid, firstPageText: string): Promise<InferenceResult> {
  const fingerprint = layoutFingerprint(grid);
  const cached = MAPPING_CACHE.get(fingerprint);
  if (cached) {
    return {
      template: toTemplate(cached, fingerprint),
      headerRowIndex: cached.headerRowIndex,
      notices: ['Column mapping reused from an identical layout seen earlier in this session.'],
    };
  }

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
  MAPPING_CACHE.set(fingerprint, mapping);

  return {
    template: toTemplate(mapping, fingerprint),
    headerRowIndex: mapping.headerRowIndex,
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

/** Exposed for tests. */
export function __clearMappingCache(): void {
  MAPPING_CACHE.clear();
}
