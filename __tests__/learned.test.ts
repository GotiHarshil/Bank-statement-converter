import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTemplateStore } from '@/lib/banks/learned/memory';
import { hydrateTemplate, setTemplateStore } from '@/lib/banks/learned/hydrate';
import { LEARNED_TEMPLATE_HINT_PREFIX } from '@/lib/banks/available';
import type { StoredTemplate } from '@/lib/banks/learned/store';
import { applyTemplate } from '@/lib/parse/applyTemplate';
import { layoutFingerprint, toStoredTemplate } from '@/lib/parse/llmFallback';
import { buildGrid } from '@/lib/pdf/grid';
import { extractDocument } from '@/lib/pdf/extract';
import { validate } from '@/lib/validate/reconcile';
import type { Grid, GridRow } from '@/lib/schema';

/**
 * A bank the app has never seen is mapped once by AI and then remembered, so
 * later statements from it are parsed deterministically.
 *
 * The safety property under test is that **only a mapping the running balance
 * proves correct is ever stored**. Persisting a bad inference would let one
 * wrong guess silently mis-parse every future statement from that bank, which
 * is precisely the failure this app exists to prevent.
 */

function row(cells: string[]): GridRow {
  return { cells, y: 0, pageNumber: 1, items: [] };
}

function grid(rows: GridRow[]): Grid {
  return { rows, columnEdges: [], columnCount: rows[0]?.cells.length ?? 0 };
}

const HEADER = ['Txn Date', 'Particulars', 'Withdrawals', 'Deposits', 'Running Balance'];

/** A correct mapping for the grid below, as the model would return it. */
const MAPPING = {
  bankName: 'Zenith Cooperative Bank',
  headerRowIndex: 0,
  amountStyle: 'separate-dr-cr' as const,
  dateFormat: 'dd-MM-yyyy',
  columns: {
    date: 0,
    valueDate: null,
    narration: 1,
    refNo: null,
    debit: 2,
    credit: 3,
    amount: null,
    drCrFlag: null,
    balance: 4,
  },
};

const RECONCILING = grid([
  row(HEADER),
  row(['01-04-2025', 'OPENING PURCHASE', '1,000.00', '', '9,000.00']),
  row(['02-04-2025', 'SALARY CREDIT', '', '5,000.00', '14,000.00']),
  row(['03-04-2025', 'RENT PAYMENT', '2,500.00', '', '11,500.00']),
]);

let store: InMemoryTemplateStore;

beforeEach(() => {
  store = new InMemoryTemplateStore();
  setTemplateStore(store);
});

afterEach(() => {
  setTemplateStore(null);
  vi.restoreAllMocks();
});

describe('turning an inferred mapping into a storable record', () => {
  it('stores header labels rather than column indices', () => {
    const stored = toStoredTemplate(MAPPING, RECONCILING, 'key-1')!;

    expect(stored.columns).toMatchObject({
      date: 'Txn Date',
      narration: 'Particulars',
      debit: 'Withdrawals',
      credit: 'Deposits',
      balance: 'Running Balance',
    });
    expect(stored.bankName).toBe('Zenith Cooperative Bank');
    expect(stored.timesUsed).toBe(1);
  });

  it('refuses a mapping whose header row carries no label for a required field', () => {
    const headerless = grid([row(['', '', '', '', '']), ...RECONCILING.rows.slice(1)]);
    expect(toStoredTemplate(MAPPING, headerless, 'key-1')).toBeNull();
  });

  it('records nothing but column labels — no customer data', () => {
    const stored = toStoredTemplate(MAPPING, RECONCILING, 'key-1')!;
    const serialised = JSON.stringify(stored);

    for (const leak of ['SALARY CREDIT', 'RENT PAYMENT', '14,000.00', '2,500.00']) {
      expect(serialised, `stored record leaked ${leak}`).not.toContain(leak);
    }
  });
});

describe('reusing a learned layout', () => {
  it('parses a later statement through the ordinary template path', () => {
    const stored = toStoredTemplate(MAPPING, RECONCILING, 'key-1')!;
    const result = applyTemplate(RECONCILING, hydrateTemplate(stored), '');

    expect(result).not.toBeNull();
    expect(result!.transactions).toHaveLength(3);
    expect(result!.transactions[1]!.credit).toBe(5000);

    const report = validate(result!.transactions, {
      openingBalance: result!.meta.openingBalance,
      closingBalance: result!.meta.closingBalance,
    });
    expect(report.ok).toBe(true);
  });

  it('resolves columns even when the statement lays them out differently', () => {
    // Same bank, but an extra leading column shifts every index by one. Index
    // based storage would silently read the wrong columns here; labels do not.
    const shifted = grid([
      row(['', ...HEADER]),
      row(['', '01-04-2025', 'OPENING PURCHASE', '1,000.00', '', '9,000.00']),
      row(['', '02-04-2025', 'SALARY CREDIT', '', '5,000.00', '14,000.00']),
    ]);

    const stored = toStoredTemplate(MAPPING, RECONCILING, 'key-1')!;
    const result = applyTemplate(shifted, hydrateTemplate(stored), '');

    expect(result!.transactions).toHaveLength(2);
    expect(result!.transactions[1]!.credit).toBe(5000);
    expect(result!.transactions[1]!.balance).toBe(14000);
  });
});

