import { describe, expect, it } from 'vitest';
import type { BankTemplate } from '@/lib/banks/registry';
import { applyTemplate } from '@/lib/parse/applyTemplate';
import type { Grid, GridRow } from '@/lib/schema';

/**
 * `applyTemplate` is where a converter most often goes quietly wrong, so these
 * tests exercise the debit/credit resolution directly rather than only through
 * a full PDF fixture — the "0.00 in the unused column" case here was found by
 * running a real customer statement through the app, not invented in advance.
 */

function row(cells: string[]): GridRow {
  return { cells, y: 0, pageNumber: 1, items: [] };
}

function grid(rows: GridRow[]): Grid {
  return { rows, columnEdges: [], columnCount: rows[0]?.cells.length ?? 0 };
}

const HEADER = ['Date', 'Description', 'Debit', 'Credit', 'Balance'];

const TEMPLATE: BankTemplate = {
  id: 'test-bank-v1',
  bankName: 'Test Bank',
  detect: () => 1,
  dateFormats: ['dd-MM-yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /^date$/i,
    narration: /description/i,
    debit: /^debit$/i,
    credit: /^credit$/i,
    balance: /balance/i,
  },
};

describe('separate-dr-cr — a bank that prints 0.00 in the unused column', () => {
  it('reads a deposit as a credit, not an ambiguous debit, when the debit column is literally "0.00"', () => {
    // This is the exact shape of a real Canara Bank statement row: both amount
    // cells are non-empty, but only one carries a genuine, non-zero movement.
    // Treating "0.00" as "a value present" here silently recorded every deposit
    // as a zero-rupee debit — the precise failure this project exists to catch.
    const result = applyTemplate(
      grid([row(HEADER), row(['01-04-2025', 'CASH DEPOSIT', '0.00', '5,000.00', '5,000.00'])]),
      TEMPLATE,
      '',
    );

    expect(result).not.toBeNull();
    const txn = result!.transactions[0]!;
    expect(txn.debit).toBeNull();
    expect(txn.credit).toBe(5000);
    expect(txn.issues).toEqual([]);
    expect(txn.confidence).toBe('high');
  });

  it('reads a withdrawal as a debit, not an ambiguous credit, when the credit column is literally "0.00"', () => {
    const result = applyTemplate(
      grid([row(HEADER), row(['01-04-2025', 'CHQ BK ISSUE', '148.00', '0.00', '4,852.00'])]),
      TEMPLATE,
      '',
    );

    const txn = result!.transactions[0]!;
    expect(txn.debit).toBe(148);
    expect(txn.credit).toBeNull();
    expect(txn.issues).toEqual([]);
  });

  it('skips a row where both sides are genuinely zero rather than inventing a transaction', () => {
    const result = applyTemplate(
      grid([
        row(HEADER),
        row(['01-04-2025', 'ZERO ROW', '0.00', '0.00', '1,000.00']),
        row(['02-04-2025', 'REAL TXN', '', '500.00', '1,500.00']),
      ]),
      TEMPLATE,
      '',
    );

    expect(result!.transactions).toHaveLength(1);
    expect(result!.transactions[0]!.narration).toBe('REAL TXN');
  });

  it('still flags true ambiguity — both sides genuinely non-zero — as an issue', () => {
    const result = applyTemplate(
      grid([row(HEADER), row(['01-04-2025', 'BROKEN ROW', '100.00', '200.00', '900.00'])]),
      TEMPLATE,
      '',
    );

    const txn = result!.transactions[0]!;
    expect(txn.debit).toBe(100);
    expect(txn.credit).toBeNull();
    expect(txn.issues.join(' ')).toMatch(/both the debit and credit/i);
    expect(txn.confidence).toBe('low');
  });

  it('still reads a normal row where only one column is populated', () => {
    const result = applyTemplate(
      grid([row(HEADER), row(['01-04-2025', 'NORMAL', '', '250.00', '1,250.00'])]),
      TEMPLATE,
      '',
    );

    const txn = result!.transactions[0]!;
    expect(txn.debit).toBeNull();
    expect(txn.credit).toBe(250);
  });
});

/**
 * A cash-credit or overdraft account carries a DR (debit) balance: the customer
 * owes the bank, so a withdrawal *increases* the balance owed. Statements mark
 * this with a `DR` suffix, which the parser turns into a negative balance — and
 * the ordinary running-balance formula then reconciles unchanged.
 *
 * Every shipped fixture is an asset account that opens and stays positive, so
 * without this the negative-balance path had no coverage at all.
 */
