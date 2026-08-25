import { formatDate, inr, type LedgerEntry } from './ledger';
import type { ColumnSpec } from './render-statement';

/**
 * Layout definitions for the synthetic fixtures — one per shipped bank
 * template. Column order, header wording and amount styling mirror the real
 * statements each bank issues, so a fixture that parses is genuine evidence
 * the template works.
 */

export type AmountStyle = 'separate-dr-cr' | 'signed-single' | 'amount-plus-flag';

export interface FixtureSpec {
  id: string;
  bankName: string;
  dateFormat: string;
  amountStyle: AmountStyle;
  landscape?: boolean;
  password?: string;
  columns: ColumnSpec[];
  headerLines: string[];
  subHeader: string;
  /** Builds the cells for one ledger entry, aligned with `columns`. */
  row(entry: LedgerEntry, index: number, dateFormat: string): string[];
  footer(opening: number, closing: number, debits: number, credits: number, count: number): string[];
}

const L = (label: string, x: number, width: number): ColumnSpec => ({ label, x, width, align: 'left' });
const R = (label: string, x: number, width: number): ColumnSpec => ({ label, x, width, align: 'right' });

const ACCOUNT_LINE = 'Account No: 50100234567891   IFSC: {IFSC}   Branch: Andheri East, Mumbai 400069';
const NAME_LINE = 'ARJUN MEHTA & ASSOCIATES';

function commonFooter(opening: number, closing: number, debits: number, credits: number, count: number): string[] {
  return [
    `Opening Balance: ${inr(opening)}    Closing Balance: ${inr(closing)}`,
    `Total Withdrawals: ${inr(debits)}    Total Deposits: ${inr(credits)}`,
    `Total: ${count} transactions`,
    'This is a computer generated statement and does not require a signature.',
  ];
}

