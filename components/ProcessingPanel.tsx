'use client';

import { Check, FileSearch, Loader2, ScanSearch, ShieldCheck, Table2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { ConvertProgress } from '@/lib/convert';

interface ProcessingPanelProps {
  fileName: string;
  progress: ConvertProgress | null;
}

type StepId = 'extract' | 'reconstruct' | 'parse' | 'validate';

const STEPS: Array<{ id: StepId; label: string; icon: typeof FileSearch }> = [
  { id: 'extract', label: 'Reading pages', icon: FileSearch },
  { id: 'reconstruct', label: 'Rebuilding table', icon: Table2 },
  { id: 'parse', label: 'Matching bank format', icon: ScanSearch },
  { id: 'validate', label: 'Verifying balance', icon: ShieldCheck },
];

/**
 * Real progress, driven by the server's streamed events — the page counter
 * moves because pages are actually being parsed, not because a timer says so.
 */
export function ProcessingPanel({ fileName, progress }: ProcessingPanelProps) {
  const { percent, label, detail, activeStep } = describe(progress);
  const activeIndex = STEPS.findIndex((s) => s.id === activeStep);

  return (
    <Card className="animate-slide-up overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="text-primary size-4 animate-spin" />
          Converting {fileName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STEPS.map((step, index) => {
            const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
            const Icon = step.icon;
            return (
              <div
                key={step.id}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors duration-300',
                  state === 'done' && 'border-success/30 bg-success/5',
                  state === 'active' && 'border-primary/40 bg-primary/5',
                  state === 'pending' && 'border-border bg-muted/30',
                )}
              >
                <div
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full transition-colors duration-300',
                    state === 'done' && 'bg-success text-success-foreground',
                    state === 'active' && 'bg-primary text-primary-foreground',
                    state === 'pending' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {state === 'done' ? (
                    <Check className="size-4" />
                  ) : state === 'active' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium',
                    state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <Progress value={percent} className="h-1.5" />
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-muted-foreground text-xs">{percent}%</p>
          </div>
          <p className="text-muted-foreground text-xs">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function describe(
  progress: ConvertProgress | null,
): { percent: number; label: string; detail: string; activeStep: StepId } {
  if (!progress) {
    return { percent: 4, label: 'Uploading…', detail: 'Sending the file for processing.', activeStep: 'extract' };
  }

  switch (progress.stage) {
    case 'extracting': {
      // Extraction is the long pole, so it owns most of the bar.
      const share = progress.totalPages > 0 ? progress.page / progress.totalPages : 0;
      return {
        percent: 8 + Math.round(share * 62),
        label: `Reading page ${progress.page} of ${progress.totalPages}`,
        detail: 'Extracting positioned text so columns stay intact.',
        activeStep: 'extract',
      };
    }
    case 'reconstructing':
      return {
        percent: 76,
        label: 'Rebuilding the table',
        detail: 'Clustering rows and detecting columns.',
        activeStep: 'reconstruct',
      };
    case 'parsing':
      return {
        percent: 85,
        label: `Applying the ${progress.bankName} template`,
        detail: 'Reading dates and amounts.',
        activeStep: 'parse',
      };
    case 'inferring':
      return {
        percent: 85,
        label: 'Inferring the column mapping with AI',
        detail: 'No built-in template matched this layout.',
        activeStep: 'parse',
      };
    case 'validating':
      return {
        percent: 95,
        label: 'Checking the running balance',
        detail: 'Verifying every row reconciles.',
        activeStep: 'validate',
      };
    default:
      return { percent: 50, label: 'Working…', detail: '', activeStep: 'extract' };
  }
}
