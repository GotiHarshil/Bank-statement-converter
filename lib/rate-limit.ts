/**
 * Per-IP fixed-window rate limiting, held in memory.
 *
 * Sufficient for v1, which has no database. On a multi-instance deployment each
 * instance keeps its own counters, which makes the limit softer but never
 * incorrect — it can only ever allow more, never wrongly reject.
 */

interface Window {
  count: number;
  resetAt: number;
}

const WINDOWS = new Map<string, Window>();

/** Entries are swept lazily; this caps the map if a burst creates many keys. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = WINDOWS.get(key);

  if (!existing || existing.resetAt <= now) {
    if (WINDOWS.size >= MAX_TRACKED_KEYS) sweep(now);
    const fresh: Window = { count: 1, resetAt: now + windowMs };
    WINDOWS.set(key, fresh);
    return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

function sweep(now: number): void {
  for (const [key, window] of WINDOWS) {
    if (window.resetAt <= now) WINDOWS.delete(key);
  }
}

/**
 * Best-effort client address.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that sets it, which is
 * the deployment target here. It is used solely for rate limiting, never logged
 * alongside statement content.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
