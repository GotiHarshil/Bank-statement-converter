import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractDocument } from '@/lib/pdf/extract';
import { assignCells, buildGrid, clusterRows, mergeWrappedRows } from '@/lib/pdf/grid';
import type { GridRow, PageText, TextItem } from '@/lib/schema';

function item(str: string, x: number, y: number, width = str.length * 4.4): TextItem {
  return { str, x, y, width, height: 8, fontSize: 8 };
}

function page(items: TextItem[]): PageText {
  return { pageNumber: 1, width: 595, height: 842, items };
}

function row(cells: string[]): GridRow {
  return { cells, y: 0, pageNumber: 1, items: [] };
}

describe('row clustering', () => {
  it('groups items on the same baseline and orders them left to right', () => {
    const rows = clusterRows(
      page([item('Balance', 400, 100), item('01/04/2024', 32, 100), item('NEFT', 80, 100), item('02/04/2024', 32, 112)]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!.map((i) => i.str)).toEqual(['01/04/2024', 'NEFT', 'Balance']);
    expect(rows[1]!.map((i) => i.str)).toEqual(['02/04/2024']);
  });

  it('tolerates sub-pixel baseline drift within a line', () => {
    const rows = clusterRows(page([item('a', 32, 100), item('b', 80, 100.9), item('c', 120, 101.4)]));
    expect(rows).toHaveLength(1);
  });
});

describe('cell assignment', () => {
  it('places items in the column their left edge falls in', () => {
    const cells = assignCells([item('01/04/2024', 32, 0), item('NEFT PAYMENT', 80, 0), item('1,234.00', 400, 0)], [
      32, 80, 400,
    ]);

    expect(cells).toEqual(['01/04/2024', 'NEFT PAYMENT', '1,234.00']);
  });

  it('keeps a right-aligned amount in its own column whatever its width', () => {
    // Narrow and wide values start at different x but belong to the same column.
    expect(assignCells([item('9.00', 470, 0)], [32, 400, 440])[2]).toBe('9.00');
    expect(assignCells([item('12,34,567.89', 442, 0)], [32, 400, 440])[2]).toBe('12,34,567.89');
  });

  it('joins runs inside a cell without splitting a number', () => {
    // pdf.js often breaks a number into several runs mid-digit.
    const cells = assignCells(
      [item('1,23,', 400, 0, 20), item('456.78', 420, 0, 26)],
      [32, 400],
    );
    expect(cells[1]).toBe('1,23,456.78');
  });

  it('inserts a space where runs are visibly apart', () => {
    const cells = assignCells([item('NEFT', 80, 0, 18), item('PAYMENT', 110, 0, 30)], [32, 80]);
    expect(cells[1]).toBe('NEFT PAYMENT');
  });
});

describe('wrapped narration merge', () => {
  const spec = { dateColumn: 0, amountColumns: [2, 3], textColumns: [1] };

  it('folds a continuation line into the transaction above it', () => {
    const merged = mergeWrappedRows(
      [
        row(['01/04/2024', 'NEFT DR-ICIC0000456-RAMESH', '1,000.00', '5,000.00']),
        row(['', 'KUMAR-RENT APRIL 2024', '', '']),
        row(['02/04/2024', 'SALARY', '', '6,000.00']),
      ],
      spec,
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]!.cells[1]).toBe('NEFT DR-ICIC0000456-RAMESH KUMAR-RENT APRIL 2024');
    expect(merged[0]!.merged).toBe(true);
    expect(merged[1]!.cells[1]).toBe('SALARY');
  });

  it('folds several continuation lines in order', () => {
    const merged = mergeWrappedRows(
      [
        row(['01/04/2024', 'ONE', '', '1.00']),
        row(['', 'TWO', '', '']),
        row(['', 'THREE', '', '']),
      ],
      spec,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]!.cells[1]).toBe('ONE TWO THREE');
  });

  it('does not swallow a repeated page header', () => {
    // The header has content in the date column, which wrapped narration never
    // does. Folding it in would corrupt the transaction's date.
    const merged = mergeWrappedRows(
      [
        row(['01/04/2024', 'NEFT', '', '1.00']),
        row(['Date', 'Narration', 'Debit', 'Balance']),
        row(['02/04/2024', 'SALARY', '', '2.00']),
      ],
      spec,
    );

    expect(merged).toHaveLength(3);
    expect(merged[0]!.cells[0]).toBe('01/04/2024');
    expect(merged[2]!.cells[0]).toBe('02/04/2024');
  });

  it('does not swallow a footer totals line', () => {
    const merged = mergeWrappedRows(
      [
        row(['01/04/2024', 'NEFT', '', '1.00']),
        row(['Opening Balance: 2,53,137.00', '', 'Closing Balance: 34,998.96', '']),
      ],
      spec,
    );

    expect(merged[0]!.cells[0]).toBe('01/04/2024');
    expect(merged[0]!.cells[1]).toBe('NEFT');
  });

  it('folds a continuation that carries the transaction time under the date', () => {
    // Union Bank and others print the time on the line below the date. That row
    // is part of the same transaction, and the time must not land in narration.
    const merged = mergeWrappedRows(
      [
        row(['02-04-2025', 'IMPSAR/5092146503', '', '9,000.00']),
        row(['14:06:13', '30/Kamleshbhai', '', '']),
        row(['', 'Ashokb/20144833439', '', '']),
        row(['03-04-2025', 'NEXT TXN', '', '1.00']),
      ],
      spec,
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]!.cells[0]).toBe('02-04-2025');
    expect(merged[0]!.cells[1]).toBe('IMPSAR/5092146503 30/Kamleshbhai Ashokb/20144833439');
    expect(merged[0]!.cells[1]).not.toContain('14:06:13');
  });

  it('records the printed line structure for exporters that need it', () => {
    const merged = mergeWrappedRows(
      [
        row(['02-04-2025', 'ATM-CASH-', '', '9,000.00']),
        row(['', 'AXIS/DPRH293401/9069', '', '']),
      ],
      spec,
    );

    expect(merged[0]!.sourceLines?.map((line) => line[1])).toEqual(['ATM-CASH-', 'AXIS/DPRH293401/9069']);
  });

  it('leaves rows before the band untouched', () => {
    const merged = mergeWrappedRows(
      [row(['', 'BANK NAME', '', '']), row(['01/04/2024', 'NEFT', '', '1.00'])],
      { ...spec, startIndex: 1 },
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]!.cells[1]).toBe('BANK NAME');
  });
});

describe('grid reconstruction on a real PDF', () => {
  it('recovers the HDFC column layout', async () => {
    const doc = await extractDocument(
      new Uint8Array(readFileSync(join(process.cwd(), '__tests__', 'fixtures', 'hdfc-savings-v1.pdf'))),
    );
    const grid = buildGrid(doc.pages);

    expect(grid.columnCount).toBe(7);
    expect(grid.columnEdges).toEqual([...grid.columnEdges].sort((a, b) => a - b));

    const header = grid.rows.find((r) => r.cells[0]?.trim() === 'Date');
    expect(header?.cells).toEqual([
      'Date',
      'Narration',
      'Chq./Ref.No.',
      'Value Dt',
      'Withdrawal Amt.',
      'Deposit Amt.',
      'Closing Balance',
    ]);
  });
});
