import type { BankTemplate, ColumnLocator } from '@/lib/banks/registry';
import { mergeWrappedRows } from '@/lib/pdf/grid';
import { parseAmountDetailed, parseDrCrFlag, round2, type DrCr } from '@/lib/parse/parseAmount';
import { parseDate } from '@/lib/parse/parseDate';
import type { Confidence, Grid, GridRow, StatementMeta, Transaction } from '@/lib/schema';

/**
 * Turns a reconstructed grid into normalized transactions using a bank template.
 *
 * The template says *where* each field lives; every value is still read by the
 * deterministic parsers in this directory. Nothing here guesses at a number.
 */

export interface ApplyResult {
  transactions: Transaction[];
  meta: Omit<StatementMeta, 'pageCount' | 'parsedBy'>;
  /** Non-fatal observations worth surfacing to the user. */
  notices: string[];
}

export type ResolvedColumns = {
  [K in keyof BankTemplate['columns']]: number | undefined;
} & { date: number; narration: number; balance: number };

/* ------------------------------------------------------------------ *
 * Column resolution
 * ------------------------------------------------------------------ */

function toRegExp(locator: Exclude<ColumnLocator, number>): RegExp {
  return locator instanceof RegExp ? locator : new RegExp(locator, 'i');
}

/**
 * Finds the row that carries the column headers.
 *
 * Scored rather than pattern-matched on a single label, because statements
 * repeat words like "Date" in the account summary above the table. The header
 * row is the one where the *most* of the template's column patterns hit at once.
 */
