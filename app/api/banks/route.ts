import { NextResponse } from 'next/server';
import { BANK_TEMPLATES } from '@/lib/banks/registry';
import { templateStore } from '@/lib/banks/learned/hydrate';
import { mergeAvailableBanks, type BankOption } from '@/lib/banks/available';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Generous — this is a cheap, read-only, non-sensitive response, and every
// page load calls it once.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export interface BanksResponse {
  banks: BankOption[];
}

export async function GET(request: Request): Promise<Response> {
  const limit = rateLimit(`banks:${clientKey(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { banks: [] } satisfies BanksResponse,
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  // A learned-store outage must never take the upload page down with it —
  // degrade to just the shipped banks instead of failing the request.
  const learned = await templateStore()
    .list(200)
    .catch(() => []);

  const banks = mergeAvailableBanks(BANK_TEMPLATES, learned);

  return NextResponse.json(
    { banks } satisfies BanksResponse,
    // Bank names only, nothing sensitive — safe to cache briefly and take load off the store.
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  );
}
