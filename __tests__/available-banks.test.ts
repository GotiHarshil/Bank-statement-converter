import { describe, expect, it } from 'vitest';
import { LEARNED_TEMPLATE_HINT_PREFIX, mergeAvailableBanks } from '@/lib/banks/available';
import { BANK_TEMPLATES } from '@/lib/banks/registry';
import type { StoredTemplate } from '@/lib/banks/learned/store';

/**
 * `mergeAvailableBanks` is what turns "shipped templates + learned templates"
 * into the list the UI shows and the bank-hint dropdown offers. The dedup
 * rules matter because `StoredTemplate.bankName` is free text straight from
 * the model with no canonicalisation — the same real bank can be learned
 * twice under slightly different name strings, and that must never look like
 * two different banks in the UI.
 */

function stored(overrides: Partial<StoredTemplate> = {}): StoredTemplate {
  return {
    key: 'fingerprint-1',
    bankName: 'Zenith Cooperative Bank',
    dateFormats: ['dd-MM-yyyy'],
    amountStyle: 'separate-dr-cr',
    columns: { date: 'Date', narration: 'Particulars', balance: 'Balance' },
    learnedAt: '2026-01-01T00:00:00.000Z',
    timesUsed: 1,
    ...overrides,
  };
}

describe('mergeAvailableBanks', () => {
  it('always includes every shipped bank as builtin', () => {
    const options = mergeAvailableBanks(BANK_TEMPLATES, []);

    expect(options).toHaveLength(BANK_TEMPLATES.length);
    for (const template of BANK_TEMPLATES) {
      expect(options).toContainEqual({ id: template.id, bankName: template.bankName, source: 'builtin' });
    }
  });

  it('adds a genuinely new learned bank with a prefixed id', () => {
    const learned = stored({ key: 'abc123', bankName: 'Zenith Cooperative Bank' });
    const options = mergeAvailableBanks(BANK_TEMPLATES, [learned]);

    expect(options).toContainEqual({
      id: `${LEARNED_TEMPLATE_HINT_PREFIX}abc123`,
      bankName: 'Zenith Cooperative Bank',
      source: 'learned',
    });
    expect(options).toHaveLength(BANK_TEMPLATES.length + 1);
  });

  it('drops a learned bank whose name matches a shipped one, case- and whitespace-insensitively', () => {
    const shippedName = BANK_TEMPLATES[0]!.bankName;
    const learned = stored({ key: 'dupe', bankName: `  ${shippedName.toUpperCase()}  ` });

    const options = mergeAvailableBanks(BANK_TEMPLATES, [learned]);

    expect(options).toHaveLength(BANK_TEMPLATES.length);
    expect(options.some((o) => o.id === `${LEARNED_TEMPLATE_HINT_PREFIX}dupe`)).toBe(false);
  });

  it('collapses two learned entries for the same bank, keeping the newest', () => {
    // `list()` returns newest-first, so the first element here is the one that should survive.
    const newer = stored({ key: 'newer', bankName: 'Zenith Cooperative Bank', learnedAt: '2026-02-01T00:00:00.000Z' });
    const older = stored({ key: 'older', bankName: 'zenith cooperative bank', learnedAt: '2026-01-01T00:00:00.000Z' });

    const options = mergeAvailableBanks(BANK_TEMPLATES, [newer, older]);

    const zenithEntries = options.filter((o) => o.bankName.toLowerCase() === 'zenith cooperative bank');
    expect(zenithEntries).toHaveLength(1);
    expect(zenithEntries[0]!.id).toBe(`${LEARNED_TEMPLATE_HINT_PREFIX}newer`);
  });

  it('keeps two learned banks with genuinely different names', () => {
    const a = stored({ key: 'a', bankName: 'Zenith Cooperative Bank' });
    const b = stored({ key: 'b', bankName: 'Local Merchant Bank' });

    const options = mergeAvailableBanks(BANK_TEMPLATES, [a, b]);

    expect(options).toHaveLength(BANK_TEMPLATES.length + 2);
  });
});
