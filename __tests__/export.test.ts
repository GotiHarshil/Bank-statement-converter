import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/export/csv';
import { toXlsx } from '@/lib/export/xlsx';
import { plainAmount, toLedgerCsv } from '@/lib/export/ledger-csv';
import { suggestFilename } from '@/lib/export/types';
import type { StatementMeta, Transaction } from '@/lib/schema';

const META: StatementMeta = {
  bankName: 'HDFC Bank',
  templateId: 'hdfc-savings-v1',
  accountNumberMasked: 'XXXXXXXXXX7891',
  periodFrom: '2024-04-01',
  periodTo: '2024-06-30',
  openingBalance: 100_000,
  closingBalance: 108_500,
  parsedBy: 'template',
  pageCount: 2,
  statedTransactionCount: 2,
};

const TRANSACTIONS: Transaction[] = [
  {
    serial: 1,
    date: '2024-04-01',
    valueDate: '2024-04-01',
    narration: 'NEFT CR-SBIN0001234-VIJAY TRADERS',
    refNo: '199612792',
    debit: null,
    credit: 25_000,
    balance: 125_000,
    confidence: 'high',
    issues: [],
  },
  {
    serial: 2,
    date: '2024-04-03',
    narration: 'ATM WDL, BANDRA "WEST"',
    debit: 16_500,
    credit: null,
    balance: 108_500,
    confidence: 'low',
    issues: ['No Dr/Cr flag found for this row; recorded as a credit.'],
  },
];