describe('cash-credit accounts with DR balances', () => {
  it('reads DR balances as negative and reconciles a rising overdraft', () => {
    const result = applyTemplate(
      grid([
        row(HEADER),
        row(['01-08-2026', 'TRANSFER TO KHATUPATI', 'INR 203,924.00', '', 'INR 3,013,368.96 DR']),
        row(['01-08-2026', 'IMPS COMMISSION CHARGES', 'INR 18.00', '', 'INR 3,013,386.96 DR']),
        row(['02-08-2026', 'TRANSFER FROM DIVINE SYNT', '', 'INR 175,571.00', 'INR 2,837,815.96 DR']),
      ]),
      TEMPLATE,
      '',
    );

    const txns = result!.transactions;
    expect(txns).toHaveLength(3);

    // Balances are negative: money owed on the facility, not held in it.
    expect(txns.map((t) => t.balance)).toEqual([-3013368.96, -3013386.96, -2837815.96]);

    // A debit makes the overdraft deeper; a credit pays it down.
    expect(txns[1]!.debit).toBe(18);
    expect(txns[2]!.credit).toBe(175571);

    // Reversing row 1 out of its own balance gives the printed opening balance.
    expect(result!.meta.openingBalance).toBe(-2809444.96);
  });

  it('reconciles the whole chain under the ordinary running-balance rule', async () => {
    const { validate } = await import('@/lib/validate/reconcile');

    const result = applyTemplate(
      grid([
        row(HEADER),
        row(['01-08-2026', 'A', 'INR 203,924.00', '', 'INR 3,013,368.96 DR']),
        row(['01-08-2026', 'B', 'INR 18.00', '', 'INR 3,013,386.96 DR']),
        row(['02-08-2026', 'C', '', 'INR 175,571.00', 'INR 2,837,815.96 DR']),
      ]),
      TEMPLATE,
      '',
    );

    const report = validate(result!.transactions, {
      openingBalance: result!.meta.openingBalance,
      closingBalance: result!.meta.closingBalance,
    });

    expect(report.ok).toBe(true);
    expect(report.summary.errorRows).toBe(0);
  });
});

/**
 * Some banks — IndusInd's internet-banking export is one — print the most
 * recent transaction first. Comparing each row against the one printed above
 * it then breaks on every single row, with deltas that look nothing like a
 * clean sign flip — easy to misread as a misassigned debit/credit column when
 * every row in the review table is red. The fix reorders a statement whose
 * dates are strictly non-increasing back to chronological order before
 * validation ever runs.
 */
describe('a statement printed newest-first', () => {
  it('is reordered so the running balance reconciles', async () => {
    const { validate } = await import('@/lib/validate/reconcile');

    // The same three transactions as the "0.00 in the unused column" fixture
    // above, printed in reverse — newest first, oldest last.
    const result = applyTemplate(
      grid([
        row(HEADER),
        row(['03-04-2025', 'THIRD, NEWEST', '', '250.00', '1,250.00']),
        row(['02-04-2025', 'SECOND', '100.00', '', '1,000.00']),
        row(['01-04-2025', 'FIRST, OLDEST', '', '500.00', '1,100.00']),
      ]),
      TEMPLATE,
      '',
    );

    const txns = result!.transactions;
    expect(txns.map((t) => t.date)).toEqual(['2025-04-01', '2025-04-02', '2025-04-03']);
    expect(txns.map((t) => t.serial)).toEqual([1, 2, 3]);
    expect(txns.map((t) => t.narration)).toEqual(['FIRST, OLDEST', 'SECOND', 'THIRD, NEWEST']);

    expect(result!.notices.join(' ')).toContain('newest-first');
    expect(result!.meta.openingBalance).toBe(600); // 1,100 - 500 reversed out of the first transaction

    const report = validate(txns, {
      openingBalance: result!.meta.openingBalance,
      closingBalance: result!.meta.closingBalance,
    });
    expect(report.ok).toBe(true);
    expect(report.summary.errorRows).toBe(0);
  });

  it('leaves a genuinely scrambled order untouched', () => {
    // Ascending, then a drop, then ascending again: not a clean reversal, so
    // reordering would just hide whatever actually went wrong upstream.
    const result = applyTemplate(
      grid([
        row(HEADER),
        row(['01-04-2025', 'A', '', '100.00', '100.00']),
        row(['05-04-2025', 'B', '', '50.00', '150.00']),
        row(['03-04-2025', 'C', '', '25.00', '175.00']),
      ]),
      TEMPLATE,
      '',
    );

    expect(result!.transactions.map((t) => t.date)).toEqual(['2025-04-01', '2025-04-05', '2025-04-03']);
    expect(result!.notices.join(' ')).not.toContain('newest-first');
  });

  it('does not touch a statement with only one date, or already ascending', () => {
    const sameDay = applyTemplate(
      grid([
        row(HEADER),
        row(['01-04-2025', 'A', '', '100.00', '100.00']),
        row(['01-04-2025', 'B', '', '50.00', '150.00']),
      ]),
      TEMPLATE,
      '',
    );
    expect(sameDay!.notices.join(' ')).not.toContain('newest-first');

    const ascending = applyTemplate(
      grid([
        row(HEADER),
        row(['01-04-2025', 'A', '', '100.00', '100.00']),
        row(['02-04-2025', 'B', '', '50.00', '150.00']),
      ]),
      TEMPLATE,
      '',
    );
    expect(ascending!.notices.join(' ')).not.toContain('newest-first');
  });
});
