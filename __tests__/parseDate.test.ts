import { describe, expect, it } from 'vitest';
import { isDateLike, isoToDate, isoToDisplay, parseDate } from '@/lib/parse/parseDate';

const NBSP = String.fromCharCode(0x00a0);

describe('parseDate - numeric formats', () => {
  it('parses day-first slash formats', () => {
    expect(parseDate('01/04/2024')).toBe('2024-04-01');
    expect(parseDate('31/12/2023')).toBe('2023-12-31');
    expect(parseDate('1/4/2024')).toBe('2024-04-01');
  });

  it('parses dash and dot separators', () => {
    expect(parseDate('01-04-2024')).toBe('2024-04-01');
    expect(parseDate('01.04.2024')).toBe('2024-04-01');
  });

  it('parses two-digit years with a 1970 pivot', () => {
    expect(parseDate('01/04/24')).toBe('2024-04-01');
    expect(parseDate('01/04/99')).toBe('1999-04-01');
    expect(parseDate('01-04-05')).toBe('2005-04-01');
  });

  it('parses ISO input unchanged', () => {
    expect(parseDate('2024-04-01')).toBe('2024-04-01');
  });
});

describe('parseDate - month-name formats', () => {
  it('parses dd MMM yyyy and its punctuated variants', () => {
    expect(parseDate('01 Apr 2024')).toBe('2024-04-01');
    expect(parseDate('01-Apr-2024')).toBe('2024-04-01');
    expect(parseDate('01/Apr/2024')).toBe('2024-04-01');
    expect(parseDate('1 APR 2024')).toBe('2024-04-01');
    expect(parseDate('01 April 2024')).toBe('2024-04-01');
    expect(parseDate('01-Sep-2024')).toBe('2024-09-01');
    expect(parseDate('01-Sept-2024')).toBe('2024-09-01');
  });

  it('parses two-digit years with month names', () => {
    expect(parseDate('01-Apr-24')).toBe('2024-04-01');
  });
});

describe('parseDate - trailing noise', () => {
  it('drops a time component', () => {
    expect(parseDate('01/04/2024 14:32')).toBe('2024-04-01');
    expect(parseDate('01/04/2024 02:15:44 PM')).toBe('2024-04-01');
  });

  it('drops a parenthesised suffix and non-breaking spaces', () => {
    expect(parseDate('01-Apr-2024 (Mon)')).toBe('2024-04-01');
    expect(parseDate(`01${NBSP}Apr${NBSP}2024`)).toBe('2024-04-01');
  });
});

describe('parseDate - day-first ambiguity', () => {
  it('defaults to day-first', () => {
    expect(parseDate('03/04/2024')).toBe('2024-04-03');
  });

  it('honours a template-supplied format first', () => {
    expect(parseDate('03/04/2024', ['MM/dd/yyyy'])).toBe('2024-03-04');
  });
});

describe('parseDate - rejects non-dates', () => {
  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(parseDate('31/02/2024')).toBeNull();
    expect(parseDate('32/01/2024')).toBeNull();
    expect(parseDate('01/13/2024')).toBeNull();
    expect(parseDate('00/04/2024')).toBeNull();
  });

  it('rejects amounts, narration and empty cells', () => {
    for (const token of ['', '  ', '1,234.00', '123456', 'UPI/123/ABC', 'Apr', '-']) {
      expect(parseDate(token)).toBeNull();
    }
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it('exposes a predicate consistent with the parser', () => {
    expect(isDateLike('01/04/2024')).toBe(true);
    expect(isDateLike('1,234.00')).toBe(false);
  });
});

describe('date helpers', () => {
  it('formats ISO for display', () => {
    expect(isoToDisplay('2024-04-01')).toBe('01/04/2024');
  });

  it('converts ISO to a UTC Date', () => {
    const d = isoToDate('2024-04-01');
    expect(d.toISOString()).toBe('2024-04-01T00:00:00.000Z');
  });
});
