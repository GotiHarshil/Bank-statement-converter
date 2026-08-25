import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

/**
 * Union Bank of India.
 *
 * The column locators cover both layouts the bank issues: the older
 * `Description` / `Cheque/Ref No` wording, and the current internet-banking
 * export which uses `Remarks` / `Tran Id-1` / `UTR Number` and prints the
 * transaction time beneath the date.
 */
export const unionSavingsV1: BankTemplate = {
  id: 'union-savings-v1',
  bankName: 'Union Bank of India',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /union\s+bank\s+of\s+india/i, weight: 0.65 },
      { pattern: /\bUBIN0\d{6}\b/, weight: 0.35 },
      { pattern: /withdrawals/i, weight: 0.15 },
    ]),
  dateFormats: ['dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /^date/i,
    narration: /remarks|description|particulars/i,
    refNo: /tran\s*id|cheque\s*\/\s*ref\s*no/i,
    debit: /withdrawal/i,
    credit: /deposit/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
