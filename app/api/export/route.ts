import { z } from 'zod';
import { findExporter } from '@/lib/export/registry';
import { suggestFilename } from '@/lib/export/types';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { StatementMetaSchema, TransactionSchema } from '@/lib/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/**
 * Exports come back from the client rather than from a server-side session,
 * because the review step lets the user correct rows before downloading. The
 * payload is therefore re-validated here rather than trusted.
 */
const ExportRequest = z.object({
  format: z.string().min(1).max(32),
  transactions: z.array(TransactionSchema).min(1).max(20_000),
  meta: StatementMetaSchema,
  options: z
    .object({
      bankCode: z.string().max(32).optional(),
      partyCode: z.string().max(32).optional(),
    })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  const limit = rateLimit(`export:${clientKey(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return Response.json({ ok: false, code: 'RATE_LIMITED', message: 'Too many exports. Please wait a minute.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = ExportRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, message: 'The transactions being exported did not match the expected shape.' },
      { status: 400 },
    );
  }

  const exporter = findExporter(parsed.data.format);
  if (!exporter) {
    return Response.json({ ok: false, message: `Unknown export format "${parsed.data.format}".` }, { status: 400 });
  }

  const options = parsed.data.options ?? {};

  // An accounting import is unusable without its ledger code, so refuse rather
  // than emitting a file with an empty column the user would not notice.
  for (const required of exporter.requires ?? []) {
    if (!options[required]?.trim()) {
      return Response.json(
        { ok: false, message: `The "${exporter.label}" format needs a ${required === 'bankCode' ? 'bank code' : required}.` },
        { status: 400 },
      );
    }
  }

  const output = await exporter.export(parsed.data.transactions, parsed.data.meta, options);
  const filename = suggestFilename(parsed.data.meta, exporter.extension);

  console.info(`export format=${exporter.id} txns=${parsed.data.transactions.length}`);

  const payload: BodyInit = typeof output === 'string' ? output : new Uint8Array(output);

  return new Response(payload, {
    headers: {
      'Content-Type': exporter.contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