describe('the store', () => {
  it('round-trips a template and lists it', async () => {
    const stored = toStoredTemplate(MAPPING, RECONCILING, 'key-1')!;

    await store.put(stored);
    expect(await store.get('key-1')).toMatchObject({ bankName: 'Zenith Cooperative Bank' });
    expect(await store.list()).toHaveLength(1);

    await store.delete('key-1');
    expect(await store.get('key-1')).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });
});

describe('fingerprinting a layout', () => {
  it('gives two statements from the same bank the same key', () => {
    const later = grid([
      row(HEADER),
      row(['05-05-2025', 'A DIFFERENT PURCHASE', '99.00', '', '8,901.00']),
      row(['06-05-2025', 'ANOTHER CREDIT', '', '1.00', '8,902.00']),
    ]);

    const text = 'ZENITH COOPERATIVE BANK  IFSC: ZCBL0001234';
    expect(layoutFingerprint(later, text)).toBe(layoutFingerprint(RECONCILING, text));
  });

  it('separates different banks', () => {
    const a = layoutFingerprint(RECONCILING, 'IFSC: ZCBL0001234');
    const b = layoutFingerprint(RECONCILING, 'IFSC: HDFC0000123');
    expect(a).not.toBe(b);
  });
});

describe('end to end through convertStatement', () => {
  const fixture = () =>
    new Uint8Array(readFileSync(join(process.cwd(), '__tests__', 'fixtures', 'hdfc-savings-v1.pdf')));

  it('learns a layout only after it reconciles, then reuses it without the model', async () => {
    const llm = await import('@/lib/parse/llmFallback');
    const { convertStatement } = await import('@/lib/convert');

    // Pretend HDFC is unknown so the statement takes the inference path, and
    // stand in for the model with a mapping that is correct for this layout.
    const registry = await import('@/lib/banks/registry');
    vi.spyOn(registry, 'detectTemplate').mockReturnValue(null);

    const doc = await extractDocument(fixture());
    const built = buildGrid(doc.pages);
    const headerRowIndex = built.rows.findIndex((r) => r.cells.some((c) => /narration/i.test(c)));

    const infer = vi.spyOn(llm, 'inferColumnMapping').mockResolvedValue({
      template: {
        id: 'stub',
        bankName: 'HDFC Bank',
        detect: () => 0,
        dateFormats: ['dd/MM/yy'],
        amountStyle: 'separate-dr-cr',
        columns: { date: 0, narration: 1, refNo: 2, valueDate: 3, debit: 4, credit: 5, balance: 6 },
      },
      headerRowIndex,
      fingerprint: layoutFingerprint(built, doc.firstPageText),
      mapping: {
        bankName: 'HDFC Bank',
        headerRowIndex,
        amountStyle: 'separate-dr-cr',
        dateFormat: 'dd/MM/yy',
        columns: {
          date: 0,
          valueDate: 3,
          narration: 1,
          refNo: 2,
          debit: 4,
          credit: 5,
          amount: null,
          drCrFlag: null,
        balance: 6,
        },
      },
      notices: [],
    });

    const first = await convertStatement(fixture(), { allowLlmFallback: true });
    expect(first.validation.ok).toBe(true);
    expect(infer).toHaveBeenCalledTimes(1);
    expect(await store.list()).toHaveLength(1);
    expect(first.notices.join(' ')).toContain('saved as');

    // Second time round the stored layout answers, and the model is not called.
    const second = await convertStatement(fixture(), { allowLlmFallback: true });
    expect(infer).toHaveBeenCalledTimes(1);
    expect(second.validation.ok).toBe(true);
    expect(second.transactions).toHaveLength(first.transactions.length);
    expect(second.notices.join(' ')).toContain('learned from an earlier statement');
  });

  it('never stores a mapping that fails to reconcile', async () => {
    const llm = await import('@/lib/parse/llmFallback');
    const { convertStatement } = await import('@/lib/convert');

    const registry = await import('@/lib/banks/registry');
    vi.spyOn(registry, 'detectTemplate').mockReturnValue(null);

    const doc = await extractDocument(fixture());
    const built = buildGrid(doc.pages);
    const headerRowIndex = built.rows.findIndex((r) => r.cells.some((c) => /narration/i.test(c)));

    // Debit and credit swapped: it parses, but the balance chain collapses.
    vi.spyOn(llm, 'inferColumnMapping').mockResolvedValue({
      template: {
        id: 'stub',
        bankName: 'HDFC Bank',
        detect: () => 0,
        dateFormats: ['dd/MM/yy'],
        amountStyle: 'separate-dr-cr',
        columns: { date: 0, narration: 1, debit: 5, credit: 4, balance: 6 },
      },
      headerRowIndex,
      fingerprint: layoutFingerprint(built, doc.firstPageText),
      mapping: {
        bankName: 'HDFC Bank',
        headerRowIndex,
        amountStyle: 'separate-dr-cr',
        dateFormat: 'dd/MM/yy',
        columns: {
          date: 0,
          valueDate: null,
          narration: 1,
          refNo: null,
          debit: 5,
          credit: 4,
          amount: null,
          drCrFlag: null,
          balance: 6,
        },
      },
      notices: [],
    });

    const result = await convertStatement(fixture(), { allowLlmFallback: true });

    // Returned for the user to review, but not remembered.
    expect(result.validation.ok).toBe(false);
    expect(await store.list()).toHaveLength(0);
    expect(result.notices.join(' ')).not.toContain('saved as');
  });

  it('evicts a stored layout that stops reconciling', async () => {
    const { convertStatement } = await import('@/lib/convert');
    const registry = await import('@/lib/banks/registry');
    vi.spyOn(registry, 'detectTemplate').mockReturnValue(null);

    const doc = await extractDocument(fixture());
    const built = buildGrid(doc.pages);

    // A layout that once worked but whose labels no longer find the columns.
    const stale: StoredTemplate = {
      key: layoutFingerprint(built, doc.firstPageText),
      bankName: 'Stale Bank',
      dateFormats: ['dd/MM/yy'],
      amountStyle: 'separate-dr-cr',
      columns: { date: 'Nope', narration: 'Missing', balance: 'Gone' },
      learnedAt: new Date().toISOString(),
      timesUsed: 4,
    };
    await store.put(stale);

    await expect(convertStatement(fixture(), { allowLlmFallback: false })).rejects.toThrow();
    expect(await store.get(stale.key)).toBeNull();
  });
});

