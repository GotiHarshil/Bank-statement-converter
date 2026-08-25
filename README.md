# Bank Statement Converter

Converts Indian bank statement PDFs into clean, **arithmetically verified** Excel and CSV files.

Built for CAs, accountants and small businesses. The design principle throughout: a silently
mis-assigned debit or credit is far worse than a visible failure. Every layer either produces a
result it can prove, or says plainly that it could not.

```bash
npm install
npm run dev
```

Then open the printed URL. No database, no configuration, and no API key are needed for the ten
built-in banks.

---

## What makes it trustworthy

**Positional extraction.** Text is extracted with coordinates, never as a flat string. Bank
statements are column tables; a flat dump destroys which number is Debit, which is Credit and which
is Balance. That single shortcut is why most converters cannot be trusted.

**The running-balance check.** After parsing, every row must satisfy
`balance[i] = balance[i-1] − debit[i] + credit[i]` to within ₹0.01. A swapped debit and credit, a
dropped row, a transposed digit, a wrapped line merged into the wrong transaction — each one breaks
that equation immediately. When it breaks, the report names the exact rows rather than failing
generically.

**The review step.** Results land in an editable table before export, with failing rows pinned to
the top and every check shown. Correcting a cell re-runs the whole validation chain live. Accountants
will not paste unreviewed machine output into their books.

**The LLM never reads numbers.** When no template matches, a model is asked only *which column is
which*. Its answer is turned into a column mapping and fed back into the same deterministic parser
every bank template uses. Language models transpose digits, and in accounting software that is
disqualifying.

---

## How a statement becomes a spreadsheet

| Stage | File | What happens |
| --- | --- | --- |
| 1. Extract | `lib/pdf/extract.ts` | PDF → positioned text items (`{str, x, y, width, height, fontSize}`), one array per page. Detects encryption and scans. |
| 2. Reconstruct | `lib/pdf/grid.ts` | Cluster items into rows by baseline, detect column boundaries, emit a `Grid`. |
| 3. Detect | `lib/banks/registry.ts` | Run every template's `detect()`; the highest confidence above 0.7 wins. |
| 4. Parse | `lib/parse/applyTemplate.ts` | Fold wrapped narration, then read each field with `parseDate` / `parseAmount`. |
| 5. Validate | `lib/validate/reconcile.ts` | Running balance, footer reconciliation, date order, completeness. |
| 6. Export | `lib/export/*` | XLSX (frozen header, real dates, `#,##,##0.00`, summary sheet), CSV, and an accounting-import CSV. |

`lib/convert.ts` wires these together; `app/api/convert/route.ts` streams progress as newline-delimited
JSON so the UI shows pages actually parsed rather than a spinner.

### Column detection

Column boundaries come from the whitespace gutters of the **transaction rows only** — rows carrying
both a parseable date and a parseable amount. That restriction is what makes gutter detection work on
real statements: across the whole page no vertical band is ever empty, because the address banner
spans the full width and column headers are wider than the values beneath them. Within the
transaction band every row has the same shape, so the gutters are clean.

Each boundary is placed where ink *resumes* after a gutter. That one choice handles both alignments:
a right-aligned amount column anchors on its widest value, so every shorter value still falls inside
it, and a left-aligned column starts exactly where its text does.

Two fallbacks sit behind it (a coverage rising-edge detector, then a left-edge histogram) for layouts
too dense for clean gutters.

### A known limitation

pdf.js merges two neighbouring cells into a single text run when the gutter between them is very
narrow, and it does this before any of this code sees the page — there is no option to disable it.

Where a boundary is still detectable, `assignCells` splits the merged run back apart: the boundary's
x position maps to an approximate character index, and the true cut is always at a space, so snapping
to the nearest space recovers the split exactly.

Where a bank packs a pair so tightly that the gutter disappears on too many rows (the Bank of Baroda
fixture does this), the reference number stays inside the narration and no `refNo` is emitted. Dates,
amounts and balances are unaffected, and the test suite asserts that no characters are lost.

---

## Adding a new bank

One file, and one line in the registry. Nothing in the parsing, validation or export layers changes.

Create `lib/banks/templates/yourbank.ts`:

```ts
import { scoreMarkers, type BankTemplate } from '@/lib/banks/registry';

export const yourBankSavingsV1: BankTemplate = {
  id: 'yourbank-savings-v1',
  bankName: 'Your Bank',
  detect: (text) =>
    scoreMarkers(text, [
      { pattern: /your\s+bank/i, weight: 0.6 },
      { pattern: /\bYESB0\d{6}\b/, weight: 0.4 },
    ]),
  dateFormats: ['dd/MM/yyyy'],
  amountStyle: 'separate-dr-cr',
  columns: {
    date: /txn\s*date/i,
    narration: /particulars/i,
    refNo: /cheque\s*no/i,
    debit: /debit/i,
    credit: /credit/i,
    balance: /balance/i,
  },
  ignoreRow: /^(?:opening\s+balance|b\/f)/i,
};
```

