import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const idfcFirstSavingsV1: BankTemplate = {
  id: 'idfc-first-savings-v1',
  bankName: 'IDFC FIRST Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /idfc\s+first\s+bank/i, weight: 0.65 },
      { pattern: /\bIDFB0\d{6}\b/, weight: 0.35 },
      { pattern: /particulars/i, weight: 0.1 },
    ]),
  dateFormats: ['dd-MMM-yyyy', 'dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /transaction\s*date/i,
    valueDate: /value\s*date/i,
    narration: /particulars/i,
    refNo: /cheque\s*no/i,
    debit: /debit/i,
    credit: /credit/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
