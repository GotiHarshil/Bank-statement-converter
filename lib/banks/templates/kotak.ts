import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const kotakSavingsV1: BankTemplate = {
  id: 'kotak-savings-v1',
  bankName: 'Kotak Mahindra Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /kotak\s+mahindra/i, weight: 0.6 },
      { pattern: /\bKKBK0\d{6}\b/, weight: 0.4 },
      { pattern: /withdrawal\(dr\)\s*\/\s*deposit\(cr\)/i, weight: 0.35 },
    ]),
  dateFormats: ['dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'signed-single',
  columns: {
    date: /^date/i,
    narration: /narration/i,
    refNo: /chq\s*\/\s*ref\s*no/i,
    amount: /withdrawal/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
