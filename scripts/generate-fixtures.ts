import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_SPECS } from './lib/fixture-specs';
import { buildLedger, inr, round2 } from './lib/ledger';
import { renderPartialScan, renderScannedLookalike, renderSparseTrailingPage, renderStatement } from './lib/render-statement';

/**
 * Regenerates every fixture PDF in `__tests__/fixtures`.
 *
 * Fixtures are synthetic by policy — no real customer statement is ever
 * committed to this repo. Output is deterministic, so regenerating produces
 * byte-identical ledgers and the golden files stay valid.
 */

const FIXTURE_DIR = join(process.cwd(), '__tests__', 'fixtures');
const GOLDEN_DIR = join(process.cwd(), '__tests__', 'golden');

async function main(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  mkdirSync(GOLDEN_DIR, { recursive: true });

  for (const [index, spec] of FIXTURE_SPECS.entries()) {
    const ledger = buildLedger({
      seed: 1000 + index,
      count: 34,
      openingBalance: 250_000 + index * 3_137,
      startDate: '2024-04-01',
    });

    const debits = round2(ledger.entries.reduce((sum, e) => sum + (e.debit ?? 0), 0));
    const credits = round2(ledger.entries.reduce((sum, e) => sum + (e.credit ?? 0), 0));

    const rows = ledger.entries.map((entry, i) => spec.row(entry, i, spec.dateFormat));

    // Every statement opens with a balance-brought-forward line, as banks print.
    const openingRow = spec.columns.map(() => '');
    const narrationIndex = spec.columns.findIndex((c) => c.align === 'left' && c.width > 120);
    if (narrationIndex >= 0) openingRow[narrationIndex] = 'OPENING BALANCE B/F';
    const balanceIndex = spec.columns.length - (spec.id === 'axis-savings-v1' ? 2 : 1);
    openingRow[balanceIndex] = inr(ledger.opening);

    await renderStatement({
      outputPath: join(FIXTURE_DIR, `${spec.id}.pdf`),
      headerLines: spec.headerLines,
      subHeader: spec.subHeader,
      columns: spec.columns,
      rows: [openingRow, ...rows],
      footerLines: spec.footer(ledger.opening, ledger.closing, debits, credits, ledger.entries.length),
      landscape: spec.landscape ?? false,
    });

    // The HDFC fixture doubles as the encrypted-PDF fixture, because password
    // protection is the norm for Indian statements, not the exception.
    if (spec.password) {
      await renderStatement({
        outputPath: join(FIXTURE_DIR, `${spec.id}-encrypted.pdf`),
        headerLines: spec.headerLines,
        subHeader: spec.subHeader,
        columns: spec.columns,
        rows: [openingRow, ...rows],
        footerLines: spec.footer(ledger.opening, ledger.closing, debits, credits, ledger.entries.length),
        landscape: spec.landscape ?? false,
        password: spec.password,
      });
    }

    // The golden file is the ledger the PDF was drawn from — an oracle
    // independent of the parser, rather than a snapshot of its own output.
    const golden = {
      bankName: spec.bankName,
      templateId: spec.id,
      openingBalance: ledger.opening,
      closingBalance: ledger.closing,
      totalDebits: debits,
      totalCredits: credits,
      transactions: ledger.entries,
    };
    writeFileSync(join(GOLDEN_DIR, `${spec.id}.json`), `${JSON.stringify(golden, null, 2)}\n`);

    process.stdout.write(`generated ${spec.id}.pdf + golden (${ledger.entries.length} txns)\n`);
  }

  await renderScannedLookalike(join(FIXTURE_DIR, 'scanned-no-text.pdf'));
  process.stdout.write('generated scanned-no-text.pdf\n');

  await renderSparseTrailingPage(join(FIXTURE_DIR, 'sparse-trailing-page.pdf'));
  process.stdout.write('generated sparse-trailing-page.pdf\n');

  await renderPartialScan(join(FIXTURE_DIR, 'partial-scan.pdf'));
  process.stdout.write('generated partial-scan.pdf\n');
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
