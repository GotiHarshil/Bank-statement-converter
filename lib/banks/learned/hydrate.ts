import type { BankTemplate, ColumnLocator } from '@/lib/banks/registry';
import type { StoredTemplate } from '@/lib/banks/learned/store';
import { InMemoryTemplateStore } from '@/lib/banks/learned/memory';
import { hasUpstashCredentials, UpstashTemplateStore } from '@/lib/banks/learned/upstash';
import type { LearnedTemplateStore } from '@/lib/banks/learned/store';

/** Matches the whole header cell, ignoring case and surrounding whitespace. */
function headerLocator(label: string): ColumnLocator {
  return new RegExp(`^\\s*${escapeRegex(label)}\\s*$`, 'i');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turns a stored record back into an ordinary `BankTemplate`.
 *
 * The result goes through exactly the same header-matching and parsing path as
 * a hand-written template — a learned layout is not a special case downstream.
 * `detect` always scores 0: a learned template is reached by fingerprint lookup,
 * never by scanning the cover page.
 */
export function hydrateTemplate(stored: StoredTemplate): BankTemplate {
  const { columns } = stored;
  const optional = (label: string | undefined) => (label ? headerLocator(label) : undefined);

  return {
    id: `learned-${stored.key.slice(0, 8)}`,
    bankName: stored.bankName,
    detect: () => 0,
    dateFormats: stored.dateFormats,
    amountStyle: stored.amountStyle,
    columns: {
      date: headerLocator(columns.date),
      valueDate: optional(columns.valueDate),
      narration: headerLocator(columns.narration),
      refNo: optional(columns.refNo),
      debit: optional(columns.debit),
      credit: optional(columns.credit),
      amount: optional(columns.amount),
      drCrFlag: optional(columns.drCrFlag),
      balance: headerLocator(columns.balance),
    },
    ignoreRow: /^(?:opening\s+balance|balance\s+(?:b\/f|brought\s+forward)|b\/f)/i,
  };
}

let store: LearnedTemplateStore | null = null;

/**
 * The process-wide store: Redis when credentials are present, otherwise an
 * in-process map. Resolved once and reused.
 */
export function templateStore(): LearnedTemplateStore {
  if (!store) {
    store = hasUpstashCredentials() ? new UpstashTemplateStore() : new InMemoryTemplateStore();
  }
  return store;
}

/** Test seam — lets a suite substitute a store or reset between cases. */
export function setTemplateStore(next: LearnedTemplateStore | null): void {
  store = next;
}