/**
 * Selecting a learned bank from the dropdown has to actually do something.
 * Learned templates are matched automatically by layout fingerprint, entirely
 * independent of any hint — so without this, picking one from the dropdown
 * would silently do nothing whenever this particular statement's fingerprint
 * doesn't happen to match, which is a confusing gap for a real, functional
 * `<Select>` to have.
 */
describe('selecting a learned bank by hint', () => {
  const fixture = () =>
    new Uint8Array(readFileSync(join(process.cwd(), '__tests__', 'fixtures', 'hdfc-savings-v1.pdf')));

  // The real HDFC column layout, correct for the fixture used below.
  const CORRECT_HDFC: StoredTemplate = {
    key: 'hdfc-key',
    bankName: 'HDFC Bank (learned)',
    dateFormats: ['dd/MM/yy'],
    amountStyle: 'separate-dr-cr',
    columns: { date: 'Date', narration: 'Narration', refNo: 'Chq./Ref.No.', debit: 'Withdrawal Amt.', credit: 'Deposit Amt.', balance: 'Closing Balance' },
    learnedAt: new Date().toISOString(),
    timesUsed: 1,
  };

  it('uses the hinted layout directly, bypassing detection entirely', async () => {
    const { convertStatement } = await import('@/lib/convert');
    await store.put(CORRECT_HDFC);

    const result = await convertStatement(fixture(), {
      bankHint: `${LEARNED_TEMPLATE_HINT_PREFIX}hdfc-key`,
      allowLlmFallback: false,
    });

    expect(result.validation.ok).toBe(true);
    expect(result.meta.bankName).toBe('HDFC Bank (learned)');
    expect(result.notices.join(' ')).toContain('you selected');

    const updated = await store.get('hdfc-key');
    expect(updated!.timesUsed).toBe(2);
  });

  it('falls through to ordinary detection when the hinted key does not exist', async () => {
    const { convertStatement } = await import('@/lib/convert');
    // No matching learned entry in the store at all.
    const result = await convertStatement(fixture(), {
      bankHint: `${LEARNED_TEMPLATE_HINT_PREFIX}does-not-exist`,
      allowLlmFallback: false,
    });

    expect(result.validation.ok).toBe(true);
    expect(result.meta.templateId).toBe('hdfc-savings-v1');
    expect(result.notices.join(' ')).not.toContain('you selected');
  });

  it('falls through to ordinary detection when the hinted layout does not reconcile here', async () => {
    const { convertStatement } = await import('@/lib/convert');
    // Debit and credit swapped: applies, but breaks the balance chain on this statement.
    await store.put({ ...CORRECT_HDFC, key: 'wrong-hdfc', columns: { ...CORRECT_HDFC.columns, debit: 'Deposit Amt.', credit: 'Withdrawal Amt.' } });

    const result = await convertStatement(fixture(), {
      bankHint: `${LEARNED_TEMPLATE_HINT_PREFIX}wrong-hdfc`,
      allowLlmFallback: false,
    });

    // Recovers via the shipped template instead of returning the broken parse.
    expect(result.validation.ok).toBe(true);
    expect(result.meta.templateId).toBe('hdfc-savings-v1');
    expect(result.notices.join(' ')).not.toContain('you selected');
  });
});
