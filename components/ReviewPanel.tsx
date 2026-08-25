'use client';

import * as React from 'react';
import { Download, Info, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IssueBanner, SummaryCard } from '@/components/SummaryCard';
import { TransactionTable, type EditableField } from '@/components/TransactionTable';
import { parseAmount, round2 } from '@/lib/parse/parseAmount';
import { parseDate } from '@/lib/parse/parseDate';
import { validate } from '@/lib/validate/reconcile';
import type { StatementMeta, Transaction, ValidationReport } from '@/lib/schema';

interface ReviewPanelProps {
  initialTransactions: Transaction[];
  meta: StatementMeta;
  initialValidation: ValidationReport;
  notices: string[];
  /** Ledger code entered on the upload form; editable here before export. */
  initialBankCode: string;
  onStartOver: () => void;
}

export function ReviewPanel({
  initialTransactions,
  meta,
  initialValidation,
  notices,
  initialBankCode,
  onStartOver,
}: ReviewPanelProps) {
  const [transactions, setTransactions] = React.useState(initialTransactions);
  const [problemsFirst, setProblemsFirst] = React.useState(true);
  const [highlighted, setHighlighted] = React.useState<number | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [bankCode, setBankCode] = React.useState(initialBankCode);

  // Validation is derived, so every inline edit re-checks the whole chain.
  const validation = React.useMemo(() => {
    if (transactions === initialTransactions) return initialValidation;
    return validate(transactions, {
      openingBalance: meta.openingBalance,
      closingBalance: meta.closingBalance,
      statedTransactionCount: meta.statedTransactionCount,
    });
  }, [transactions, initialTransactions, initialValidation, meta]);

  const validationBySerial = React.useMemo(
    () => new Map(validation.rows.map((row) => [row.serial, row])),
    [validation],
  );

  const handleEdit = React.useCallback((serial: number, field: EditableField, raw: string) => {
    setTransactions((current) =>
      current.map((t) => (t.serial === serial ? applyEdit(t, field, raw) : t)),
    );
  }, []);

  const jumpToRow = React.useCallback((serial: number) => {
    setHighlighted(serial);
    document.getElementById(`txn-${serial}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  async function download(format: string) {
    setDownloading(format);
    setExportError(null);
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, transactions, meta, options: { bankCode: bankCode.trim() } }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The export could not be generated.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFrom(response.headers.get('Content-Disposition')) ?? `statement.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'The export could not be generated.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      <SummaryCard meta={meta} validation={validation} onJumpToRow={jumpToRow} />

      {notices.length > 0 && (
        <Alert>
          <Info className="size-4 shrink-0" />
          <AlertDescription>
            <ul className="space-y-1">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <IssueBanner validation={validation} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="problems-first"
            checked={problemsFirst}
            onCheckedChange={(v) => setProblemsFirst(v === true)}
          />
          <Label htmlFor="problems-first" className="cursor-pointer font-normal">
            Show rows that failed validation first
          </Label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={onStartOver}>
            <RotateCcw className="size-4" /> Convert another
          </Button>

          <div className="flex items-center gap-1.5">
            <Label htmlFor="export-bank-code" className="text-muted-foreground font-normal">
              Bank code
            </Label>
            <Input
              id="export-bank-code"
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value.toUpperCase())}
              placeholder="AXISBB"
              spellCheck={false}
              maxLength={32}
              className="h-9 w-28 font-mono text-xs"
            />
          </div>

          <Button
            variant="outline"
            onClick={() => download('ledger-csv')}
            disabled={downloading !== null || bankCode.trim() === ''}
            title={bankCode.trim() === '' ? 'Enter a bank code to enable the accounting import' : undefined}
          >
            <Download className="size-4" /> {downloading === 'ledger-csv' ? 'Preparing…' : 'Accounting CSV'}
          </Button>
          <Button variant="outline" onClick={() => download('csv')} disabled={downloading !== null}>
            <Download className="size-4" /> {downloading === 'csv' ? 'Preparing…' : 'CSV'}
          </Button>
          <Button onClick={() => download('xlsx')} disabled={downloading !== null}>
            <Download className="size-4" /> {downloading === 'xlsx' ? 'Preparing…' : 'Excel'}
          </Button>
        </div>
      </div>

      {exportError && (
        <Alert variant="destructive">
          <Info className="size-4 shrink-0" />
          <AlertDescription>{exportError}</AlertDescription>
        </Alert>
      )}

      <TransactionTable
        transactions={transactions}
        validationBySerial={validationBySerial}
        onEdit={handleEdit}
        problemsFirst={problemsFirst}
        highlightedSerial={highlighted}
      />

      <p className="text-muted-foreground text-xs">
        Click any cell to correct it. Dates accept dd/MM/yyyy; amounts accept 1,23,456.78. The running balance is
        re-checked as soon as you leave the cell.
      </p>
    </div>
  );
}

/**
 * Applies one inline edit.
 *
 * Setting a debit clears the credit and vice versa: a single transaction is
 * one or the other, and leaving both populated is precisely the ambiguity the
 * validator exists to catch.
 */
function applyEdit(transaction: Transaction, field: EditableField, raw: string): Transaction {
  const trimmed = raw.trim();

  switch (field) {
    case 'narration':
      // The captured line breaks describe the text the parser read, so a manual
      // correction replaces them rather than leaving the accounting export
      // emitting the superseded wording.
      return { ...transaction, narration: trimmed, narrationLines: [trimmed] };
    case 'refNo':
      return trimmed === ''
        ? omit(transaction, 'refNo')
        : { ...transaction, refNo: trimmed };
    case 'date': {
      const iso = parseDate(trimmed);
      return iso ? { ...transaction, date: iso } : transaction;
    }
    case 'valueDate': {
      if (trimmed === '') return omit(transaction, 'valueDate');
      const iso = parseDate(trimmed);
      return iso ? { ...transaction, valueDate: iso } : transaction;
    }
    case 'balance': {
      const value = parseAmount(trimmed);
      return value === null ? transaction : { ...transaction, balance: round2(value) };
    }
    case 'debit':
    case 'credit': {
      if (trimmed === '') return { ...transaction, [field]: null, issues: withoutEditNote(transaction) };
      const value = parseAmount(trimmed);
      if (value === null) return transaction;
      const magnitude = round2(Math.abs(value));
      return {
        ...transaction,
        debit: field === 'debit' ? magnitude : null,
        credit: field === 'credit' ? magnitude : null,
        confidence: 'high',
        issues: withoutEditNote(transaction),
      };
    }
    default:
      return transaction;
  }
}

/** A cell the user has corrected no longer carries the parser's doubts about it. */
function withoutEditNote(transaction: Transaction): string[] {
  return transaction.issues.filter((issue) => !/marker|flag|both the debit/i.test(issue));
}

function omit(transaction: Transaction, key: 'refNo' | 'valueDate'): Transaction {
  const next = { ...transaction };
  delete next[key];
  return next;
}

function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? null;
}
