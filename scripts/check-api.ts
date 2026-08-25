import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Drives the running dev server the way the browser does: multipart upload,
 * newline-delimited progress stream, then an export round-trip.
 *
 *   npx tsx scripts/check-api.ts http://localhost:3000
 */
const BASE = process.argv[2] ?? 'http://localhost:3000';

interface StreamEvent {
  type: 'progress' | 'result';
  progress?: { stage: string; page?: number; totalPages?: number };
  result?: Record<string, unknown>;
}

async function convert(fixture: string, extra: Record<string, string> = {}) {
  const bytes = readFileSync(join(process.cwd(), '__tests__', 'fixtures', `${fixture}.pdf`));

  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'application/pdf' }), `${fixture}.pdf`);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);

  const response = await fetch(`${BASE}/api/convert`, { method: 'POST', body: form });
  const text = await response.text();

  const events = text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);

  const stages = events.filter((e) => e.type === 'progress').map((e) => e.progress!.stage);
  const final = events.find((e) => e.type === 'result')?.result;

  return { contentType: response.headers.get('Content-Type'), stages, final };
}

async function main(): Promise<void> {
  // 1. Happy path, with streamed progress.
  const hdfc = await convert('hdfc-savings-v1');
  const result = hdfc.final as {
    ok: boolean;
    transactions: unknown[];
    meta: Record<string, unknown>;
    validation: { ok: boolean };
  };

  console.log(`content-type      ${hdfc.contentType}`);
  console.log(`progress stages   ${hdfc.stages.join(' → ')}`);
  console.log(`ok=${result.ok} txns=${result.transactions.length} reconciled=${result.validation.ok} bank=${String(result.meta.bankName)}`);
  console.log(`account masked    ${String(result.meta.accountNumberMasked)}`);

  // 2. Encrypted PDF: typed error, then success once unlocked.
  const locked = await convert('hdfc-savings-v1-encrypted');
  console.log(`encrypted         ${String((locked.final as { code?: string }).code)}`);

  const wrong = await convert('hdfc-savings-v1-encrypted', { password: 'NOPE' });
  console.log(`wrong password    ${String((wrong.final as { code?: string }).code)}`);

  const unlocked = await convert('hdfc-savings-v1-encrypted', { password: 'ARJU1990' });
  console.log(`unlocked          txns=${(unlocked.final as { transactions: unknown[] }).transactions.length}`);

  // 3. Scanned PDF must fail loudly.
  const scanned = await convert('scanned-no-text');
  console.log(`scanned           ${String((scanned.final as { code?: string }).code)}`);

  // 4. Export round-trip for both formats.
  for (const format of ['xlsx', 'csv']) {
    const response = await fetch(`${BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, transactions: result.transactions, meta: result.meta }),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(
      `export ${format.padEnd(5)}      ${response.status} ${buffer.length} bytes  ${response.headers.get('Content-Disposition')}`,
    );
  }

  // 5. A malformed export payload must be rejected, not trusted.
  const bad = await fetch(`${BASE}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'xlsx', transactions: [{ nonsense: true }], meta: result.meta }),
  });
  console.log(`bad payload       ${bad.status}`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
