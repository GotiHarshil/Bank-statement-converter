import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const sbiSavingsV1: BankTemplate = {
  id: 'sbi-savings-v1',
  bankName: 'State Bank of India',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /state\s+bank\s+of\s+india/i, weight: 0.6 },
      { pattern: /\bSBIN0\d{6}\b/, weight: 0.4 },
      { pattern: /ref\s*no\.?\s*\/\s*cheque\s*no/i, weight: 0.25 },
    ]),
  dateFormats: ['dd MMM yyyy', 'dd-MMM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /txn\s*date/i,
    valueDate: /value\s*date/i,
    narration: /description/i,
    refNo: /ref\s*no/i,
    debit: /debit/i,
    credit: /credit/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
