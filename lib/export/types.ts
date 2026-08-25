import type { StatementMeta, Transaction } from '@/lib/schema';

/** User-supplied settings an exporter may need. */
export interface ExportOptions {
  /** Bank ledger code written to every row of an accounting import. */
  bankCode?: string;
  /** Contra/party ledger code. Defaults to the suspense account. */
  partyCode?: string;
}

/**
 * An output format.
 *
 * Tally XML is the next exporter, so nothing Excel-specific may leak into the
 * parsing or validation layers — everything an exporter needs arrives through
 * this interface.
 */
export interface Exporter {
  id: string;
  label: string;
  /** MIME type for the download response. */
  contentType: string;
  extension: string;
  /** Settings the user must supply before this format can be produced. */
  requires?: ReadonlyArray<keyof ExportOptions>;
  export(
    txns: Transaction[],
    meta: StatementMeta,
    options?: ExportOptions,
  ): Promise<Buffer | string> | Buffer | string;
}

/** `HDFC Bank statement 2024-04-01 to 2024-06-30.xlsx` */
export function suggestFilename(meta: StatementMeta, extension: string): string {
  const period = meta.periodFrom && meta.periodTo ? ` ${meta.periodFrom} to ${meta.periodTo}` : '';
  const safe = `${meta.bankName} statement${period}`.replace(/[^\w\-. ]+/g, '').trim();
  return `${safe || 'bank-statement'}.${extension}`;
}
