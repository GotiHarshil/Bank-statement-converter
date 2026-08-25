/**
 * Amount parsing for Indian bank statements.
 *
 * Every quirk handled here has been observed in the wild: lakh/crore digit
 * grouping (1,23,456.78), trailing Cr/Dr markers, accounting parentheses for
 * negatives, unicode minus signs and dashes, non-breaking spaces from PDF text
 * extraction, and rupee symbols glued onto the number.
 */

export type DrCr = 'Dr' | 'Cr';

export interface ParsedAmount {
  /** Always the signed value: Dr and parentheses both produce a negative. */
  value: number;
  /** Absolute magnitude, which is what a Debit/Credit column wants. */
  magnitude: number;
  /** Explicit marker found on the text, if any. */
  marker: DrCr | null;
  /** True when the text carried a minus, a dash, or accounting parentheses. */
  negative: boolean;
}

/** Whitespace variants PDF extraction leaves behind. */
const SPACE_CHARS = /[\u00A0\u2000-\u200B\u202F\u205F\u3000\s]/g;
/** Unicode minus, en dash, em dash, figure dash, non-breaking hyphen. */
const MINUS_CHARS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
/** Currency noise: rupee sign, "Rs", "Rs.", "INR", "₹". */
const CURRENCY_PREFIX = /^(?:₹|rs\.?|inr|r\.s\.)/i;

/** Placeholders banks print in an empty amount cell. */
const EMPTY_TOKENS = new Set(['', '-', '--', '---', '.', 'nil', 'na', 'n/a', 'null']);

/**
 * Parses one amount cell.
 *
 * Returns `null` for anything that is not unambiguously a number — an empty
 * cell, a placeholder dash, a reference number with slashes, a date. Being
 * strict here is deliberate: a false positive silently invents a transaction
 * amount, which is the worst failure this app can have.
 */
export function parseAmountDetailed(raw: string | null | undefined): ParsedAmount | null {
  if (raw === null || raw === undefined) return null;

  let s = raw.replace(SPACE_CHARS, '').replace(MINUS_CHARS, '-');
  if (EMPTY_TOKENS.has(s.toLowerCase())) return null;

  let negative = false;
  let marker: DrCr | null = null;

  // Parenthesised markers, as Kotak prints them: 5,000.00(Dr). Stripped before
  // the accounting-parentheses rule so the two do not collide.
  const bracketed = s.match(/^\((cr|dr)\)|\((cr|dr)\)$/i);
  if (bracketed) {
    marker = /cr/i.test(bracketed[0]) ? 'Cr' : 'Dr';
    s = s.replace(/^\((?:cr|dr)\)/i, '').replace(/\((?:cr|dr)\)$/i, '');
  }

  // Accounting parentheses: (1,234.00) is -1234.00
  if (/^\((.*)\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Dr/Cr markers, leading or trailing, with or without a dot.
  const markerMatch = s.match(/^(cr|dr)\.?|(cr|dr)\.?$/i);
  if (markerMatch) {
    marker = /^cr/i.test(markerMatch[0]) ? 'Cr' : 'Dr';
    s = s.replace(/^(cr|dr)\.?/i, '').replace(/(cr|dr)\.?$/i, '');
  }

  s = s.replace(CURRENCY_PREFIX, '');

  // Sign may sit on either side; banks print both "-500" and "500-".
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);

  // Re-check for a placeholder that only became empty after stripping.
  if (EMPTY_TOKENS.has(s.toLowerCase())) return null;

  // Only digits, grouping commas and a single decimal point may remain.
  if (!/^\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$/.test(s) && !/^\d+(?:\.\d+)?$/.test(s)) {
    return null;
  }

  const value = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;

  if (marker === 'Dr') negative = true;
  if (marker === 'Cr') negative = false;

  const magnitude = round2(value);
  // Normalise -0 to 0 so equality checks behave.
  const signed = negative && magnitude !== 0 ? -magnitude : magnitude;
  return {
    value: signed,
    magnitude,
    marker,
    negative,
  };
}

/** Signed numeric value of an amount cell, or `null` when it is not an amount. */
export function parseAmount(raw: string | null | undefined): number | null {
  return parseAmountDetailed(raw)?.value ?? null;
}

/** Absolute value of an amount cell — what a Debit or Credit column holds. */
export function parseAmountMagnitude(raw: string | null | undefined): number | null {
  return parseAmountDetailed(raw)?.magnitude ?? null;
}

/** Cheap predicate for the wrapped-row merge and column scoring. */
export function isAmountLike(raw: string | null | undefined): boolean {
  return parseAmountDetailed(raw) !== null;
}

/** Reads a standalone Dr/Cr flag cell. */
export function parseDrCrFlag(raw: string | null | undefined): DrCr | null {
  if (!raw) return null;
  const s = raw.replace(SPACE_CHARS, '').replace(/\./g, '').toLowerCase();
  if (s === 'cr' || s === 'c' || s === 'credit') return 'Cr';
  if (s === 'dr' || s === 'd' || s === 'debit' || s === 'db') return 'Dr';
  return null;
}

/** Currency rounding — money is decimal, floats are not. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
