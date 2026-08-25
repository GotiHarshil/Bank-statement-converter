'use client';

import * as React from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type CellContext,
} from '@tanstack/react-table';
import { AlertTriangle, CircleAlert } from 'lucide-react';
import { parseAmount } from '@/lib/parse/parseAmount';
import { isoToDisplay, parseDate } from '@/lib/parse/parseDate';
import { cn } from '@/lib/utils';
import type { RowValidation, Transaction } from '@/lib/schema';

export type EditableField = 'date' | 'valueDate' | 'narration' | 'refNo' | 'debit' | 'credit' | 'balance';

interface TransactionTableProps {
  transactions: Transaction[];
  validationBySerial: Map<number, RowValidation>;
  onEdit: (serial: number, field: EditableField, raw: string) => void;
  /** Rows that fail validation are shown first when true. */
  problemsFirst: boolean;
  highlightedSerial: number | null;
}

const columnHelper = createColumnHelper<Transaction>();

export function TransactionTable({
  transactions,
  validationBySerial,
  onEdit,
  problemsFirst,
  highlightedSerial,
}: TransactionTableProps) {
  const ordered = React.useMemo(() => {
    if (!problemsFirst) return transactions;
    const rank = (t: Transaction) => {
      const status = validationBySerial.get(t.serial)?.status ?? 'ok';
      if (status === 'error') return 0;
      if (status === 'warning') return 1;
      return 2;
    };
    // Stable sort keeps statement order within each severity band.
    return [...transactions].sort((a, b) => rank(a) - rank(b) || a.serial - b.serial);
  }, [transactions, validationBySerial, problemsFirst]);

  const columns = React.useMemo(
    () => [
      columnHelper.accessor('serial', {
        header: '#',
        cell: (ctx) => <span className="text-muted-foreground tabular text-xs">{ctx.getValue()}</span>,
      }),
      columnHelper.accessor('date', {
        header: 'Date',
        cell: (ctx) => <DateCell ctx={ctx} field="date" onEdit={onEdit} />,
      }),
      columnHelper.accessor('valueDate', {
        header: 'Value date',
        cell: (ctx) => <DateCell ctx={ctx} field="valueDate" onEdit={onEdit} />,
      }),
      columnHelper.accessor('narration', {
        header: 'Narration',
        cell: (ctx) => (
          <TextCell
            value={ctx.getValue()}
            onCommit={(raw) => onEdit(ctx.row.original.serial, 'narration', raw)}
            className="min-w-[22rem]"
          />
        ),
      }),
      columnHelper.accessor('refNo', {
        header: 'Ref no.',
        cell: (ctx) => (
          <TextCell
            value={ctx.getValue() ?? ''}
            onCommit={(raw) => onEdit(ctx.row.original.serial, 'refNo', raw)}
            className="w-32"
          />
        ),
      }),
      columnHelper.accessor('debit', {
        header: () => <span className="block text-right">Debit</span>,
        cell: (ctx) => <AmountCell ctx={ctx} field="debit" onEdit={onEdit} />,
      }),
      columnHelper.accessor('credit', {
        header: () => <span className="block text-right">Credit</span>,
        cell: (ctx) => <AmountCell ctx={ctx} field="credit" onEdit={onEdit} />,
      }),
      columnHelper.accessor('balance', {
        header: () => <span className="block text-right">Balance</span>,
        cell: (ctx) => <AmountCell ctx={ctx} field="balance" onEdit={onEdit} />,
      }),
      columnHelper.display({
        id: 'status',
        header: 'Status',
        cell: (ctx) => <StatusCell validation={validationBySerial.get(ctx.row.original.serial)} row={ctx.row.original} />,
      }),
    ],
    [onEdit, validationBySerial],
  );

  const table = useReactTable({ data: ordered, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/70 sticky top-0 z-10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="text-muted-foreground border-b px-3 py-2 text-left text-xs font-semibold whitespace-nowrap"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const status = validationBySerial.get(row.original.serial)?.status ?? 'ok';
            return (
              <tr
                key={row.id}
                id={`txn-${row.original.serial}`}
                className={cn(
                  'border-b last:border-b-0',
                  status === 'error' && 'bg-destructive/8',
                  status === 'warning' && 'bg-warning/10',
                  highlightedSerial === row.original.serial && 'ring-ring ring-2 ring-inset',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-1.5 py-1 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

const cellClass =
  'w-full rounded border border-transparent bg-transparent px-2 py-1 outline-none hover:border-input focus:border-ring focus:bg-card focus:ring-ring/40 focus:ring-[3px]';

/**
 * Edits commit on blur or Enter rather than on every keystroke, so validation
 * re-runs against a complete value instead of half-typed digits.
 */
function TextCell({
  value,
  onCommit,
  className,
  align,
  invalid,
}: {
  value: string;
  onCommit: (raw: string) => void;
  className?: string;
  align?: 'right';
  invalid?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      aria-invalid={invalid}
      className={cn(
        cellClass,
        align === 'right' && 'tabular text-right',
        invalid && 'border-destructive/60',
        className,
      )}
    />
  );
}

function DateCell({
  ctx,
  field,
  onEdit,
}: {
  ctx: CellContext<Transaction, string | undefined>;
  field: 'date' | 'valueDate';
  onEdit: (serial: number, field: EditableField, raw: string) => void;
}) {
  const iso = ctx.getValue();
  const [invalid, setInvalid] = React.useState(false);

  return (
    <TextCell
      value={iso ? isoToDisplay(iso) : ''}
      invalid={invalid}
      className="w-28"
      onCommit={(raw) => {
        const ok = raw.trim() === '' ? field === 'valueDate' : parseDate(raw) !== null;
        setInvalid(!ok);
        if (ok) onEdit(ctx.row.original.serial, field, raw);
      }}
    />
  );
}

function AmountCell({
  ctx,
  field,
  onEdit,
}: {
  ctx: CellContext<Transaction, number | null>;
  field: 'debit' | 'credit' | 'balance';
  onEdit: (serial: number, field: EditableField, raw: string) => void;
}) {
  const value = ctx.getValue();
  const [invalid, setInvalid] = React.useState(false);

  return (
    <TextCell
      value={value === null || value === undefined ? '' : value.toFixed(2)}
      align="right"
      invalid={invalid}
      className="w-32"
      onCommit={(raw) => {
        const empty = raw.trim() === '';
        const ok = empty ? field !== 'balance' : parseAmount(raw) !== null;
        setInvalid(!ok);
        if (ok) onEdit(ctx.row.original.serial, field, raw);
      }}
    />
  );
}

function StatusCell({ validation, row }: { validation: RowValidation | undefined; row: Transaction }) {
  const messages = [...(validation?.messages ?? []), ...row.issues];
  if (messages.length === 0) {
    return <span className="text-muted-foreground px-2 text-xs">ok</span>;
  }

  const isError = validation?.status === 'error';
  return (
    <div
      className={cn('flex max-w-[26rem] gap-1.5 px-2 text-xs', isError ? 'text-destructive' : 'text-foreground')}
      title={messages.join('\n')}
    >
      {isError ? (
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" />
      )}
      <span>{messages.join(' ')}</span>
    </div>
  );
}
