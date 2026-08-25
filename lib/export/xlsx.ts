import ExcelJS from 'exceljs';
import { isoToDate } from '@/lib/parse/parseDate';
import { round2 } from '@/lib/parse/parseAmount';
import type { StatementMeta, Transaction } from '@/lib/schema';
import type { Exporter } from '@/lib/export/types';

/** Indian accounting number format, to two decimals. */
const INR_FORMAT = '#,##,##0.00';
const DATE_FORMAT = 'dd/mm/yyyy';

const HEADERS = [
  { header: '#', key: 'serial', width: 6 },
  { header: 'Date', key: 'date', width: 13 },
  { header: 'Value Date', key: 'valueDate', width: 13 },
  { header: 'Narration', key: 'narration', width: 58 },
  { header: 'Ref No.', key: 'refNo', width: 16 },
  { header: 'Debit', key: 'debit', width: 15 },
  { header: 'Credit', key: 'credit', width: 15 },
  { header: 'Balance', key: 'balance', width: 16 },
  { header: 'Confidence', key: 'confidence', width: 12 },
  { header: 'Issues', key: 'issues', width: 44 },
] as const;

/**
 * Writes a workbook an accountant can use directly: a frozen header row, real
 * date-typed dates rather than strings, Indian number formatting, and a summary
 * sheet carrying the reconciliation.
 */
export async function toXlsx(transactions: Transaction[], meta: StatementMeta): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bank Statement Converter';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Transactions', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = HEADERS.map((h) => ({ header: h.header, key: h.key, width: h.width }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.border = { bottom: { style: 'thin' } };

  for (const t of transactions) {
    const row = sheet.addRow({
      serial: t.serial,
      // A real Date, so Excel sorts and filters by date instead of by text.
      date: isoToDate(t.date),
      valueDate: t.valueDate ? isoToDate(t.valueDate) : null,
      narration: t.narration,
      refNo: t.refNo ?? '',
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
      confidence: t.confidence,
      issues: t.issues.join('; '),
    });

    row.getCell('date').numFmt = DATE_FORMAT;
    row.getCell('valueDate').numFmt = DATE_FORMAT;
    for (const key of ['debit', 'credit', 'balance'] as const) {
      row.getCell(key).numFmt = INR_FORMAT;
    }

    // Anything the parser was unsure about is visible in the workbook itself,
    // not just in the web UI the user has already closed.
    if (t.confidence !== 'high' || t.issues.length > 0) {
      row.getCell('confidence').font = { color: { argb: 'FFB45309' }, bold: true };
    }
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };

  addSummarySheet(workbook, transactions, meta);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function addSummarySheet(workbook: ExcelJS.Workbook, transactions: Transaction[], meta: StatementMeta): void {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [
    { key: 'label', width: 30 },
    { key: 'value', width: 42 },
  ];

  const debits = round2(transactions.reduce((sum, t) => sum + (t.debit ?? 0), 0));
  const credits = round2(transactions.reduce((sum, t) => sum + (t.credit ?? 0), 0));
  const closing = transactions.length ? transactions[transactions.length - 1]!.balance : meta.closingBalance;
  const computed = meta.openingBalance === null ? null : round2(meta.openingBalance + credits - debits);
  const reconciles = computed !== null && closing !== null && Math.abs(computed - closing) <= 0.01;

  const rows: Array<[string, string | number | null, 'money' | 'text']> = [
    ['Bank', meta.bankName, 'text'],
    ['Account number', meta.accountNumberMasked ?? 'not stated', 'text'],
    ['Statement period', meta.periodFrom && meta.periodTo ? `${meta.periodFrom} to ${meta.periodTo}` : 'not stated', 'text'],
    ['Pages', meta.pageCount, 'text'],
    ['Parsed by', meta.parsedBy === 'template' ? `Template (${meta.templateId})` : 'AI-assisted column mapping', 'text'],
    ['', null, 'text'],
    ['Transactions', transactions.length, 'text'],
    ['Opening balance', meta.openingBalance, 'money'],
    ['Total debits', debits, 'money'],
    ['Total credits', credits, 'money'],
    ['Closing balance', closing, 'money'],
    ['Opening + credits − debits', computed, 'money'],
    ['Reconciles', reconciles ? 'Yes' : 'No — review before use', 'text'],
  ];

  const titleRow = sheet.addRow({ label: 'Statement summary', value: '' });
  titleRow.font = { bold: true, size: 13 };
  sheet.addRow({});

  for (const [label, value, kind] of rows) {
    const row = sheet.addRow({ label, value });
    row.getCell('label').font = { bold: true };
    if (kind === 'money' && typeof value === 'number') row.getCell('value').numFmt = INR_FORMAT;
    if (label === 'Reconciles') {
      row.getCell('value').font = { bold: true, color: { argb: reconciles ? 'FF15803D' : 'FFB91C1C' } };
    }
  }
}

export const xlsxExporter: Exporter = {
  id: 'xlsx',
  label: 'Excel (.xlsx)',
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extension: 'xlsx',
  export: toXlsx,
};
