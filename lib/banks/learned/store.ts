import type { AmountStyle } from '@/lib/banks/registry';

/**
 * A column mapping that was inferred once by AI and is now reused
 * deterministically for every later statement with the same layout.
 *
 * Privacy: this record holds **column labels only** — the header words the bank
 * prints, plus which field each maps to. No transaction, amount, narration,
 * account number or balance is ever stored. Header labels are generic table
 * headings ("Date", "Withdrawals", "Balance"), not customer data.
 */
export interface StoredTemplate {
  /** Layout fingerprint; see `layoutFingerprint`. */
  key: string;
  bankName: string;
  dateFormats: string[];
  amountStyle: AmountStyle;
  /**
   * Field → header label. Stored as label text rather than a column index so
   * the mapping is resolved by the same header-matching path a hand-written
   * template uses, and survives a statement whose columns land differently.
   */
  columns: {
    date: string;
    valueDate?: string;
    narration: string;
    refNo?: string;
    debit?: string;
    credit?: string;
    amount?: string;
    drCrFlag?: string;
    balance: string;
  };
  /** ISO timestamp of when this layout was first learned. */
  learnedAt: string;
  /** How many statements have been parsed with it, including the first. */
  timesUsed: number;
}

export interface LearnedTemplateStore {
  get(key: string): Promise<StoredTemplate | null>;
  put(template: StoredTemplate): Promise<void>;
  delete(key: string): Promise<void>;
  /** Newest first. For inspecting and curating what has been learned. */
  list(limit?: number): Promise<StoredTemplate[]>;
}
