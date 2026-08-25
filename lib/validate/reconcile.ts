import { round2 } from '@/lib/parse/parseAmount';
import type { RowValidation, StatementMeta, Transaction, ValidationCheck, ValidationReport } from '@/lib/schema';

/**
 * The validation layer.
 *
 * The parser is never trusted. A running-balance chain that holds across every
 * row is near-conclusive evidence that each debit and credit landed in the right
 * column, that no row was dropped, and that no digit was transposed — because
 * any one of those breaks the chain immediately. When it does break, the report
 * names the exact rows rather than hiding behind a generic failure.
 */

/** Rupee tolerance. Statements are printed to the paisa, so this is generous. */
export const BALANCE_TOLERANCE = 0.01;

export function validate(
  transactions: Transaction[],
  meta: Pick<StatementMeta, 'openingBalance' | 'closingBalance' | 'statedTransactionCount'>,
): ValidationReport {
  const rows: RowValidation[] = transactions.map((t) => ({ serial: t.serial, status: 'ok', messages: [] }));
  const byIndex = new Map(transactions.map((t, i) => [t.serial, i]));

  const note = (serial: number, status: 'warning' | 'error', message: string, extra?: Partial<RowValidation>) => {
    const index = byIndex.get(serial);
    if (index === undefined) return;
    const row = rows[index]!;
    // An error is never downgraded to a warning by a later check.
    if (status === 'error' || row.status === 'ok') row.status = status;
    row.messages.push(message);
    Object.assign(row, extra);
  };

  const checks: ValidationCheck[] = [
    checkRunningBalance(transactions, meta.openingBalance, note),
    checkFooterReconciliation(transactions, meta),
    checkDateMonotonicity(transactions, note),
    checkCompleteness(transactions, meta.statedTransactionCount),
  ];

  const totalDebits = round2(transactions.reduce((sum, t) => sum + (t.debit ?? 0), 0));
  const totalCredits = round2(transactions.reduce((sum, t) => sum + (t.credit ?? 0), 0));
  const openingBalance = meta.openingBalance ?? null;
  const closingBalance = transactions.length ? transactions[transactions.length - 1]!.balance : meta.closingBalance ?? null;

  return {
    ok: checks.every((c) => c.status !== 'fail'),
    checks,
    rows,
    summary: {
      transactionCount: transactions.length,
      totalDebits,
      totalCredits,
      openingBalance,
      closingBalance,
      computedClosingBalance: openingBalance === null ? null : round2(openingBalance + totalCredits - totalDebits),
      errorRows: rows.filter((r) => r.status === 'error').length,
      warningRows: rows.filter((r) => r.status === 'warning').length,
    },
  };
}

type Note = (serial: number, status: 'warning' | 'error', message: string, extra?: Partial<RowValidation>) => void;

/**
 * The single highest-value check in the codebase.
 *
 * Every row must satisfy `balance = previousBalance - debit + credit`. A debit
 * read as a credit, a dropped row, a wrapped line merged into the wrong
 * transaction, a transposed digit — all of them break this equation, and
 * nothing else catches them as reliably.
 */
function checkRunningBalance(transactions: Transaction[], openingBalance: number | null, note: Note): ValidationCheck {
  const offending: number[] = [];

  transactions.forEach((t, i) => {
    const previous = i === 0 ? openingBalance : transactions[i - 1]!.balance;
    if (previous === null || previous === undefined) return;

    const expected = round2(previous - (t.debit ?? 0) + (t.credit ?? 0));
    const delta = round2(t.balance - expected);

    if (Math.abs(delta) > BALANCE_TOLERANCE) {
      offending.push(t.serial);
      note(
        t.serial,
        'error',
        `Running balance breaks here: expected ${formatInr(expected)} but the statement shows ${formatInr(t.balance)} (off by ${formatInr(delta)}).`,
        { expectedBalance: expected, actualBalance: t.balance, delta },
      );
    }
  });

  if (openingBalance === null) {
    return {
      id: 'running-balance',
      label: 'Running balance',
      status: offending.length ? 'fail' : 'pass',
      detail:
        offending.length === 0
          ? 'Every row follows from the one before it. The opening balance was unknown, so row 1 was not checked.'
          : `${offending.length} row(s) do not follow from the previous balance.`,
      offendingRows: offending,
    };
  }

  return {
    id: 'running-balance',
    label: 'Running balance',
    status: offending.length === 0 ? 'pass' : 'fail',
    detail:
      offending.length === 0
        ? `All ${transactions.length} rows reconcile against the opening balance of ${formatInr(openingBalance)}.`
        : `${offending.length} row(s) do not follow from the previous balance.`,
    offendingRows: offending,
  };
}

