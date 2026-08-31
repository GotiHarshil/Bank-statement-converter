'use client';

import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, MinusCircle, Wallet, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
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
    <div className="animate-slide-up space-y-4">
      <Card
        className={cn(
          'flex flex-col items-start justify-between gap-4 border p-5 sm:flex-row sm:items-center',
          validation.ok ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5',
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              validation.ok ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground',
            )}
          >
            {validation.ok ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
          </div>
          <div>
            <p className="text-sm font-semibold">
              {validation.ok ? 'Statement fully reconciled' : 'Reconciliation issues found'}
            </p>
            <p className="text-muted-foreground text-xs">
              {validation.ok
                ? `Every one of ${summary.transactionCount} transactions follows from the balance before it.`
                : `${summary.errorRows} row(s) break the running balance — review before exporting.`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:text-right">
          <p className="text-xs">
            <span className="font-medium">{meta.bankName}</span>
            <span className="text-muted-foreground"> · {meta.accountNumberMasked ?? 'account not stated'}</span>
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Opening balance" value={summary.openingBalance} icon={Wallet} />
        <StatTile label="Total credits" value={summary.totalCredits} icon={ArrowUpRight} tone="success" prefix="+" />
        <StatTile label="Total debits" value={summary.totalDebits} icon={ArrowDownRight} tone="destructive" prefix="−" />
        <StatTile label="Closing balance" value={summary.closingBalance} icon={Wallet} emphasize />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Statement details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Row label="Period" value={meta.periodFrom && meta.periodTo ? `${meta.periodFrom} → ${meta.periodTo}` : 'not stated'} />
              <Row label="Pages" value={String(meta.pageCount)} />
              <Row label="Transactions" value={String(summary.transactionCount)} />
              <Row label="Parsed by" value={meta.parsedBy === 'template' ? `Template · ${meta.templateId}` : 'AI-assisted mapping'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Verification checks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {validation.checks.map((check) => (
              <div key={check.id} className="flex gap-2.5 text-sm">
                <CheckIcon status={check.status} />
                <div className="min-w-0">
                  <p className="font-medium">{check.label}</p>
                  <p className="text-muted-foreground text-xs">{check.detail}</p>
                  {check.offendingRows.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-muted-foreground text-xs">Rows:</span>
                      {check.offendingRows.slice(0, 12).map((serial) => (
                        <button
                          key={serial}
                          type="button"
                          onClick={() => onJumpToRow(serial)}
                          className="text-destructive hover:bg-destructive/10 rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors"
                        >
                          #{serial}
                        </button>
                      ))}
                      {check.offendingRows.length > 12 && (
                        <span className="text-muted-foreground text-xs">+{check.offendingRows.length - 12} more</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
  prefix,
  emphasize,
}: {
  label: string;
  value: number | null;
  icon: typeof Wallet;
  tone?: 'success' | 'destructive';
  prefix?: string;
  emphasize?: boolean;
}) {
  return (
    <Card className={cn('p-4', emphasize && 'border-primary/30 bg-primary/5')}>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        <Icon
          className={cn(
            'size-3.5',
            tone === 'success' && 'text-success',
            tone === 'destructive' && 'text-destructive',
            !tone && 'text-muted-foreground',
          )}
        />
      </div>
      <p
        className={cn(
          'tabular mt-1.5 text-lg font-semibold',
          tone === 'success' && 'text-success',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value === null ? '—' : `${prefix ?? ''}${formatInr(value)}`}
      </p>
    </Card>
  );
}

function CheckIcon({ status }: { status: 'pass' | 'fail' | 'skipped' }) {
  if (status === 'pass') return <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />;
  if (status === 'fail') return <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />;
  return <MinusCircle className="text-muted-foreground mt-0.5 size-4 shrink-0" />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function IssueBanner({ validation }: { validation: ValidationReport }) {
  if (validation.ok && validation.summary.warningRows === 0) return null;

  return (
    <div className="border-warning/45 bg-warning/10 animate-slide-up flex gap-3 rounded-xl border p-4 text-sm">
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
