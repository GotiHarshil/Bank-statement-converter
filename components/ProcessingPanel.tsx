'use client';

import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { ConvertProgress } from '@/lib/convert';

interface ProcessingPanelProps {
  fileName: string;
  progress: ConvertProgress | null;
}

/**
 * Real progress, driven by the server's streamed events — the page counter
 * moves because pages are actually being parsed, not because a timer says so.
 */
export function ProcessingPanel({ fileName, progress }: ProcessingPanelProps) {
  const { percent, label, detail } = describe(progress);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="text-primary size-4 animate-spin" />
          Converting {fileName}
        </CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={percent} />
        <p className="text-muted-foreground text-sm">{label}</p>
      </CardContent>
    </Card>
  );
}

function describe(progress: ConvertProgress | null): { percent: number; label: string; detail: string } {
  if (!progress) {
    return { percent: 4, label: 'Uploading…', detail: 'Sending the file for processing.' };
  }

  switch (progress.stage) {
    case 'extracting': {
      // Extraction is the long pole, so it owns most of the bar.
      const share = progress.totalPages > 0 ? progress.page / progress.totalPages : 0;
      return {
        percent: 8 + Math.round(share * 62),
        label: `Reading page ${progress.page} of ${progress.totalPages}`,
        detail: 'Extracting positioned text so columns stay intact.',
      };
    }
    case 'reconstructing':
      return { percent: 76, label: 'Rebuilding the table', detail: 'Clustering rows and detecting columns.' };
    case 'parsing':
      return { percent: 85, label: `Applying the ${progress.bankName} template`, detail: 'Reading dates and amounts.' };
    case 'inferring':
      return {
        percent: 85,
        label: 'Inferring the column mapping with AI',
        detail: 'No built-in template matched this layout.',
      };
    case 'validating':
      return { percent: 95, label: 'Checking the running balance', detail: 'Verifying every row reconciles.' };
    default:
      return { percent: 50, label: 'Working…', detail: '' };
  }
}
