import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertStatement } from '@/lib/convert';
import { FIXTURE_SPECS } from '@/scripts/lib/fixture-specs'; 

/**
 * One end-to-end test per shipped bank template.
 *
 * Each fixture PDF is generated from a synthetic ledger (never real customer
 * data), and the golden file *is* that ledger. So this compares the parser
 * against an independent oracle rather than against a snapshot of its own
 * previous output — if the parser drifts, these fail.
 */

interface GoldenTransaction {
  date: string;
  valueDate: string;
  narration: string;
  refNo: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

interface Golden {
  bankName: string;
  templateId: string;
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  transactions: GoldenTransaction[];
}

function loadGolden(id: string): Golden {
  return JSON.parse(readFileSync(join(process.cwd(), '__tests__', 'golden', `${id}.json`), 'utf8')) as Golden;
}

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), '__tests__', 'fixtures', `${name}.pdf`)));
}

/**
 * Narration is compared without whitespace.
 *
 * A statement wraps narration across lines, and the wrap point is a rendering
 * detail — but every character must survive the merge, so dropped or duplicated
 * text still fails.
 */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

describe.each(FIXTURE_SPECS.map((spec) => [spec.id, spec.bankName] as const))(
  '%s (%s)',
  (id, bankName) => {
    const golden = loadGolden(id);

    it('parses every transaction exactly as the source ledger', async () => {
      const result = await convertStatement(loadFixture(id));

      expect(result.meta.bankName).toBe(bankName);
      expect(result.meta.templateId).toBe(id);
      expect(result.meta.parsedBy).toBe('template');
      expect(result.transactions).toHaveLength(golden.transactions.length);

      result.transactions.forEach((actual, i) => {
        const expected = golden.transactions[i]!;
        const where = `${id} row ${i + 1}`;

        expect(actual.date, `${where} date`).toBe(expected.date);
        expect(actual.debit, `${where} debit`).toBe(expected.debit);
        expect(actual.credit, `${where} credit`).toBe(expected.credit);
        expect(actual.balance, `${where} balance`).toBe(expected.balance);

        // Value date is only asserted where the bank prints one.
        if (actual.valueDate !== undefined) {
          expect(actual.valueDate, `${where} value date`).toBe(expected.valueDate);
        }

        if (actual.refNo !== undefined) {
          expect(actual.refNo, `${where} ref`).toBe(expected.refNo);
          expect(squash(actual.narration), `${where} narration`).toBe(squash(expected.narration));
        } else {
          // The bank packs narration and reference so tightly that pdf.js merges
          // them into one text run on enough rows that no gutter survives, so the
          // reference cannot be separated out. It must still be present, and
          // removing it must leave the narration exactly intact — nothing lost,
          // nothing duplicated.
          const narration = squash(actual.narration);
          expect(narration, `${where} ref folded into narration`).toContain(expected.refNo);
          expect(narration.replace(expected.refNo, ''), `${where} narration`).toBe(squash(expected.narration));
        }
      });
    });

    it('reconciles', async () => {
      const result = await convertStatement(loadFixture(id));

      expect(result.meta.openingBalance).toBe(golden.openingBalance);
      expect(result.meta.closingBalance).toBe(golden.closingBalance);
      expect(result.validation.summary.totalDebits).toBe(golden.totalDebits);
      expect(result.validation.summary.totalCredits).toBe(golden.totalCredits);

      for (const check of result.validation.checks) {
        expect(check.status, `${id} ${check.id}: ${check.detail}`).not.toBe('fail');
      }
      expect(result.validation.ok).toBe(true);
      expect(result.validation.summary.errorRows).toBe(0);
    });
  },
);

describe('bank detection', () => {
  it('identifies each bank without a hint', async () => {
    for (const spec of FIXTURE_SPECS) {
      const result = await convertStatement(loadFixture(spec.id));
      expect(result.meta.templateId, `${spec.id} was detected as ${result.meta.templateId}`).toBe(spec.id);
    }
  });
});
