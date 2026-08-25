'use client';

import * as React from 'react';
import { FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { ProcessingPanel } from '@/components/ProcessingPanel';
import { ReviewPanel } from '@/components/ReviewPanel';
import { UploadPanel, type UploadSubmission } from '@/components/UploadPanel';
import type { ConvertProgress } from '@/lib/convert';
import type { ConvertErrorCode, ConvertSuccessBody } from '@/lib/schema';

type Stage =
  | { name: 'upload'; errorCode?: ConvertErrorCode; errorMessage?: string }
  | { name: 'processing'; fileName: string; progress: ConvertProgress | null }
  | { name: 'review'; result: ConvertSuccessBody; bankCode: string };

export default function Page() {
  const [stage, setStage] = React.useState<Stage>({ name: 'upload' });

  async function convert(submission: UploadSubmission) {
    setStage({ name: 'processing', fileName: submission.file.name, progress: null });

    const form = new FormData();
    form.set('file', submission.file);
    if (submission.password) form.set('password', submission.password);
    if (submission.bankHint) form.set('bankHint', submission.bankHint);
    form.set('allowLlmFallback', String(submission.allowLlmFallback));

    try {
      const response = await fetch('/api/convert', { method: 'POST', body: form });

      // Rate limiting and malformed uploads answer with plain JSON, not a stream.
      if (!response.body || response.headers.get('Content-Type')?.includes('application/json')) {
        const body = (await response.json().catch(() => null)) as
          | { code?: ConvertErrorCode; message?: string }
          | null;
        setStage({
          name: 'upload',
          ...(body?.code ? { errorCode: body.code } : {}),
          errorMessage: body?.message ?? 'The statement could not be converted.',
        });
        return;
      }

      await readStream(response.body, (event) => {
        if (event.type === 'progress') {
          setStage((current) =>
            current.name === 'processing' ? { ...current, progress: event.progress } : current,
          );
          return;
        }

        if (event.result.ok) {
          setStage({ name: 'review', result: event.result, bankCode: submission.bankCode ?? '' });
        } else {
          setStage({ name: 'upload', errorCode: event.result.code, errorMessage: event.result.message });
        }
      });
    } catch {
      setStage({
        name: 'upload',
        errorMessage: 'The connection dropped while converting. Please try again.',
      });
    }
  }

  return (
    <main className="mx-auto w-full max-w-[110rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary rounded-lg p-2">
            <FileSpreadsheet className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Bank Statement Converter</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Turn an Indian bank statement PDF into a verified Excel or CSV file.
            </p>
          </div>
        </div>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <ShieldCheck className="size-4" />
          Processed in memory · never written to disk
        </p>
      </header>

      {stage.name === 'upload' && (
        <div className="mx-auto max-w-3xl">
          <UploadPanel
            onSubmit={convert}
            {...(stage.errorCode ? { errorCode: stage.errorCode } : {})}
            {...(stage.errorMessage ? { errorMessage: stage.errorMessage } : {})}
          />
        </div>
      )}

      {stage.name === 'processing' && (
        <div className="mx-auto max-w-3xl">
          <ProcessingPanel fileName={stage.fileName} progress={stage.progress} />
        </div>
      )}

      {stage.name === 'review' && (
        <ReviewPanel
          initialTransactions={stage.result.transactions}
          meta={stage.result.meta}
          initialValidation={stage.result.validation}
          notices={stage.result.notices}
          initialBankCode={stage.bankCode}
          onStartOver={() => setStage({ name: 'upload' })}
        />
      )}
    </main>
  );
}

type StreamEvent =
  | { type: 'progress'; progress: ConvertProgress }
  | { type: 'result'; result: ConvertSuccessBody | { ok: false; code: ConvertErrorCode; message: string } };

/** Reads the newline-delimited JSON progress stream. */
async function readStream(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // The final chunk may not end on a newline, so keep the remainder buffered.
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as StreamEvent);
      newline = buffer.indexOf('\n');
    }
  }

  const tail = buffer.trim();
  if (tail) onEvent(JSON.parse(tail) as StreamEvent);
}
