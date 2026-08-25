import { csvExporter } from '@/lib/export/csv';
import { ledgerCsvExporter } from '@/lib/export/ledger-csv';
import { xlsxExporter } from '@/lib/export/xlsx';
import type { Exporter } from '@/lib/export/types';

/**
 * Available output formats.
 *
 * Adding Tally XML means adding one file and one entry here — the parsing and
 * validation layers know nothing about any of these.
 */
export const EXPORTERS: Exporter[] = [xlsxExporter, csvExporter, ledgerCsvExporter];

export function findExporter(id: string): Exporter | undefined {
  return EXPORTERS.find((e) => e.id === id);
}