export function findHeaderRow(grid: Grid, template: BankTemplate): number {
  const locators = Object.values(template.columns).filter((l): l is Exclude<ColumnLocator, number> => typeof l !== 'number');
  if (locators.length === 0) return -1;

  let bestIndex = -1;
  let bestScore = 1; // a single stray match is not a header row

  grid.rows.forEach((row, index) => {
    let score = 0;
    for (const locator of locators) {
      const pattern = toRegExp(locator);
      if (row.cells.some((cell) => cell.trim() !== '' && pattern.test(cell.trim()))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function locateColumn(locator: ColumnLocator | undefined, header: GridRow | undefined, columnCount: number): number | undefined {
  if (locator === undefined) return undefined;
  if (typeof locator === 'number') return locator >= 0 && locator < columnCount ? locator : undefined;
  if (!header) return undefined;

  const pattern = toRegExp(locator);
  const index = header.cells.findIndex((cell) => cell.trim() !== '' && pattern.test(cell.trim()));
  return index === -1 ? undefined : index;
}

export function resolveColumns(grid: Grid, template: BankTemplate, headerIndex: number): ResolvedColumns | null {
  const header = headerIndex >= 0 ? grid.rows[headerIndex] : undefined;
  const at = (l: ColumnLocator | undefined) => locateColumn(l, header, grid.columnCount);

  const date = at(template.columns.date);
  const narration = at(template.columns.narration);
  const balance = at(template.columns.balance);

  if (date === undefined || narration === undefined || balance === undefined) return null;

  const refNo = at(template.columns.refNo);

  return {
    date,
    narration,
    balance,
    valueDate: at(template.columns.valueDate),
    // When pdf.js welds narration and reference into one run they resolve to the
    // same column. Dropping the reference is right: the text is still in the
    // narration, and splitting it here would be guesswork.
    refNo: refNo === narration ? undefined : refNo,
    debit: at(template.columns.debit),
    credit: at(template.columns.credit),
    amount: at(template.columns.amount),
    drCrFlag: at(template.columns.drCrFlag),
  };
}

/* ------------------------------------------------------------------ *
 * Token-tolerant cell readers
 * ------------------------------------------------------------------ */

/**
 * pdf.js merges neighbouring cells into one text run when the gutter between
 * them is narrow, so a cell may legitimately hold "1,23,456.78 MUM" or
 * "5,000.00 Dr". These readers take the token that parses and ignore the rest,
 * rather than failing the whole row.
 */
function readDate(cell: string | undefined, formats: readonly string[]): string | null {
  if (!cell) return null;
  const whole = parseDate(cell, formats);
  if (whole) return whole;

  // A date may span several tokens ("01 Apr 2024"), so try leading windows of
  // increasing length before falling back to single tokens.
  const tokens = cell.split(/\s+/).filter(Boolean);
  for (let length = Math.min(4, tokens.length); length >= 1; length--) {
    for (let start = 0; start + length <= tokens.length; start++) {
      const parsed = parseDate(tokens.slice(start, start + length).join(' '), formats);
      if (parsed) return parsed;
    }
  }
  return null;
}

interface CellAmount {
  magnitude: number;
  marker: DrCr | null;
  negative: boolean;
}

function readAmount(cell: string | undefined): CellAmount | null {
  if (!cell || cell.trim() === '') return null;

  const whole = parseAmountDetailed(cell);
  if (whole) return { magnitude: whole.magnitude, marker: whole.marker, negative: whole.value < 0 };

  const tokens = cell.split(/\s+/);
  for (const token of tokens) {
    const parsed = parseAmountDetailed(token);
    if (!parsed) continue;
    // A marker may sit in a neighbouring token: "5,000.00 Dr".
    const marker = parsed.marker ?? tokens.map((t) => parseDrCrFlag(t)).find((m): m is DrCr => m !== null) ?? null;
    const negative = marker === 'Dr' ? true : marker === 'Cr' ? false : parsed.value < 0;
    return { magnitude: parsed.magnitude, marker, negative };
  }
  return null;
}

function readFlag(cell: string | undefined): DrCr | null {
  if (!cell) return null;
  const whole = parseDrCrFlag(cell);
  if (whole) return whole;
  for (const token of cell.split(/\s+/)) {
    const parsed = parseDrCrFlag(token);
    if (parsed) return parsed;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

export interface ApplyOptions {
  /**
   * Header row index, when it is already known.
   *
   * The LLM fallback returns one, and its templates address columns by number,
   * which leaves nothing for `findHeaderRow` to match on.
   */
  headerRowIndex?: number;
}

export function applyTemplate(
  grid: Grid,
  template: BankTemplate,
  statementText: string,
  options: ApplyOptions = {},
): ApplyResult | null {
  const headerIndex = options.headerRowIndex ?? findHeaderRow(grid, template);
  const columns = resolveColumns(grid, template, headerIndex);
  if (!columns) return null;

  const notices: string[] = [];

  const amountColumns = [columns.debit, columns.credit, columns.amount, columns.balance].filter(
    (c): c is number => c !== undefined,
  );

  const textColumns = [columns.narration, columns.refNo].filter((c): c is number => c !== undefined);

  // Fold wrapped narration back into its transaction before reading anything.
  const merged = mergeWrappedRows(grid.rows, {
    dateColumn: columns.date,
    amountColumns,
    textColumns,
    dateFormats: template.dateFormats,
    startIndex: headerIndex + 1,
  });

  const transactions: Transaction[] = [];
  let openingBalance: number | null = null;
  let serial = 0;

  for (let i = 0; i < merged.length; i++) {
    const row = merged[i]!;
    if (i <= headerIndex) continue;

    const narration = (row.cells[columns.narration] ?? '').trim();
    const balanceCell = readAmount(row.cells[columns.balance]);

    // "Balance brought forward" carries the opening balance but is not a transaction.
    if (template.ignoreRow?.test(narration)) {
      if (balanceCell && openingBalance === null) openingBalance = signedBalance(balanceCell);
      continue;
    }

    const date = readDate(row.cells[columns.date], template.dateFormats);
    if (date === null) continue; // not a transaction row
    if (!balanceCell) continue; // every transaction line carries a running balance

    const issues: string[] = [];
    const movement = readMovement(row, columns, template, issues);
    if (!movement) continue;

    const balance = signedBalance(balanceCell);
    const valueDate = columns.valueDate === undefined ? undefined : readDate(row.cells[columns.valueDate], template.dateFormats);
    const refNo = columns.refNo === undefined ? undefined : (row.cells[columns.refNo] ?? '').trim() || undefined;

    // The narration as the statement printed it, one entry per line. Rows that
    // never wrapped have no `sourceLines`, so their single cell is the one line.
    const narrationLines = (row.sourceLines ?? [row.cells])
      .map((line) => (line[columns.narration] ?? '').trim())
      .filter((line) => line !== '');

    transactions.push({
      serial: ++serial,
      date,
      ...(valueDate ? { valueDate } : {}),
      narration: narration || '(no narration)',
      ...(narrationLines.length > 0 ? { narrationLines } : {}),
      ...(refNo ? { refNo } : {}),
      debit: movement.debit,
      credit: movement.credit,
      balance,
      confidence: confidenceFor(narration, movement, issues),
      issues,
    });
  }

  if (transactions.length === 0) return null;

  // With no explicit brought-forward line, the opening balance is implied by
  // reversing the first transaction out of its own closing balance.
  if (openingBalance === null) {
    const first = transactions[0]!;
    openingBalance = round2(first.balance + (first.debit ?? 0) - (first.credit ?? 0));
    notices.push('Opening balance inferred from the first transaction; the statement did not print a brought-forward line.');
  }

  const closingBalance = transactions[transactions.length - 1]!.balance;

  return {
    transactions,
    meta: {
      bankName: template.bankName,
      templateId: template.id,
      openingBalance,
      closingBalance,
      ...extractStatementDetails(statementText),
    },
    notices,
  };
}

interface Movement {
  debit: number | null;
  credit: number | null;
}

/**
 * Reads the debit/credit pair for a row, honouring the bank's amount style.
 *
 * This is where a converter most often goes quietly wrong, so each style is
 * handled explicitly and anything ambiguous is recorded as an issue rather than
 * being resolved by a guess.
 */
function readMovement(row: GridRow, columns: ResolvedColumns, template: BankTemplate, issues: string[]): Movement | null {
  if (template.amountStyle === 'separate-dr-cr') {
    const debit = columns.debit === undefined ? null : readAmount(row.cells[columns.debit]);
    const credit = columns.credit === undefined ? null : readAmount(row.cells[columns.credit]);

    if (debit && credit) {
      // Some banks (Canara among them) print "0.00" in the unused column
      // instead of leaving it blank. That is not genuine ambiguity — it is the
      // bank's own way of saying "nothing on this side" — so a zero on one side
      // yields to a real amount on the other without raising an issue. Only
      // when *both* sides carry a non-zero figure is this the true ambiguity
      // the issue flag exists to surface.
      if (debit.magnitude === 0 && credit.magnitude !== 0) return { debit: null, credit: credit.magnitude };
      if (credit.magnitude === 0 && debit.magnitude !== 0) return { debit: debit.magnitude, credit: null };
      if (debit.magnitude === 0 && credit.magnitude === 0) return null;

      issues.push('Both the debit and credit columns held a value; the debit was used.');
      return { debit: debit.magnitude, credit: null };
    }
    if (debit) return { debit: debit.magnitude, credit: null };
    if (credit) return { debit: null, credit: credit.magnitude };
    return null;
  }

  if (template.amountStyle === 'signed-single') {
    const amount = columns.amount === undefined ? null : readAmount(row.cells[columns.amount]);
    if (!amount) return null;
    if (amount.marker === null && !amount.negative) {
      issues.push('Amount carried no Dr/Cr marker or sign; recorded as a credit.');
    }
    return amount.negative ? { debit: amount.magnitude, credit: null } : { debit: null, credit: amount.magnitude };
  }

  // amount-plus-flag
  const amount = columns.amount === undefined ? null : readAmount(row.cells[columns.amount]);
  if (!amount) return null;

  const flag = (columns.drCrFlag === undefined ? null : readFlag(row.cells[columns.drCrFlag])) ?? amount.marker;
  if (!flag) {
    issues.push('No Dr/Cr flag found for this row; recorded as a credit.');
    return { debit: null, credit: amount.magnitude };
  }
  return flag === 'Dr' ? { debit: amount.magnitude, credit: null } : { debit: null, credit: amount.magnitude };
}

/** A balance printed with a Dr marker is an overdraft, i.e. negative. */
function signedBalance(cell: CellAmount): number {
  return cell.negative ? -cell.magnitude : cell.magnitude;
}

function confidenceFor(narration: string, movement: Movement, issues: string[]): Confidence {
  if (issues.length > 0) return 'low';
  if (narration === '' || (movement.debit === null && movement.credit === null)) return 'medium';
  return 'high';
}

/* ------------------------------------------------------------------ *
 * Statement details
 * ------------------------------------------------------------------ */

const ACCOUNT_PATTERNS = [
  /account\s*(?:no|number|#)\s*[:.\-]?\s*([0-9Xx*]{6,20})/i,
  /a\/c\s*(?:no|number)?\s*[:.\-]?\s*([0-9Xx*]{6,20})/i,
];

const PERIOD_PATTERNS = [
  /(?:period|statement)\s*(?:of\s*account\s*)?(?:from|for the period)?\s*[:\-]?\s*([0-9]{1,2}[\/\-. ][A-Za-z0-9]{2,9}[\/\-. ][0-9]{2,4})\s*(?:to|-|–|through)\s*([0-9]{1,2}[\/\-. ][A-Za-z0-9]{2,9}[\/\-. ][0-9]{2,4})/i,
  /([0-9]{1,2}[\/\-. ][A-Za-z0-9]{2,9}[\/\-. ][0-9]{2,4})\s*(?:to|–)\s*([0-9]{1,2}[\/\-. ][A-Za-z0-9]{2,9}[\/\-. ][0-9]{2,4})/i,
];

/**
 * Pulls the account number, period and stated transaction count off page 1.
 *
 * The account number is masked here, at the point of extraction, so the full
 * number never reaches the response, the client, or a log line.
 */
export function extractStatementDetails(firstPageText: string): Pick<
  StatementMeta,
  'accountNumberMasked' | 'periodFrom' | 'periodTo' | 'statedTransactionCount'
> {
  const details: ReturnType<typeof extractStatementDetails> = {};

  for (const pattern of ACCOUNT_PATTERNS) {
    const match = firstPageText.match(pattern);
    if (match?.[1]) {
      details.accountNumberMasked = maskAccountNumber(match[1]);
      break;
    }
  }

  for (const pattern of PERIOD_PATTERNS) {
    const match = firstPageText.match(pattern);
    if (match?.[1] && match[2]) {
      const from = parseDate(match[1]);
      const to = parseDate(match[2]);
      if (from && to) {
        details.periodFrom = from;
        details.periodTo = to;
        break;
      }
    }
  }

  const stated = firstPageText.match(/total\s*[:\-]?\s*(\d{1,6})\s*transactions?/i);
  if (stated?.[1]) details.statedTransactionCount = Number(stated[1]);

  return details;
}

/** Only the last four digits survive. */
export function maskAccountNumber(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 4) return trimmed;
  return `${'X'.repeat(Math.min(trimmed.length - 4, 12))}${trimmed.slice(-4)}`;
}