describe('CSV export', () => {
  const csv = toCsv(TRANSACTIONS, META);
  const lines = csv.trimEnd().split('\r\n');

  it('writes a header row and one line per transaction', () => {
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Serial,Date,Value Date,Narration,Ref No.,Debit,Credit,Balance,Confidence,Issues');
  });

  it('formats dates day-first and amounts as plain decimals', () => {
    expect(lines[1]).toContain('01/04/2024');
    expect(lines[1]).toContain('25000.00');
    expect(lines[1]).toContain('125000.00');
  });

  it('leaves the unused side of a transaction empty rather than zero', () => {
    const fields = lines[1]!.split(',');
    expect(fields[5]).toBe(''); // debit
    expect(fields[6]).toBe('25000.00'); // credit
  });

  it('quotes and escapes embedded commas and quotes', () => {
    expect(lines[2]).toContain('"ATM WDL, BANDRA ""WEST"""');
  });

  it('neutralises formula injection in narration', () => {
    const dangerous = toCsv(
      [{ ...TRANSACTIONS[0]!, narration: '=cmd|calc!A1' }],
      META,
    );
    expect(dangerous).toContain("'=cmd|calc!A1");
    expect(dangerous).not.toMatch(/,=cmd/);
  });

  it('ends every line with CRLF for Excel on Windows', () => {
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('XLSX export', () => {
  async function open() {
    const buffer = await toXlsx(TRANSACTIONS, META);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook;
  }

  it('produces a transactions sheet and a summary sheet', async () => {
    const workbook = await open();
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Transactions', 'Summary']);
  });

  it('freezes the header row', async () => {
    const sheet = (await open()).getWorksheet('Transactions')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('writes dates as real dates, not strings', async () => {
    const sheet = (await open()).getWorksheet('Transactions')!;
    const cell = sheet.getRow(2).getCell(2);

    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString()).toBe('2024-04-01T00:00:00.000Z');
    expect(cell.numFmt).toBe('dd/mm/yyyy');
  });

  it('writes amounts as numbers with Indian grouping', async () => {
    const sheet = (await open()).getWorksheet('Transactions')!;
    const row = sheet.getRow(2);

    expect(row.getCell(7).value).toBe(25_000);
    expect(row.getCell(7).numFmt).toBe('#,##,##0.00');
    expect(row.getCell(8).value).toBe(125_000);
  });

  it('carries the reconciliation onto the summary sheet', async () => {
    const sheet = (await open()).getWorksheet('Summary')!;
    const text = sheet
      .getSheetValues()
      .flatMap((r) => (Array.isArray(r) ? r : []))
      .map((v) => String(v ?? ''))
      .join(' | ');

    expect(text).toContain('HDFC Bank');
    expect(text).toContain('XXXXXXXXXX7891');
    expect(text).toContain('Reconciles');
    expect(text).toContain('Yes');
  });

  it('marks the summary as not reconciling when the maths does not hold', async () => {
    const buffer = await toXlsx(
      [{ ...TRANSACTIONS[0]! }, { ...TRANSACTIONS[1]!, balance: 999 }],
      META,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const text = workbook
      .getWorksheet('Summary')!
      .getSheetValues()
      .flatMap((r) => (Array.isArray(r) ? r : []))
      .map((v) => String(v ?? ''))
      .join(' | ');

    expect(text).toContain('review before use');
  });
});

describe('filenames', () => {
  it('names the download after the bank and period', () => {
    expect(suggestFilename(META, 'xlsx')).toBe('HDFC Bank statement 2024-04-01 to 2024-06-30.xlsx');
  });

  it('strips characters that are unsafe in a filename', () => {
    expect(suggestFilename({ ...META, bankName: 'A/B\\C:Bank' }, 'csv')).not.toMatch(/[/\\:]/);
  });
});

describe('accounting-import CSV', () => {
  const LEDGER_TXNS: Transaction[] = [
    {
      serial: 1,
      date: '2025-06-06',
      narration: 'Dr Card Charges GST ANNUAL 4632XXXXXXXX1258',
      narrationLines: ['Dr Card Charges GST ANNUAL', '4632XXXXXXXX1258'],
      debit: 295,
      credit: null,
      balance: 1000,
      confidence: 'high',
      issues: [],
    },
    {
      serial: 2,
      date: '2026-01-18',
      narration: 'GST @18% on ATM CA W/D Chrgs',
      narrationLines: ['GST @18% on ATM CA W/D Chrgs'],
      debit: 3.6,
      credit: null,
      balance: 996.4,
      confidence: 'high',
      issues: [],
    },
    {
      serial: 3,
      date: '2026-01-14',
      narration: 'IMPS/P2A/601419907199/ONSINFRA',
      debit: null,
      credit: 41000,
      balance: 41996.4,
      confidence: 'high',
      issues: [],
    },
  ];

  const csv = toLedgerCsv(LEDGER_TXNS, META, { bankCode: 'AXISBB' });
  const records = csv.split('\n');

  it('writes the six fixed columns, every field quoted', () => {
    expect(records[0]).toBe('"bk_cd","prt_cd","tr_date","amtp","amtr","rem"');
  });

  it('writes the supplied bank code and the suspense party code on every row', () => {
    expect(csv).toContain('"AXISBB","SUSP","06-06-2025"');
    expect(toLedgerCsv(LEDGER_TXNS, META, { bankCode: 'X', partyCode: 'CASH' })).toContain('"X","CASH"');
  });

  it('formats dates as dd-MM-yyyy', () => {
    expect(csv).toContain('"18-01-2026"');
    expect(csv).toContain('"14-01-2026"');
  });

  it('strips grouping separators and trailing zeros from amounts', () => {
    expect(csv).toContain('"295",""');
    expect(csv).toContain('"3.6",""');
    expect(csv).toContain('"","41000"');
    expect(csv).not.toMatch(/"\d+\.00"/);
    expect(csv).not.toMatch(/"\d+,\d+"/);
  });

  it('leaves the unused side empty rather than zero', () => {
    expect(csv).toContain('"","41000"');
    expect(csv).not.toContain('"0","41000"');
  });

  it("preserves the statement's own line breaks inside the remark", () => {
    expect(csv).toContain('"Dr Card Charges GST ANNUAL\n4632XXXXXXXX1258"');
  });

  it('falls back to the joined narration when no line breaks were captured', () => {
    expect(csv).toContain('"IMPS/P2A/601419907199/ONSINFRA"');
  });

  it('uses LF endings and terminates with a newline', () => {
    expect(csv).not.toContain('\r');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('escapes embedded quotes by doubling them', () => {
    const quoted = toLedgerCsv(
      [{ ...LEDGER_TXNS[0]!, narrationLines: undefined, narration: 'PAY "REF" 12' }],
      META,
      { bankCode: 'AXISBB' },
    );
    expect(quoted).toContain('"PAY ""REF"" 12"');
  });

  it('formats a plain amount without inventing precision', () => {
    expect(plainAmount(18)).toBe('18');
    expect(plainAmount(3.6)).toBe('3.6');
    expect(plainAmount(1234.5)).toBe('1234.5');
    expect(plainAmount(100000)).toBe('100000');
    expect(plainAmount(0)).toBe('0');
  });
});