export const FIXTURE_SPECS: FixtureSpec[] = [
  {
    id: 'hdfc-savings-v1',
    bankName: 'HDFC Bank',
    dateFormat: 'dd/MM/yy',
    amountStyle: 'separate-dr-cr',
    password: 'ARJU1990',
    columns: [
      L('Date', 32, 40),
      L('Narration', 76, 170),
      L('Chq./Ref.No.', 250, 50),
      L('Value Dt', 304, 42),
      R('Withdrawal Amt.', 350, 66),
      R('Deposit Amt.', 420, 66),
      R('Closing Balance', 490, 72),
    ],
    headerLines: [
      'HDFC BANK LIMITED',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'HDFC0000123'),
      'Statement of Account for the period 01/04/2024 to 30/06/2024',
    ],
    subHeader: 'HDFC BANK - Statement of Account (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      e.narration,
      e.refNo,
      formatDate(e.valueDate, f),
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'sbi-savings-v1',
    bankName: 'State Bank of India',
    dateFormat: 'dd MMM yyyy',
    amountStyle: 'separate-dr-cr',
    columns: [
      L('Txn Date', 32, 50),
      L('Value Date', 86, 50),
      L('Description', 140, 150),
      L('Ref No./Cheque No.', 294, 78),
      R('Debit', 376, 60),
      R('Credit', 440, 60),
      R('Balance', 504, 64),
    ],
    headerLines: [
      'STATE BANK OF INDIA',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'SBIN0001234'),
      'Account Statement from 01 Apr 2024 to 30 Jun 2024',
    ],
    subHeader: 'STATE BANK OF INDIA - Account Statement (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      formatDate(e.valueDate, f),
      e.narration,
      e.refNo,
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'icici-savings-v1',
    bankName: 'ICICI Bank',
    dateFormat: 'dd/MM/yyyy',
    amountStyle: 'separate-dr-cr',
    landscape: true,
    columns: [
      L('S No.', 30, 26),
      L('Value Date', 60, 48),
      L('Transaction Date', 112, 66),
      L('Cheque Number', 182, 64),
      L('Transaction Remarks', 250, 280),
      R('Withdrawal Amount (INR)', 534, 98),
      R('Deposit Amount (INR)', 636, 86),
      R('Balance (INR)', 726, 80),
    ],
    headerLines: [
      'ICICI BANK LIMITED',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'ICIC0000456'),
      'Detailed Statement 01/04/2024 - 30/06/2024',
    ],
    subHeader: 'ICICI BANK - Detailed Statement (continued)',
    row: (e, i, f) => [
      String(i + 1),
      formatDate(e.valueDate, f),
      formatDate(e.date, f),
      e.refNo,
      e.narration,
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'axis-savings-v1',
    bankName: 'Axis Bank',
    dateFormat: 'dd-MM-yyyy',
    amountStyle: 'separate-dr-cr',
    columns: [
      L('Tran Date', 32, 48),
      L('Chq No', 84, 46),
      L('Particulars', 134, 160),
      R('Debit', 298, 60),
      R('Credit', 362, 60),
      R('Balance', 426, 64),
      L('Init.Br', 494, 30),
    ],
    headerLines: [
      'AXIS BANK LTD',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'UTIB0000789'),
      'Statement of Account 01-04-2024 to 30-06-2024',
    ],
    subHeader: 'AXIS BANK - Statement of Account (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      e.refNo,
      e.narration,
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
      'MUM',
    ],
    footer: commonFooter,
  },
  {
    id: 'kotak-savings-v1',
    bankName: 'Kotak Mahindra Bank',
    dateFormat: 'dd-MM-yyyy',
    amountStyle: 'signed-single',
    columns: [
      L('Date', 32, 48),
      L('Narration', 84, 180),
      L('Chq/Ref No', 268, 50),
      R('Withdrawal(Dr)/Deposit(Cr)', 322, 106),
      R('Balance', 432, 70),
    ],
    headerLines: [
      'KOTAK MAHINDRA BANK LIMITED',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'KKBK0000321'),
      'Statement Period 01-04-2024 to 30-06-2024',
    ],
    subHeader: 'KOTAK MAHINDRA BANK - Statement (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      e.narration,
      e.refNo,
      e.debit === null ? `${inr(e.credit ?? 0)}(Cr)` : `${inr(e.debit)}(Dr)`,
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'pnb-savings-v1',
    bankName: 'Punjab National Bank',
    dateFormat: 'dd-MM-yyyy',
    amountStyle: 'amount-plus-flag',
    columns: [
      L('Txn Date', 32, 48),
      L('Instrument Id', 84, 54),
      L('Particulars', 142, 170),
      R('Amount', 316, 64),
      L('Type', 384, 24),
      R('Balance', 412, 70),
    ],
    headerLines: [
      'PUNJAB NATIONAL BANK',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'PUNB0123456'),
      'Statement of Account 01-04-2024 to 30-06-2024',
    ],
    subHeader: 'PUNJAB NATIONAL BANK - Statement of Account (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      e.refNo,
      e.narration,
      inr(e.debit ?? e.credit ?? 0),
      e.debit === null ? 'Cr' : 'Dr',
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'bob-savings-v1',
    bankName: 'Bank of Baroda',
    dateFormat: 'dd-MM-yyyy',
    amountStyle: 'separate-dr-cr',
    columns: [
      L('Tran Date', 32, 48),
      L('Narration', 84, 180),
      L('Chq/Ref No', 268, 50),
      R('Debit', 322, 62),
      R('Credit', 388, 62),
      R('Balance', 454, 68),
    ],
    headerLines: [
      'BANK OF BARODA',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'BARB0ANDHER'),
      'Statement of Transactions 01-04-2024 to 30-06-2024',
    ],
    subHeader: 'BANK OF BARODA - Statement of Transactions (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      e.narration,
      e.refNo,
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'canara-savings-v1',
    bankName: 'Canara Bank',
    dateFormat: 'dd-MM-yyyy',
    amountStyle: 'separate-dr-cr',
    columns: [
      L('Txn Date', 32, 48),
      L('Value Date', 84, 48),
      L('Description', 136, 150),
      L('Cheque No', 290, 48),
      R('Debit', 342, 62),
      R('Credit', 408, 62),
      R('Balance', 474, 68),
    ],
    headerLines: [
      'CANARA BANK',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'CNRB0001234'),
      'Statement of Account 01-04-2024 to 30-06-2024',
    ],
    subHeader: 'CANARA BANK - Statement of Account (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      formatDate(e.valueDate, f),
      e.narration,
      e.refNo,
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'union-savings-v1',
    bankName: 'Union Bank of India',
    dateFormat: 'dd/MM/yyyy',
    amountStyle: 'separate-dr-cr',
    columns: [
      L('Date', 32, 48),
      L('Description', 84, 180),
      L('Cheque/Ref No', 268, 60),
      R('Withdrawals', 332, 64),
      R('Deposits', 400, 64),
      R('Balance', 468, 68),
    ],
    headerLines: [
      'UNION BANK OF INDIA',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'UBIN0812345'),
      'Statement of Account 01/04/2024 to 30/06/2024',
    ],
    subHeader: 'UNION BANK OF INDIA - Statement of Account (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      e.narration,
      e.refNo,
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
    ],
    footer: commonFooter,
  },
  {
    id: 'idfc-first-savings-v1',
    bankName: 'IDFC FIRST Bank',
    dateFormat: 'dd-MMM-yyyy',
    amountStyle: 'separate-dr-cr',
    columns: [
      L('Transaction Date', 32, 68),
      L('Value Date', 104, 52),
      L('Particulars', 160, 140),
      L('Cheque No', 304, 48),
      R('Debit', 356, 62),
      R('Credit', 422, 62),
      R('Balance', 488, 68),
    ],
    headerLines: [
      'IDFC FIRST BANK LIMITED',
      NAME_LINE,
      ACCOUNT_LINE.replace('{IFSC}', 'IDFB0040101'),
      'Account Statement 01-Apr-2024 to 30-Jun-2024',
    ],
    subHeader: 'IDFC FIRST BANK - Account Statement (continued)',
    row: (e, _i, f) => [
      formatDate(e.date, f),
      formatDate(e.valueDate, f),
      e.narration,
      e.refNo,
      e.debit === null ? '' : inr(e.debit),
      e.credit === null ? '' : inr(e.credit),
      inr(e.balance),
    ],
    footer: commonFooter,
  },
];
