import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

/**
 * Indian Bank.
 *
 * Detection leans on the IFSC rather than the bank's name, which the statement
 * never prints. Note the code after `IDIB0` is alphanumeric (`IDIB000B854`), not
 * the all-digit form the other templates match.
 *
 * The layout is shared by Indian Bank's savings and cash-credit statements; a
 * cash-credit account marks each balance `DR`, which the parser reads as a
 * negative balance so the ordinary running-balance rule still applies.
 */
export const indianBankV1: BankTemplate = {
  id: 'indian-bank-v1',
  bankName: 'Indian Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /\bIDIB0[A-Z0-9]{6}\b/, weight: 0.75 },
      { pattern: /indian\s+bank/i, weight: 0.2 },
      { pattern: /transaction\s+details/i, weight: 0.1 },
    ]),
  dateFormats: ['MMM dd yyyy', 'dd-MM-yyyy', 'dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /^date$/i,
    narration: /transaction\s*details/i,
    // No reference column: this bank folds the UTR and IMPS ids into the
    // narration rather than printing them separately.
    debit: /^debits?$/i,
    credit: /^credits?$/i,
    balance: /^balance$/i,
  },
  ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
};
