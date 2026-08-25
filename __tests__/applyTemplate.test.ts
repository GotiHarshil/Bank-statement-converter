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
