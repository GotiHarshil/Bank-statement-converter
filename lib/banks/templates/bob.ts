import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const bobSavingsV1: BankTemplate = {
  id: 'bob-savings-v1',
  bankName: 'Bank of Baroda',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /bank\s+of\s+baroda/i, weight: 0.65 },
      { pattern: /\bBARB0\w{6}\b/, weight: 0.35 },
      { pattern: /statement\s+of\s+transactions/i, weight: 0.2 },
    ]),
  dateFormats: ['dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /tran\s*date/i,
    narration: /narration/i,
    refNo: /chq\s*\/\s*ref\s*no/i,
    debit: /debit/i,
    credit: /credit/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
