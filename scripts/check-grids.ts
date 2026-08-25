import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDocument } from '../lib/pdf/extract';
import { buildGrid } from '../lib/pdf/grid';
import { FIXTURE_SPECS } from './lib/fixture-specs';

/**
 * Sanity sweep over column reconstruction.
 *
 * A shortfall is not necessarily a defect: pdf.js merges two cells into one
 * text run when the gutter between them is very narrow, and that happens before
 * any of this code sees the page. Templates therefore locate columns by header
 * text and read values token-wise. The per-bank golden tests are the real gate.
 */
async function main(): Promise<void> {
  let failures = 0;

  for (const spec of FIXTURE_SPECS) {
    const path = join(process.cwd(), '__tests__', 'fixtures', `${spec.id}.pdf`);
    const doc = await extractDocument(new Uint8Array(readFileSync(path)));
    const grid = buildGrid(doc.pages);

    const expected = spec.columns.length;
    const got = grid.columnCount;
    const ok = got === expected;
    if (!ok) failures++;


    // Locate the header row and show how the labels landed in the detected columns.
    const headerRow = grid.rows.find((r) => r.cells.some((c) => c.trim() === spec.columns[0]!.label));
    const mapped = headerRow ? headerRow.cells.map((c) => c || '·').join(' | ') : '(header row not found)';

    process.stdout.write(
      `${ok ? 'ok  ' : 'FAIL'} ${spec.id.padEnd(24)} expected=${expected} got=${got}\n       ${mapped}\n`,
    );
  }

  process.stdout.write(failures === 0 ? '\nall fixtures reconstructed\n' : `\n${failures} fixture(s) failed\n`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
