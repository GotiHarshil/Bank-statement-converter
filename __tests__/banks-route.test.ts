import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/banks/route';
import { InMemoryTemplateStore } from '@/lib/banks/learned/memory';
import { setTemplateStore } from '@/lib/banks/learned/hydrate';
import { LEARNED_TEMPLATE_HINT_PREFIX } from '@/lib/banks/available';
import { BANK_TEMPLATES } from '@/lib/banks/registry';
import type { StoredTemplate } from '@/lib/banks/learned/store';
import type { BanksResponse } from '@/app/api/banks/route';

/**
 * A Next.js route handler is just an async function over `Request`/`Response`
 * — invoked directly here, no server needed. This exercises the whole route,
 * not just the pure merge function `available-banks.test.ts` already covers.
 */

let store: InMemoryTemplateStore;

beforeEach(() => {
  store = new InMemoryTemplateStore();
  setTemplateStore(store);
});

afterEach(() => {
  setTemplateStore(null);
});

function request(): Request {
  return new Request('http://localhost/api/banks');
}

describe('GET /api/banks', () => {
  it('returns only the shipped banks when nothing has been learned', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);

    const body = (await res.json()) as BanksResponse;
    expect(body.banks).toHaveLength(BANK_TEMPLATES.length);
    expect(body.banks.every((b) => b.source === 'builtin')).toBe(true);
  });

  it('includes a learned bank alongside the shipped ones', async () => {
    const entry: StoredTemplate = {
      key: 'fp-1',
      bankName: 'Zenith Cooperative Bank',
      dateFormats: ['dd-MM-yyyy'],
      amountStyle: 'separate-dr-cr',
      columns: { date: 'Date', narration: 'Particulars', balance: 'Balance' },
      learnedAt: new Date().toISOString(),
      timesUsed: 1,
    };
    await store.put(entry);

    const res = await GET(request());
    const body = (await res.json()) as BanksResponse;

    expect(body.banks).toHaveLength(BANK_TEMPLATES.length + 1);
    expect(body.banks).toContainEqual({
      id: `${LEARNED_TEMPLATE_HINT_PREFIX}fp-1`,
      bankName: 'Zenith Cooperative Bank',
      source: 'learned',
    });
  });

  it('degrades to the shipped-only list if the store throws', async () => {
    setTemplateStore({
      get: () => Promise.reject(new Error('unreachable')),
      put: () => Promise.reject(new Error('unreachable')),
      delete: () => Promise.reject(new Error('unreachable')),
      list: () => Promise.reject(new Error('unreachable')),
    });

    const res = await GET(request());
    expect(res.status).toBe(200);

    const body = (await res.json()) as BanksResponse;
    expect(body.banks).toHaveLength(BANK_TEMPLATES.length);
  });
});
