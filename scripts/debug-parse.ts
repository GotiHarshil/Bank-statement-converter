import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDocument, pageToText } from '../lib/pdf/extract';
import { buildGrid } from '../lib/pdf/grid';
import { detectTemplate, detectTemplates } from '../lib/banks/registry';
import { applyTemplate } from '../lib/parse/applyTemplate';

/**
 *   npx tsx scripts/debug-parse.ts hdfc-savings-v1 [password]
 */
async function main(): Promise<void> {
  const name = process.argv[2] ?? 'hdfc-savings-v1';
  const password = process.argv[3] || undefined;

  const bytes = new Uint8Array(readFileSync(join(process.cwd(), '__tests__', 'fixtures', `${name}.pdf`)));
  const doc = await extractDocument(bytes, password);
  const grid = buildGrid(doc.pages);

  const ranked = detectTemplates(doc.firstPageText);
  process.stdout.write(`detection: ${ranked.slice(0, 3).map((r) => `${r.template.id}=${r.confidence.toFixed(2)}`).join(', ')}\n`);

  const detected = detectTemplate(doc.firstPageText);
  if (!detected) {
    process.stdout.write('no template cleared the threshold\n');
    return;
  }

  const allText = doc.pages.map(pageToText).join('\n');
  const result = applyTemplate(grid, detected.template, allText);
  if (!result) {
    process.stdout.write('template matched but produced no transactions\n');
    return;
  }

  process.stdout.write(`\nmeta: ${JSON.stringify(result.meta, null, 2)}\n`);
  process.stdout.write(`notices: ${JSON.stringify(result.notices)}\n`);
  process.stdout.write(`transactions: ${result.transactions.length}\n\n`);
  process.stdout.write(`${JSON.stringify(result.transactions.slice(0, 5), null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
