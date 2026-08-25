import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

/**
 * Canara Bank.
 *
 * Column locators cover two layouts the bank issues: the shorter
 * `Txn Date` / `Debit` / `Credit` wording, and the current internet-banking
 * export, which prints `TRANS` / `VALUE` (with "DATE" wrapped onto the line
 * below), a `BRANCH` column, `REF/CHQ.NO`, and `WITHDRAWS` / `DEPOSIT`.
 */
export const canaraSavingsV1: BankTemplate = {
  id: 'canara-savings-v1',
  bankName: 'Canara Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /canara\s+bank/i, weight: 0.65 },
      { pattern: /\bCNRB0\d{6}\b/, weight: 0.35 },
      { pattern: /cheque\s*no|ref\s*\/\s*chq/i, weight: 0.15 },
    ]),
  dateFormats: ['dd-MMM-yy', 'dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /^(?:txn\s*date|trans)$/i,
    valueDate: /^(?:value\s*date|value)$/i,
    narration: /description/i,
    refNo: /cheque\s*no|ref\s*\/\s*chq/i,
    debit: /debit|withdraw/i,
    credit: /credit|deposit/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
