import type { BankTemplate } from '@/lib/banks/registry';
import type { StoredTemplate } from '@/lib/banks/learned/store';

/**
 * Marks a bank-hint value as referring to a learned template's fingerprint
 * rather than a shipped template's id.
 *
 * Kept here rather than in `lib/banks/learned/hydrate.ts` deliberately: that
 * module pulls in `@upstash/redis`, and this constant needs to be safe to
 * import from client components (`UploadPanel.tsx`) without bundling a Redis
 * client into the browser.
 */
export const LEARNED_TEMPLATE_HINT_PREFIX = 'learned:';

/** One entry in the "available banks" list shown in the UI. */
export interface BankOption {
  /** A shipped template's id, or `learned:<fingerprint>` for a learned one. */
  id: string;
  bankName: string;
  source: 'builtin' | 'learned';
}

/**
 * Merges shipped templates with learned ones into the list the UI shows.
 *
 * A learned entry never displaces a shipped one, and two learned entries that
 * are evidently the same bank collapse into one. Both matter because
 * `StoredTemplate.bankName` is free text straight from the model with no
 * canonicalisation — the same real bank can easily be learned twice under
 * slightly different name strings (a different layout on file, or the model
 * just phrasing it differently), and without deduping that would show up as
 * a duplicate entry, or quietly inflate the "N banks supported" count.
 *
 * `learned` is expected newest-first (what `LearnedTemplateStore.list()`
 * returns), so when two entries collapse, the most recently learned one is
 * the one that's kept.
 */
export function mergeAvailableBanks(shipped: BankTemplate[], learned: StoredTemplate[]): BankOption[] {
  const seen = new Set<string>();
  const options: BankOption[] = [];

  for (const template of shipped) {
    options.push({ id: template.id, bankName: template.bankName, source: 'builtin' });
    seen.add(normalize(template.bankName));
  }

  for (const entry of learned) {
    const key = normalize(entry.bankName);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ id: `${LEARNED_TEMPLATE_HINT_PREFIX}${entry.key}`, bankName: entry.bankName, source: 'learned' });
  }

  return options;
}

function normalize(bankName: string): string {
  return bankName.trim().toLowerCase();
}
