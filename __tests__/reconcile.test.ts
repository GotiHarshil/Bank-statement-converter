import { describe, expect, it } from 'vitest';
import { validate } from '@/lib/validate/reconcile';
import type { Transaction } from '@/lib/schema';

/**
 * The validator is the product's real guarantee, so these tests corrupt a
 * known-good ledger in the specific ways a parser fails and assert that each
 * corruption is caught and localised.
 */

function txn(partial: Partial<Transaction> & Pick<Transaction, 'serial' | 'date' | 'balance'>): Transaction {
  return {
    narration: 'TEST',
    debit: null,
    credit: null,
    confidence: 'high',
    issues: [],
    ...partial,
  };
}

/** Opening 1,00,000 → three movements → closing 1,08,500. */
const OPENING = 100_000;
const LEDGER: Transaction[] = [
  txn({ serial: 1, date: '2024-04-01', credit: 25_000, balance: 125_000 }),
  txn({ serial: 2, date: '2024-04-03', debit: 12_000, balance: 113_000 }),
  txn({ serial: 3, date: '2024-04-07', debit: 4_500, balance: 108_500 }),
];

const META = { openingBalance: OPENING, closingBalance: 108_500, statedTransactionCount: 3 };

describe('a correct ledger', () => {
  it('passes every check', () => {
    const report = validate(LEDGER, META);

    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.status !== 'fail')).toBe(true);
    expect(report.summary.errorRows).toBe(0);
    expect(report.summary.totalDebits).toBe(16_500);
    expect(report.summary.totalCredits).toBe(25_000);
    expect(report.summary.computedClosingBalance).toBe(108_500);
  });
});

describe('a swapped debit and credit', () => {
  it('is caught, and the exact row is named', () => {
    // The single most dangerous parser failure: the amount is right, the column
    // is wrong. Nothing about the row looks unusual in isolation.
    const corrupted = LEDGER.map((t) =>
      t.serial === 2 ? { ...t, debit: null, credit: 12_000 } : t,
    );

    const report = validate(corrupted, META);

    expect(report.ok).toBe(false);

    const runningBalance = report.checks.find((c) => c.id === 'running-balance');
    expect(runningBalance?.status).toBe('fail');
    expect(runningBalance?.offendingRows).toContain(2);

    const row = report.rows.find((r) => r.serial === 2);
    expect(row?.status).toBe('error');
    expect(row?.expectedBalance).toBe(137_000);
    expect(row?.actualBalance).toBe(113_000);
    expect(row?.delta).toBe(-24_000);
    expect(row?.messages.join(' ')).toMatch(/running balance breaks/i);
  });

  it('also fails the footer reconciliation', () => {
    const corrupted = LEDGER.map((t) => (t.serial === 2 ? { ...t, debit: null, credit: 12_000 } : t));
    const report = validate(corrupted, META);

    expect(report.checks.find((c) => c.id === 'footer-reconciliation')?.status).toBe('fail');
  });
});

describe('a dropped row', () => {
  it('breaks the chain at the row after the gap', () => {
    const report = validate(
      LEDGER.filter((t) => t.serial !== 2),
      META,
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'running-balance')?.offendingRows).toContain(3);
    expect(report.checks.find((c) => c.id === 'completeness')?.status).toBe('fail');
    expect(report.checks.find((c) => c.id === 'completeness')?.detail).toMatch(/states 3 transactions but 2/i);
  });
});

describe('a transposed digit', () => {
  it('is caught even though the amount still looks plausible', () => {
    const corrupted = LEDGER.map((t) => (t.serial === 3 ? { ...t, debit: 4_050 } : t));
    const report = validate(corrupted, META);

    expect(report.ok).toBe(false);
    expect(report.rows.find((r) => r.serial === 3)?.delta).toBe(-450);
  });
});

describe('tolerance', () => {
  it('accepts rounding within one paisa', () => {
    const nudged = LEDGER.map((t) => (t.serial === 2 ? { ...t, balance: 113_000.01 } : t));
    // Row 3 must be re-based on the nudged balance or it would break instead.
    nudged[2] = { ...nudged[2]!, balance: 108_500.01 };

    expect(validate(nudged, { ...META, closingBalance: 108_500.01 }).ok).toBe(true);
  });

  it('rejects a two-paisa discrepancy', () => {
    const nudged = LEDGER.map((t) => (t.serial === 2 ? { ...t, balance: 113_000.02 } : t));
    expect(validate(nudged, META).ok).toBe(false);
  });
});

describe('date monotonicity', () => {
  it('flags a row dated before the one above it', () => {
    const corrupted = LEDGER.map((t) => (t.serial === 3 ? { ...t, date: '2024-04-02' } : t));
    const report = validate(corrupted, META);

    const check = report.checks.find((c) => c.id === 'date-monotonicity');
    expect(check?.status).toBe('fail');
    expect(check?.offendingRows).toContain(3);
    expect(report.rows.find((r) => r.serial === 3)?.status).toBe('warning');
  });
});

describe('unknown opening balance', () => {
  it('skips row 1 rather than inventing a comparison', () => {
    const report = validate(LEDGER, { ...META, openingBalance: null });

    expect(report.checks.find((c) => c.id === 'running-balance')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'footer-reconciliation')?.status).toBe('skipped');
    expect(report.summary.computedClosingBalance).toBeNull();
  });

  it('still catches a break between later rows', () => {
    const corrupted = LEDGER.map((t) => (t.serial === 3 ? { ...t, balance: 999 } : t));
    const report = validate(corrupted, { ...META, openingBalance: null });

    expect(report.checks.find((c) => c.id === 'running-balance')?.offendingRows).toEqual([3]);
  });
});
