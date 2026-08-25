import { isoToDisplay } from '@/lib/parse/parseDate';
import type { StatementMeta, Transaction } from '@/lib/schema';
import type { ExportOptions, Exporter } from '@/lib/export/types';

/**
 * Accounting-import CSV.
 *
 * A fixed six-column layout consumed by Indian accounting packages:
 *
 *   bk_cd    the bank ledger code in the user's books, e.g. AXISBB
 *   prt_cd   the contra/party ledger; SUSP (suspense) until it is allocated
 *   tr_date  dd-MM-yyyy
 *   amtp     amount paid    — the withdrawal/debit side
 *   amtr     amount received — the deposit/credit side
 *   rem      remarks, carrying the statement's own line breaks
 *
 * Every field is quoted, amounts carry no grouping separators, and the unused
 * side of a transaction is an empty string rather than a zero.
 */

/** The suspense ledger most imports expect until entries are allocated. */
export const DEFAULT_PARTY_CODE = 'SUSP';

const COLUMNS = ['bk_cd', 'prt_cd', 'tr_date', 'amtp', 'amtr', 'rem'] as const;

/**
 * Quotes a field.
 *
 * Unlike the general-purpose CSV exporter, no formula-injection prefix is added
 * here. This file is consumed by an accounting importer, not opened in a
 * spreadsheet, and a stray leading apostrophe would corrupt the imported
 * remark. Fidelity to the source statement is the requirement.
 */
function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Plain decimal with no grouping, and no trailing zeros.
 *
 * The importer expects `18` rather than `18.00`, and `3.6` rather than `3.60`.
 */
export function plainAmount(value: number): string {
  const fixed = Math.abs(value).toFixed(2);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** ISO date to the dd-MM-yyyy the importer expects. */
function importDate(iso: string): string {
  return isoToDisplay(iso).replace(/\//g, '-');
}

/** The narration with the statement's own line breaks, when they were captured. */
function remarks(transaction: Transaction): string {
  const lines = transaction.narrationLines;
  if (lines && lines.length > 0) return lines.join('\n');
  return transaction.narration;
}

export function toLedgerCsv(
  transactions: Transaction[],
  _meta: StatementMeta,
  options: ExportOptions = {},
): string {
  const bankCode = (options.bankCode ?? '').trim();
  const partyCode = (options.partyCode ?? DEFAULT_PARTY_CODE).trim() || DEFAULT_PARTY_CODE;

  const lines = [COLUMNS.map(quote).join(',')];

  for (const t of transactions) {
    lines.push(
      [
        bankCode,
        partyCode,
        importDate(t.date),
        t.debit === null ? '' : plainAmount(t.debit),
        t.credit === null ? '' : plainAmount(t.credit),
        remarks(t),
      ]
        .map(quote)
        .join(','),
    );
  }

  // Newline-terminated, LF only — matching the format the importer is fed.
  return `${lines.join('\n')}\n`;
}

export const ledgerCsvExporter: Exporter = {
  id: 'ledger-csv',
  label: 'Accounting import (.csv)',
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
  requires: ['bankCode'],
  export: toLedgerCsv,
};
