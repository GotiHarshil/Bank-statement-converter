import { NextResponse } from 'next/server';
import { convertStatement } from '@/lib/convert';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import type { ConvertProgress } from '@/lib/convert';
import { ConvertError, type ConvertErrorBody, type ConvertResponse } from '@/lib/schema';

// Buffer and pdf.js both need the Node runtime; this must never run on Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

/**
 * Newline-delimited JSON stream.
 *
 * Progress events arrive as each page is parsed, so the UI can show real
 * progress rather than a spinner that means nothing. The last line is either
 * the result or a typed error.
 */
export type ConvertStreamEvent =
  | { type: 'progress'; progress: ConvertProgress }
  | { type: 'result'; result: ConvertResponse };

export async function POST(request: Request): Promise<Response> {
  const limit = rateLimit(`convert:${clientKey(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return errorResponse('RATE_LIMITED', 'Too many conversions from this address. Please wait a minute and try again.', 429, {
      'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
    });
  }

  const startedAt = Date.now();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse('NOT_A_PDF', 'The upload could not be read. Please choose a PDF file and try again.', 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return errorResponse('NOT_A_PDF', 'No file was uploaded.', 400);
  }
  if (file.size > MAX_BYTES) {
    return errorResponse('FILE_TOO_LARGE', 'That PDF is larger than 20 MB. Please upload a single statement period.', 413);
  }
  if (file.size === 0) {
    return errorResponse('NOT_A_PDF', 'That file is empty.', 400);
  }

  const password = asString(form.get('password'));
  const bankHint = asString(form.get('bankHint'));
  const allowLlmFallback = asString(form.get('allowLlmFallback')) === 'true';

  // The PDF lives in this buffer and nowhere else. It is never written to disk.
  const bytes = new Uint8Array(await file.arrayBuffer());

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ConvertStreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        const result = await convertStatement(bytes, {
          ...(password ? { password } : {}),
          ...(bankHint ? { bankHint } : {}),
          allowLlmFallback,
          onProgress: (progress) => send({ type: 'progress', progress }),
        });

        // Metadata only: never narration, account numbers or balances.
        console.info(
          `convert ok pages=${result.meta.pageCount} template=${result.meta.templateId} parsedBy=${result.meta.parsedBy} ` +
            `txns=${result.transactions.length} reconciled=${result.validation.ok} ms=${Date.now() - startedAt}`,
        );

        send({ type: 'result', result });
      } catch (err) {
        if (err instanceof ConvertError) {
          console.info(`convert failed code=${err.code} ms=${Date.now() - startedAt}`);
          send({ type: 'result', result: { ok: false, code: err.code, message: err.message } });
        } else {
          // Log the shape of the failure, never its contents.
          console.error(`convert crashed ms=${Date.now() - startedAt}`, err instanceof Error ? err.name : 'unknown');
          send({
            type: 'result',
            result: { ok: false, code: 'PARSE_FAILED', message: 'Something went wrong while reading this statement.' },
          });
        }
      } finally {
        // Wipe the statement from memory as soon as it is no longer needed.
        bytes.fill(0);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

function errorResponse(
  code: ConvertErrorBody['code'],
  message: string,
  status: number,
  headers: Record<string, string> = {},
): NextResponse<ConvertErrorBody> {
  return NextResponse.json(
    { ok: false, code, message },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
