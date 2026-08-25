import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertStatement } from '../lib/convert';
import { FIXTURE_SPECS } from './lib/fixture-specs';

/** Runs every fixture through the full pipeline and reports reconciliation. */
async function main(): Promise<void> {
  let failures = 0;

  for (const spec of FIXTURE_SPECS) {
    const path = join(process.cwd(), '__tests__', 'fixtures', `${spec.id}.pdf`);
    try {
      const result = await convertStatement(new Uint8Array(readFileSync(path)));
      const { validation, transactions, meta } = result;
      const failed = validation.checks.filter((c) => c.status === 'fail');
      if (failed.length) failures++;

      process.stdout.write(
        `${failed.length === 0 ? 'ok  ' : 'FAIL'} ${spec.id.padEnd(24)} ` +
          `txns=${String(transactions.length).padStart(3)} ` +
          `open=${meta.openingBalance} close=${meta.closingBalance} ` +
          `checks=${validation.checks.map((c) => `${c.id}:${c.status}`).join(' ')}\n`,
      );
      for (const check of failed) {
        process.stdout.write(`       ${check.id}: ${check.detail}\n`);
        for (const serial of check.offendingRows.slice(0, 3)) {
          const row = validation.rows.find((r) => r.serial === serial);
          process.stdout.write(`         row ${serial}: ${row?.messages.join(' ')}\n`);
        }
      }
    } catch (err) {
      failures++;
      process.stdout.write(`FAIL ${spec.id.padEnd(24)} threw: ${String((err as Error).message)}\n`);
    }
  }

  process.stdout.write(failures === 0 ? '\nall banks parsed and reconciled\n' : `\n${failures} bank(s) failed\n`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
