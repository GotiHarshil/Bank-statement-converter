import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const axisSavingsV1: BankTemplate = {
  id: 'axis-savings-v1',
  bankName: 'Axis Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /axis\s+bank/i, weight: 0.6 },
      { pattern: /\bUTIB0\d{6}\b/, weight: 0.4 },
      { pattern: /tran\s*date/i, weight: 0.25 },
      { pattern: /init\.?\s*br/i, weight: 0.2 },
    ]),
  dateFormats: ['dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /tran\s*date/i,
    narration: /particulars/i,
    refNo: /chq\s*no/i,
    debit: /debit/i,
    credit: /credit/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
