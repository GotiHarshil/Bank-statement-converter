import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const hdfcSavingsV1: BankTemplate = {
  id: 'hdfc-savings-v1',
  bankName: 'HDFC Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /hdfc\s+bank/i, weight: 0.6 },
      { pattern: /\bHDFC0\d{6}\b/, weight: 0.4 },
      { pattern: /chq\.?\s*\/\s*ref\.?\s*no/i, weight: 0.25 },
      { pattern: /withdrawal\s+amt/i, weight: 0.2 },
    ]),
  dateFormats: ['dd/MM/yy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /^date/i,
    valueDate: /value\s*dt/i,
    narration: /narration/i,
    refNo: /chq.*ref.*no/i,
    debit: /withdrawal/i,
    credit: /deposit/i,
    balance: /closing\s*balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
