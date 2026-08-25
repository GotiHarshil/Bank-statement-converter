/**
 * Date parsing for Indian bank statements.
 *
 * Statements are day-first. The ambiguity between 03/04/2024 as 3 April and
 * 4 March is resolved by the bank template's `dateFormats` list; the default
 * order is day-first because that is what every Indian bank prints.
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

const MONTH_ALIASES: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  MONTH_NAMES.forEach((name, i) => {
    map[name] = i + 1;
    map[name.slice(0, 3)] = i + 1;
  });
  map['sept'] = 9;
  return map;
})();

/** Tried in order when a template does not specify its own formats. */
export const DEFAULT_DATE_FORMATS = [
  'dd/MM/yyyy',
  'dd-MM-yyyy',
  'dd.MM.yyyy',
  'dd/MM/yy',
  'dd-MM-yy',
  'dd.MM.yy',
  'dd-MMM-yyyy',
  'dd MMM yyyy',
  'dd/MMM/yyyy',
  'dd-MMM-yy',
  'dd MMM yy',
  'dd MMMM yyyy',
  'yyyy-MM-dd',
  'MMM dd, yyyy',
] as const;

const SPACE_CHARS = /[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g;

interface DateParts {
  day?: number;
  month?: number;
  year?: number;
}

/**
 * Two-digit years: statements are recent, so 70-99 means the 1900s and
 * everything below means the 2000s.
 */
function expandYear(yy: number): number {
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

const REGEX_SPECIALS = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '/']);

/** Escapes a literal separator character from a format string. */
function escapeRegexChar(ch: string): string {
  return REGEX_SPECIALS.has(ch) ? `\\${ch}` : ch;
}

function formatToRegex(format: string): { regex: RegExp; order: Array<keyof DateParts | 'monthName'> } {
  const order: Array<keyof DateParts | 'monthName'> = [];
  let pattern = '';
  let i = 0;

  while (i < format.length) {
    if (format.startsWith('yyyy', i)) {
      pattern += String.raw`(\d{4})`;
      order.push('year');
      i += 4;
    } else if (format.startsWith('yy', i)) {
      pattern += String.raw`(\d{2})`;
      order.push('year');
      i += 2;
    } else if (format.startsWith('MMMM', i) || format.startsWith('MMM', i)) {
      pattern += '([A-Za-z]{3,9})';
      order.push('monthName');
      i += format.startsWith('MMMM', i) ? 4 : 3;
    } else if (format.startsWith('MM', i)) {
      pattern += String.raw`(\d{1,2})`;
      order.push('month');
      i += 2;
    } else if (format.startsWith('dd', i)) {
      pattern += String.raw`(\d{1,2})`;
      order.push('day');
      i += 2;
    } else if (format[i] === ' ') {
      pattern += String.raw`\s+`;
      i += 1;
    } else {
      pattern += escapeRegexChar(format[i]!);
      i += 1;
    }
  }

  return { regex: new RegExp(`^${pattern}$`, 'i'), order };
}

const REGEX_CACHE = new Map<string, ReturnType<typeof formatToRegex>>();
function compiled(format: string) {
  let hit = REGEX_CACHE.get(format);
  if (!hit) {
    hit = formatToRegex(format);
    REGEX_CACHE.set(format, hit);
  }
  return hit;
}

/** Rejects 31 February and friends — a rolled-over date is a silent data error. */
function toIso(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2999) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses one date cell into ISO `yyyy-MM-dd`, or `null` when it is not a date.
 *
 * `formats` comes from the matched bank template; anything not covered falls
 * back to the day-first default list.
 */
export function parseDate(raw: string | null | undefined, formats: readonly string[] = DEFAULT_DATE_FORMATS): string | null {
  if (!raw) return null;

  // Statements often print "01/04/2024 14:32" or "01-Apr-2024 (Mon)".
  const cleaned = raw
    .replace(SPACE_CHARS, ' ')
    .trim()
    .replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();

  if (cleaned === '') return null;

  const candidates = formats.length ? [...formats, ...DEFAULT_DATE_FORMATS] : DEFAULT_DATE_FORMATS;

  for (const format of candidates) {
    const { regex, order } = compiled(format);
    const m = cleaned.match(regex);
    if (!m) continue;

    const parts: DateParts = {};
    let bad = false;

    order.forEach((key, idx) => {
      const value = m[idx + 1];
      if (value === undefined) {
        bad = true;
        return;
      }
      if (key === 'monthName') {
        const month = MONTH_ALIASES[value.toLowerCase()];
        if (!month) {
          bad = true;
          return;
        }
        parts.month = month;
      } else if (key === 'year') {
        const n = Number(value);
        parts.year = value.length === 2 ? expandYear(n) : n;
      } else {
        parts[key] = Number(value);
      }
    });

    if (bad || parts.day === undefined || parts.month === undefined || parts.year === undefined) continue;

    const iso = toIso(parts.day, parts.month, parts.year);
    if (iso) return iso;
  }

  return null;
}

/** Cheap predicate used by the wrapped-row merge and by column scoring. */
export function isDateLike(raw: string | null | undefined, formats?: readonly string[]): boolean {
  return parseDate(raw, formats) !== null;
}

/** ISO date to `dd/MM/yyyy` for display and CSV output. */
export function isoToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** ISO date to a real UTC Date, for the date-typed XLSX column. */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}