/** Opening + credits − debits must equal the closing balance. */
function checkFooterReconciliation(
  transactions: Transaction[],
  meta: Pick<StatementMeta, 'openingBalance' | 'closingBalance'>,
): ValidationCheck {
  const opening = meta.openingBalance;
  const closing = transactions.length ? transactions[transactions.length - 1]!.balance : meta.closingBalance;

  if (opening === null || opening === undefined || closing === null || closing === undefined) {
    return {
      id: 'footer-reconciliation',
      label: 'Statement totals',
      status: 'skipped',
      detail: 'The statement did not state both an opening and a closing balance.',
      offendingRows: [],
    };
  }

  const debits = round2(transactions.reduce((sum, t) => sum + (t.debit ?? 0), 0));
  const credits = round2(transactions.reduce((sum, t) => sum + (t.credit ?? 0), 0));
  const computed = round2(opening + credits - debits);
  const delta = round2(computed - closing);

  return {
    id: 'footer-reconciliation',
    label: 'Statement totals',
    status: Math.abs(delta) <= BALANCE_TOLERANCE ? 'pass' : 'fail',
    detail:
      Math.abs(delta) <= BALANCE_TOLERANCE
        ? `${formatInr(opening)} + ${formatInr(credits)} credits − ${formatInr(debits)} debits = ${formatInr(closing)}.`
        : `Totals are off by ${formatInr(delta)}: opening ${formatInr(opening)} plus ${formatInr(credits)} credits minus ${formatInr(debits)} debits gives ${formatInr(computed)}, but the closing balance is ${formatInr(closing)}.`,
    offendingRows: [],
  };
}

/**
 * Dates must not go backwards.
 *
 * A violation almost always means a wrapped narration line was treated as its
 * own transaction, or two rows were merged — so this is really a second opinion
 * on the row-merging logic.
 */
function checkDateMonotonicity(transactions: Transaction[], note: Note): ValidationCheck {
  const offending: number[] = [];

  for (let i = 1; i < transactions.length; i++) {
    const previous = transactions[i - 1]!;
    const current = transactions[i]!;
    if (current.date < previous.date) {
      offending.push(current.serial);
      note(
        current.serial,
        'warning',
        `Date ${current.date} is earlier than ${previous.date} on the previous row, which usually means rows were merged incorrectly.`,
      );
    }
  }

  return {
    id: 'date-monotonicity',
    label: 'Date order',
    status: offending.length === 0 ? 'pass' : 'fail',
    detail:
      offending.length === 0
        ? 'Dates run forward through the statement.'
        : `${offending.length} row(s) are dated earlier than the row above them.`,
    offendingRows: offending,
  };
}

/** Compares the parsed count against a "Total: N transactions" line, when present. */
function checkCompleteness(transactions: Transaction[], stated: number | undefined): ValidationCheck {
  if (stated === undefined) {
    return {
      id: 'completeness',
      label: 'Transaction count',
      status: 'skipped',
      detail: 'The statement did not print a transaction count to compare against.',
      offendingRows: [],
    };
  }

  const parsed = transactions.length;
  return {
    id: 'completeness',
    label: 'Transaction count',
    status: parsed === stated ? 'pass' : 'fail',
    detail:
      parsed === stated
        ? `Found all ${stated} transactions the statement says it contains.`
        : `The statement states ${stated} transactions but ${parsed} were extracted.`,
    offendingRows: [],
  };
}

/** Indian digit grouping, for messages the user actually reads. */
export function formatInr(n: number): string {
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(2);
  const dot = fixed.indexOf('.');
  const whole = fixed.slice(0, dot);
  const decimals = fixed.slice(dot + 1);

  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = `${rest.replace(/(\d)(?=(\d\d)+$)/g, '$1,')},${last3}`;
  }

  return `${negative ? '-' : ''}₹${grouped}.${decimals}`;
}
