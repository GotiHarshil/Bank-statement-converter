'use client';

import * as React from 'react';
import { FileSpreadsheet, Landmark, ScanLine, ShieldCheck } from 'lucide-react';
import { ProcessingPanel } from '@/components/ProcessingPanel';
import { ReviewPanel } from '@/components/ReviewPanel';
import { UploadPanel, type UploadSubmission } from '@/components/UploadPanel';
import { cn } from '@/lib/utils';
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

  const wide = stage.name === 'review';

  return (
    <div className="relative min-h-dvh">
      {stage.name === 'upload' && (
        <div className="bg-dot-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]" aria-hidden />
      )}

      <main className={cn('mx-auto w-full px-4 pt-8 pb-16 sm:px-6 lg:px-8', wide ? 'max-w-[110rem]' : 'max-w-4xl')}>
        <header className={cn('mb-8 flex flex-wrap items-center justify-between gap-4', wide && 'mb-6')}>
          <a href="/" className="group flex items-center gap-2.5" onClick={() => setStage({ name: 'upload' })}>
            <div className="from-primary to-primary/70 flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm transition-transform group-hover:scale-105">
              <FileSpreadsheet className="size-5" />
            </div>
            <span className="text-[0.95rem] font-semibold tracking-tight">StatementConverter</span>
          </a>
          <p className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
            <ShieldCheck className="size-3.5" />
            Processed in memory — never written to disk
          </p>
        </header>

        {stage.name === 'upload' && (
          <div className="animate-fade-in mx-auto max-w-2xl">
            <div className="mb-10 text-center">
              <span className="border-border bg-card text-muted-foreground mb-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm">
                <Landmark className="text-primary size-3.5" />
                10 Indian banks supported out of the box
              </span>
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Bank statements in,
                <br className="hidden sm:block" /> reconciled spreadsheets out.
              </h1>
              <p className="text-muted-foreground mx-auto mt-3 max-w-lg text-balance">
                Upload a PDF statement and get back a verified Excel or CSV file — every row checked against the
                running balance before you download anything.
              </p>
            </div>

            <UploadPanel
              onSubmit={convert}
              {...(stage.errorCode ? { errorCode: stage.errorCode } : {})}
              {...(stage.errorMessage ? { errorMessage: stage.errorMessage } : {})}
            />

            <div className="text-muted-foreground mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
              <span className="flex items-center gap-1.5">
                <ScanLine className="size-3.5" /> No scans — digital PDFs only
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" /> Nothing written to disk
              </span>
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="size-3.5" /> Excel, CSV &amp; accounting import
              </span>
            </div>
          </div>
        )}

        {stage.name === 'processing' && (
          <div className="animate-fade-in mx-auto max-w-2xl pt-12">
            <ProcessingPanel fileName={stage.fileName} progress={stage.progress} />
          </div>
        )}

        {stage.name === 'review' && (
          <div className="animate-fade-in">
            <ReviewPanel
              initialTransactions={stage.result.transactions}
              meta={stage.result.meta}
              initialValidation={stage.result.validation}
              notices={stage.result.notices}
              initialBankCode={stage.bankCode}
              onStartOver={() => setStage({ name: 'upload' })}
            />
          </div>
        )}
      </main>
    </div>
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
