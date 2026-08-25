import { describe, expect, it } from 'vitest';
import {
  isAmountLike,
  parseAmount,
  parseAmountDetailed,
  parseAmountMagnitude,
  parseDrCrFlag,
} from '@/lib/parse/parseAmount';

describe('parseAmount - Indian lakh grouping', () => {
  it('parses lakh-grouped amounts', () => {
    expect(parseAmount('1,23,456.78')).toBe(123456.78);
    expect(parseAmount('12,34,56,789.00')).toBe(123456789);
    expect(parseAmount('9,99,999.99')).toBe(999999.99);
  });

  it('parses western grouping too', () => {
    expect(parseAmount('1,234,567.89')).toBe(1234567.89);
    expect(parseAmount('1,234.00')).toBe(1234);
  });

  it('parses ungrouped amounts', () => {
    expect(parseAmount('123456.78')).toBe(123456.78);
    expect(parseAmount('0.00')).toBe(0);
    expect(parseAmount('5')).toBe(5);
  });
});

describe('parseAmount - Dr/Cr markers', () => {
  it('treats a trailing Cr as positive and Dr as negative', () => {
    expect(parseAmount('1,234.00 Cr')).toBe(1234);
    expect(parseAmount('1,234.00 Dr')).toBe(-1234);
    expect(parseAmount('1,234.00Cr')).toBe(1234);
    expect(parseAmount('1,234.00 CR')).toBe(1234);
    expect(parseAmount('1,234.00 dr.')).toBe(-1234);
  });

  it('handles parenthesised markers, as Kotak prints them', () => {
    expect(parseAmount('5,000.00(Dr)')).toBe(-5000);
    expect(parseAmount('5,000.00(Cr)')).toBe(5000);
    expect(parseAmount('12,34,567.89(Dr)')).toBe(-1234567.89);
    expect(parseAmountDetailed('5,000.00(Dr)')!.magnitude).toBe(5000);
  });

  it('handles a leading marker', () => {
    expect(parseAmount('Cr 500.00')).toBe(500);
    expect(parseAmount('Dr 500.00')).toBe(-500);
  });

  it('reports the marker and magnitude separately', () => {
    const parsed = parseAmountDetailed('1,23,456.78 Dr');
    expect(parsed).not.toBeNull();
    expect(parsed!.marker).toBe('Dr');
    expect(parsed!.magnitude).toBe(123456.78);
    expect(parsed!.value).toBe(-123456.78);
    expect(parseAmountMagnitude('1,234.00 Dr')).toBe(1234);
  });
});

describe('parseAmount - negatives', () => {
  it('parses accounting parentheses', () => {
    expect(parseAmount('(1,234.00)')).toBe(-1234);
    expect(parseAmount('(1,23,456.78)')).toBe(-123456.78);
  });

  it('parses a leading or trailing ASCII minus', () => {
    expect(parseAmount('-1,234.00')).toBe(-1234);
    expect(parseAmount('1,234.00-')).toBe(-1234);
  });

  it('parses unicode minus, en dash and em dash as negation', () => {
    expect(parseAmount(`${String.fromCharCode(0x2212)}1,234.00`)).toBe(-1234);
    expect(parseAmount(`${String.fromCharCode(0x2013)}1,234.00`)).toBe(-1234);
    expect(parseAmount(`${String.fromCharCode(0x2014)}1,234.00`)).toBe(-1234);
  });

  it('does not produce negative zero', () => {
    expect(Object.is(parseAmount('-0.00'), 0)).toBe(true);
  });
});

describe('parseAmount - whitespace and currency noise', () => {
  it('strips non-breaking and narrow spaces', () => {
    const NBSP = String.fromCharCode(0x00a0);
    const NARROW_NBSP = String.fromCharCode(0x202f);
    const THIN = String.fromCharCode(0x2009);
    expect(parseAmount(`1,23,456.78${NBSP}`)).toBe(123456.78);
    expect(parseAmount(`${NARROW_NBSP}1,234.00`)).toBe(1234);
    expect(parseAmount('  1,234.00  ')).toBe(1234);
    expect(parseAmount(`1,234.00${THIN}Cr`)).toBe(1234);
    expect(parseAmount(`1,23${NBSP},456.78`)).toBe(123456.78);
  });

  it('strips rupee symbols and Rs prefixes', () => {
    expect(parseAmount(`${String.fromCharCode(0x20b9)}1,234.00`)).toBe(1234);
    expect(parseAmount('Rs. 1,234.00')).toBe(1234);
    expect(parseAmount('INR 1,234.00')).toBe(1234);
  });
});

describe('parseAmount - rejects non-amounts', () => {
  it('returns null for empty and placeholder cells', () => {
    for (const token of ['', '  ', '-', '--', '.', 'NIL', 'N/A', 'na']) {
      expect(parseAmount(token)).toBeNull();
    }
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it('returns null for narration, references and dates', () => {
    const tokens = [
      'UPI/123456789/PAYMENT',
      'NEFT-HDFC0000123-RAHUL',
      '01/04/2024',
      '01-04-2024',
      'ATM WDL 1234',
      'abc',
      '12.34.56',
    ];
    for (const token of tokens) {
      expect(parseAmount(token)).toBeNull();
    }
  });

  it('exposes a predicate consistent with the parser', () => {
    expect(isAmountLike('1,23,456.78')).toBe(true);
    expect(isAmountLike('01/04/2024')).toBe(false);
    expect(isAmountLike('')).toBe(false);
  });
});

describe('parseDrCrFlag', () => {
  it('reads standalone flag cells', () => {
    expect(parseDrCrFlag('Cr')).toBe('Cr');
    expect(parseDrCrFlag('CR.')).toBe('Cr');
    expect(parseDrCrFlag('dr')).toBe('Dr');
    expect(parseDrCrFlag('DEBIT')).toBe('Dr');
    expect(parseDrCrFlag('credit')).toBe('Cr');
    expect(parseDrCrFlag('')).toBeNull();
    expect(parseDrCrFlag('xyz')).toBeNull();
  });
});
