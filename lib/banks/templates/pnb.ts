import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const pnbSavingsV1: BankTemplate = {
  id: 'pnb-savings-v1',
  bankName: 'Punjab National Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /punjab\s+national\s+bank/i, weight: 0.6 },
      { pattern: /\bPUNB0\d{6}\b/, weight: 0.4 },
      { pattern: /instrument\s*id/i, weight: 0.3 },
    ]),
  dateFormats: ['dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'amount-plus-flag',
  columns: {
    date: /txn\s*date/i,
    narration: /particulars/i,
    refNo: /instrument\s*id/i,
    amount: /amount/i,
    drCrFlag: /type/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