Then add it to `BANK_TEMPLATES` in `lib/banks/registry.ts`.

Columns are located by **header text**, not by index — header wording survives layout drift, and it
still resolves when pdf.js welds two narrow columns into one run. A literal column index also works
where a bank prints no usable header.

`amountStyle` covers the three layouts Indian banks use:

- `separate-dr-cr` — distinct Debit and Credit columns (most banks)
- `signed-single` — one amount column carrying a sign or an inline `(Dr)`/`(Cr)` marker (Kotak)
- `amount-plus-flag` — one amount column plus a separate Dr/Cr column (PNB)

### Accounting-import CSV

A six-column format for Indian accounting packages:

```
"bk_cd","prt_cd","tr_date","amtp","amtr","rem"
"AXISBB","SUSP","06-06-2025","295","","Dr Card Charges GST ANNUAL
4632XXXXXXXX1258"
```

- `bk_cd` — your ledger code for the bank, entered in the **Bank code** box on
  the upload form and editable again before download. The export is refused
  rather than emitted with a blank column if it is missing.
- `prt_cd` — the contra ledger, `SUSP` (suspense) until entries are allocated.
- `amtp` / `amtr` — paid and received. No grouping separators, no trailing
  zeros (`18`, not `18.00`), and the unused side is empty rather than `0`.
- `rem` — the narration carrying the statement's **own line breaks**. The parser
  keeps each printed line (`sourceLines` on the grid row, `narrationLines` on the
  transaction) alongside the space-joined narration the other exporters use.

Unlike the general-purpose CSV, no formula-injection prefix is added: this file
is fed to an importer rather than opened in Excel, and a stray apostrophe would
corrupt the remark.

### Adding an export format

Implement `Exporter` in `lib/export/types.ts` and add it to `EXPORTERS`. Tally XML is the intended
next one, so no Excel assumptions leak into the parsing or validation layers.

---

## Testing

```bash
npm test           # unit + per-bank golden tests
npm run typecheck
```

Every fixture PDF is **synthetic** — generated by `npm run fixtures` from a seeded ledger in
`scripts/lib/ledger.ts`. No real customer statement is ever committed to this repo.

The golden file for each bank *is that source ledger*, so the per-bank tests compare the parser
against an independent oracle rather than a snapshot of its own output. The fixtures are deliberately
faithful: right-aligned amounts, narration wrapping across two and three lines, repeated page
headers, reconciling footers, and one password-protected statement.

| Suite | Covers |
| --- | --- |
| `parseAmount.test.ts` | Lakh grouping, Dr/Cr markers, parentheses, unicode minus, non-breaking spaces, rejection of non-amounts |
| `parseDate.test.ts` | `dd/MM/yy`, `dd-MM-yyyy`, `dd MMM yyyy`, two-digit-year pivot, invalid calendar dates |
| `grid.test.ts` | Row clustering, cell assignment, wrapped-narration merge, repeated headers and footers |
| `extract.test.ts` | Magic bytes, `PASSWORD_REQUIRED` vs `PASSWORD_INCORRECT`, scanned-PDF rejection |
| `banks.test.ts` | All ten banks end-to-end against their golden ledgers |
| `reconcile.test.ts` | A deliberately swapped debit/credit, a dropped row, a transposed digit, tolerance limits |
| `export.test.ts` | CSV quoting and formula-injection guarding, XLSX types, formats, summary sheet |

Diagnostics for working on the parser:

```bash
npm run check:banks              # every fixture through the full pipeline
npm run check:grids              # column reconstruction per fixture
npx tsx scripts/debug-grid.ts hdfc-savings-v1     # print the reconstructed table
npx tsx scripts/debug-parse.ts hdfc-savings-v1    # print parsed JSON
npm run check:api -- http://localhost:3000        # drive a running server
```

---

## Security

- The PDF is processed from an in-memory buffer and **never written to disk**; the buffer is zeroed
  once the response is sent.
- Logs record page counts, template id, timings and error codes only — never narration, account
  numbers or balances.
- Account numbers are masked at the point of extraction, so the full number never reaches the
  response, the client, or a log line.
- `%PDF` magic bytes are validated on the contents, not the file extension.
- CSP and related headers are set in `next.config.ts`; both API routes are rate-limited per IP.
- CSV output neutralises formula injection (`=`, `+`, `-`, `@`) in bank-supplied narration.
- The LLM fallback is **off unless the user ticks the consent box**, and the UI says plainly what is
  sent and to whom.

## Configuration

| Variable | Needed for |
| --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | The LLM column-mapping fallback only (Google Gemini, direct). Everything else works without it. |

## Scope

v1 deliberately excludes OCR (scanned PDFs are rejected with a clear message rather than silently
producing empty output) and has no database — every conversion is in-memory and per-request. The
inferred-mapping cache is per-process, so correctness never depends on it, only cost.

Known advisories from transitive dependencies (`next` → `postcss`/`sharp`, `exceljs` → `uuid`) are
left in place: `npm audit fix --force` would downgrade `exceljs` to a major version without the
formatting APIs this project relies on.
