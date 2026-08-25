'use client';

import { CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatInr } from '@/lib/validate/reconcile';
import type { StatementMeta, ValidationReport } from '@/lib/schema';

interface SummaryCardProps {
  meta: StatementMeta;
  validation: ValidationReport;
  onJumpToRow: (serial: number) => void;
}

export function SummaryCard({ meta, validation, onJumpToRow }: SummaryCardProps) {
  const { summary } = validation;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Statement summary</CardTitle>
          {validation.ok ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3.5" /> Reconciled
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="size-3.5" /> Does not reconcile
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Bank" value={meta.bankName} />
            <Row label="Account" value={meta.accountNumberMasked ?? 'not stated'} />
            <Row
              label="Period"
              value={meta.periodFrom && meta.periodTo ? `${meta.periodFrom} → ${meta.periodTo}` : 'not stated'}
            />
            <Row label="Pages" value={String(meta.pageCount)} />
            <Row label="Transactions" value={String(summary.transactionCount)} />
            <Row
              label="Parsed by"
              value={meta.parsedBy === 'template' ? `Template · ${meta.templateId}` : 'AI-assisted mapping'}
            />
          </dl>

          <div className="border-t pt-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Row label="Opening balance" value={money(summary.openingBalance)} mono />
              <Row label="Closing balance" value={money(summary.closingBalance)} mono />
              <Row label="Total debits" value={money(summary.totalDebits)} mono />
              <Row label="Total credits" value={money(summary.totalCredits)} mono />
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {validation.checks.map((check) => (
            <div key={check.id} className="flex gap-2.5 text-sm">
              <CheckIcon status={check.status} />
              <div className="min-w-0">
                <p className="font-medium">{check.label}</p>
                <p className="text-muted-foreground">{check.detail}</p>
                {check.offendingRows.length > 0 && (
                  <p className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground text-xs">Rows:</span>
                    {check.offendingRows.slice(0, 12).map((serial) => (
                      <button
                        key={serial}
                        type="button"
                        onClick={() => onJumpToRow(serial)}
                        className="text-destructive hover:bg-destructive/10 rounded border px-1.5 py-0.5 text-xs font-medium"
                      >
                        #{serial}
                      </button>
                    ))}
                    {check.offendingRows.length > 12 && (
                      <span className="text-muted-foreground text-xs">
                        +{check.offendingRows.length - 12} more
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CheckIcon({ status }: { status: 'pass' | 'fail' | 'skipped' }) {
  if (status === 'pass') return <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />;
  if (status === 'fail') return <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />;
  return <MinusCircle className="text-muted-foreground mt-0.5 size-4 shrink-0" />;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'tabular text-right font-medium' : 'truncate font-medium'} title={value}>
        {value}
      </dd>
    </div>
  );
}

function money(value: number | null): string {
  return value === null ? '—' : formatInr(value);
}

export function IssueBanner({ validation }: { validation: ValidationReport }) {
  if (validation.ok && validation.summary.warningRows === 0) return null;

  return (
    <div className="border-warning/45 bg-warning/10 flex gap-3 rounded-lg border p-4 text-sm">
      <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">Review before you export</p>
        <p className="text-muted-foreground">
          {validation.summary.errorRows > 0
            ? `${validation.summary.errorRows} row(s) break the running balance and are pinned to the top of the table. `
            : ''}
          {validation.summary.warningRows > 0 ? `${validation.summary.warningRows} row(s) carry warnings. ` : ''}
          Correct any cell inline and the checks re-run immediately.
        </p>
      </div>
    </div>
  );
}
