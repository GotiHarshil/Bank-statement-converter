/**
 * Deterministic synthetic ledger generator.
 *
 * Fixtures must never contain real customer data, so every statement in
 * `__tests__/fixtures` is generated from this file. The ledger is internally
 * consistent by construction — the running balance always reconciles — which is
 * what makes the golden files meaningful: if the parser disagrees with the
 * golden output, the parser is wrong.
 */

export interface LedgerEntry {
  date: string; // ISO
  valueDate: string; // ISO
  narration: string;
  refNo: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

/** Mulberry32 — small, seeded, and stable across Node versions. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CREDIT_NARRATIONS = [
  'NEFT CR-SBIN0001234-VIJAY TRADERS-PAYMENT AGAINST INVOICE 4471',
  'UPI/412233445566/Payment from/9876543210@ybl/Settlement',
  'IMPS-408912345678-MEHTA AND SONS-HDFC-PAYMENT',
  'SALARY CREDIT APRIL 2024 EMPLOYEE CODE 88213',
  'INT.PD:01-01-2024 to 31-03-2024',
  'RTGS CR HDFCR52024040112345 SHREE ENTERPRISES PVT LTD INVOICE SETTLEMENT',
  'CASH DEPOSIT AT BRANCH ANDHERI EAST MUMBAI',
];

const DEBIT_NARRATIONS = [
  'UPI/DR/412299887766/SWIGGY/YESB/swiggy@ybl/Food Order',
  'ATM WDL-ATM CASH-HDFC ATM BANDRA WEST MUMBAI 400050',
  'NEFT DR-ICIC0000456-RAMESH KUMAR-RENT APRIL 2024',
  'CHQ PAID-MICR CTS-123456',
  'BILLPAY DR-RELIANCE JIO-9876543210-AUTOPAY',
  'POS 4571XXXXXXXX8821 RELIANCE RETAIL LTD MUMBAI',
  'GST PAYMENT CPIN 24040012345678 CGST SGST APRIL 2024',
  'EMI DEBIT HOME LOAN ACCOUNT 50200012345678 INSTALMENT 42',
];

export interface LedgerOptions {
  seed: number;
  count: number;
  openingBalance: number;
  startDate: string; // ISO
}

export function buildLedger(options: LedgerOptions): { opening: number; closing: number; entries: LedgerEntry[] } {
  const rand = rng(options.seed);
  const entries: LedgerEntry[] = [];

  let balance = round2(options.openingBalance);
  let day = new Date(`${options.startDate}T00:00:00Z`);

  for (let i = 0; i < options.count; i++) {
    // Dates advance monotonically, sometimes staying on the same day.
    if (rand() > 0.35) day = new Date(day.getTime() + Math.ceil(rand() * 3) * 86_400_000);

    const isCredit = rand() > 0.55;
    const magnitude = round2(Math.floor(rand() * (isCredit ? 250_000 : 60_000)) + 100 + Math.floor(rand() * 100) / 100);

    const debit = isCredit ? null : magnitude;
    const credit = isCredit ? magnitude : null;
    balance = round2(balance - (debit ?? 0) + (credit ?? 0));

    const pool = isCredit ? CREDIT_NARRATIONS : DEBIT_NARRATIONS;
    const iso = day.toISOString().slice(0, 10);

    entries.push({
      date: iso,
      // Value date usually equals the transaction date, occasionally lags by a day.
      valueDate: rand() > 0.85 ? new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10) : iso,
      narration: pool[Math.floor(rand() * pool.length)]!,
      refNo: String(Math.floor(rand() * 900_000_000) + 100_000_000),
      debit,
      credit,
      balance,
    });
  }

  return {
    opening: round2(options.openingBalance),
    closing: entries.length ? entries[entries.length - 1]!.balance : round2(options.openingBalance),
    entries,
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Indian digit grouping: 1,23,456.78 rather than 123,456.78. */
export function inr(n: number): string {
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(2);
  const dot = fixed.indexOf('.');
  const whole = fixed.slice(0, dot);
  const decimals = fixed.slice(dot + 1);

  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    const restGrouped = rest.replace(/(\d)(?=(\d\d)+$)/g, '$1,');
    grouped = `${restGrouped},${last3}`;
  }

  return `${negative ? '-' : ''}${grouped}.${decimals}`;
}

/** ISO to a bank-specific display format. */
export function formatDate(iso: string, format: string): string {
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[Number(m) - 1] ?? 'Jan';

  switch (format) {
    case 'dd/MM/yy':
      return `${d}/${m}/${y!.slice(2)}`;
    case 'dd/MM/yyyy':
      return `${d}/${m}/${y}`;
    case 'dd-MM-yyyy':
      return `${d}-${m}-${y}`;
    case 'dd-MMM-yyyy':
      return `${d}-${monthName}-${y}`;
    case 'dd MMM yyyy':
      return `${d} ${monthName} ${y}`;
    case 'dd-MMM-yy':
      return `${d}-${monthName}-${y!.slice(2)}`;
    default:
      return `${d}/${m}/${y}`;
  }
}
