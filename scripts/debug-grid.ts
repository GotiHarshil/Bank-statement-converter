import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDocument } from '../lib/pdf/extract';
import { buildGrid, gridToMarkdown } from '../lib/pdf/grid';

/**
 * Prints the reconstructed grid for a fixture, so column detection can be eyeballed.
 *
 *   npx tsx scripts/debug-grid.ts hdfc-savings-v1 [password]
 */
async function main(): Promise<void> {
  const name = process.argv[2] ?? 'hdfc-savings-v1';
  const password = process.argv[3];
  const path = name.endsWith('.pdf') ? name : join(process.cwd(), '__tests__', 'fixtures', `${name}.pdf`);

  const bytes = new Uint8Array(readFileSync(path));
  const doc = await extractDocument(bytes, password);
  const grid = buildGrid(doc.pages);

  process.stdout.write(`pages=${doc.numPages}  rows=${grid.rows.length}  columns=${grid.columnCount}\n`);
  process.stdout.write(`column edges: ${grid.columnEdges.map((e) => e.toFixed(1)).join(', ')}\n\n`);
  process.stdout.write(gridToMarkdown(grid, Number(process.argv[4] ?? 40)));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
