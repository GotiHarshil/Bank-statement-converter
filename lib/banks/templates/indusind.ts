import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

/**
 * IndusInd Bank.
 *
 * Detection leans on the IFSC prefix: the statement header supplied for this
 * template ("Branch IFSC Code: INDB0000023") does not print the bank's name
 * anywhere on the page, the same situation as Indian Bank's template.
 */
export const indusindBankV1: BankTemplate = {
  id: 'indusind-bank-v1',
  bankName: 'IndusInd Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /\bINDB0\d{6}\b/, weight: 0.75 },
      { pattern: /indusind/i, weight: 0.2 },
      { pattern: /chq\s*no\s*\/\s*ref\s*no/i, weight: 0.1 },
    ]),
  dateFormats: ['dd MMM yyyy', 'dd-MM-yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /^date$/i,
    narration: /particulars/i,
    refNo: /chq\s*no\s*\/\s*ref\s*no/i,
    debit: /withdrawal/i,
    credit: /deposit/i,
    balance: /^balance$/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
