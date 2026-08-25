import { isoToDisplay } from '@/lib/parse/parseDate';
import type { StatementMeta, Transaction } from '@/lib/schema';
import type { Exporter } from '@/lib/export/types';

const COLUMNS = [
  'Serial',
  'Date',
  'Value Date',
  'Narration',
  'Ref No.',
  'Debit',
  'Credit',
  'Balance',
  'Confidence',
  'Issues',
] as const;

/**
 * RFC 4180 quoting.
 *
 * The leading-character guard defends against CSV injection: a narration
 * beginning `=`, `+`, `-` or `@` is executed as a formula when the file is
 * opened in Excel, and bank narrations are attacker-influenced text.
 */
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Plain decimal, no grouping — spreadsheets should read these as numbers. */
function money(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

export function toCsv(transactions: Transaction[], _meta: StatementMeta): string {
  const lines = [COLUMNS.join(',')];

  for (const t of transactions) {
    lines.push(
      [
        t.serial,
        isoToDisplay(t.date),
        t.valueDate ? isoToDisplay(t.valueDate) : '',
        t.narration,
        t.refNo ?? '',
        money(t.debit),
        money(t.credit),
        money(t.balance),
        t.confidence,
        t.issues.join('; '),
      ]
        .map(escapeCell)
        .join(','),
    );
  }

  // CRLF, because Excel on Windows is the overwhelmingly common destination.
  return `${lines.join('\r\n')}\r\n`;
}

export const csvExporter: Exporter = {
  id: 'csv',
  label: 'CSV (.csv)',
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
  export: toCsv,
};
