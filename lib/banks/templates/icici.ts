import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const iciciSavingsV1: BankTemplate = {
  id: 'icici-savings-v1',
  bankName: 'ICICI Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /icici\s+bank/i, weight: 0.6 },
      { pattern: /\bICIC0\d{6}\b/, weight: 0.4 },
      { pattern: /transaction\s+remarks/i, weight: 0.3 },
    ]),
  dateFormats: ['dd/MM/yyyy', 'dd-MM-yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /transaction\s*date/i,
    valueDate: /value\s*date/i,
    narration: /transaction\s*remarks/i,
    refNo: /cheque\s*number/i,
    debit: /withdrawal\s*amount/i,
    credit: /deposit\s*amount/i,
    balance: /^balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
