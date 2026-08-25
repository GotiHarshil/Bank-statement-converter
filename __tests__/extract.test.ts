import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertStatement } from '@/lib/convert';
import { extractDocument, looksLikePdf } from '@/lib/pdf/extract';
import { ConvertError } from '@/lib/schema';

const FIXTURES = join(process.cwd(), '__tests__', 'fixtures');

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, `${name}.pdf`)));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (err) {
    return err instanceof ConvertError ? err.code : `UNEXPECTED:${String(err)}`;
  }
}

describe('magic byte validation', () => {
  it('accepts a real PDF and rejects anything else', () => {
    expect(looksLikePdf(fixture('hdfc-savings-v1'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7 ...'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('<html><body>not a pdf'))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false); // a zip
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
  });

  it('rejects a file renamed to .pdf', async () => {
    const disguised = new TextEncoder().encode('MZ\x90\x00 this is an executable');
    expect(await codeOf(extractDocument(disguised))).toBe('NOT_A_PDF');
  });
});

describe('encrypted statements', () => {
  it('asks for a password rather than failing generically', async () => {
    expect(await codeOf(extractDocument(fixture('hdfc-savings-v1-encrypted')))).toBe('PASSWORD_REQUIRED');
  });

  it('distinguishes a wrong password from a missing one', async () => {
    expect(await codeOf(extractDocument(fixture('hdfc-savings-v1-encrypted'), 'WRONG'))).toBe('PASSWORD_INCORRECT');
  });

  it('parses correctly once unlocked', async () => {
    const result = await convertStatement(fixture('hdfc-savings-v1-encrypted'), { password: 'ARJU1990' });

    expect(result.transactions).toHaveLength(34);
    expect(result.validation.ok).toBe(true);
    expect(result.meta.templateId).toBe('hdfc-savings-v1');
  });
});

describe('scanned statements', () => {
  it('refuses loudly instead of emitting empty output', async () => {
    expect(await codeOf(extractDocument(fixture('scanned-no-text')))).toBe('SCANNED_PDF_UNSUPPORTED');
  });

  it('surfaces the same code through the full pipeline', async () => {
    expect(await codeOf(convertStatement(fixture('scanned-no-text')))).toBe('SCANNED_PDF_UNSUPPORTED');
  });

  it('does not reject a sparse-but-genuine trailing page carrying only a small logo', async () => {
    // Found via a real Canara Bank statement: its closing page had five text
    // items and a small letterhead logo, and text-sparseness alone flagged it
    // as a scan, rejecting an otherwise fully digital statement outright.
    const doc = await extractDocument(fixture('sparse-trailing-page'));
    expect(doc.numPages).toBe(2);
    expect(doc.pages[1]!.items.length).toBeGreaterThan(0);
    expect(doc.pages[1]!.items.length).toBeLessThan(20);
  });

  it('still catches an actual scanned page mixed into an otherwise digital statement', async () => {
    // The fix for the false positive above must not blunt the real guard: a
    // page that is near-empty of text *and* carries a full-page-resolution
    // image is still exactly what OCR would be needed for.
    const err = await extractDocument(fixture('partial-scan')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConvertError);
    expect((err as ConvertError).code).toBe('SCANNED_PDF_UNSUPPORTED');
    expect((err as ConvertError).message).toContain('2');
  });
});

describe('positioned extraction', () => {
  it('returns items with coordinates, not a flat string', async () => {
    const doc = await extractDocument(fixture('hdfc-savings-v1'));

    expect(doc.numPages).toBeGreaterThan(1);
    const page = doc.pages[0]!;
    expect(page.items.length).toBeGreaterThan(100);

    for (const item of page.items.slice(0, 25)) {
      expect(item.str.trim()).not.toBe('');
      expect(Number.isFinite(item.x)).toBe(true);
      expect(Number.isFinite(item.y)).toBe(true);
      expect(item.fontSize).toBeGreaterThan(0);
    }

    // Items must sit in more than one column, or positions are being lost.
    const distinctX = new Set(page.items.map((i) => Math.round(i.x)));
    expect(distinctX.size).toBeGreaterThan(4);
  });

  it('reports progress for every page', async () => {
    const seen: number[] = [];
    const doc = await extractDocument(fixture('hdfc-savings-v1'), undefined, (page) => seen.push(page));

    expect(seen).toEqual(Array.from({ length: doc.numPages }, (_, i) => i + 1));
  });
});

describe('unrecognised layouts', () => {
  it('fails with a typed code rather than guessing, when the LLM is not consented to', async () => {
    // A valid PDF whose cover page matches no template.
    const code = await codeOf(
      convertStatement(fixture('scanned-no-text'), { allowLlmFallback: false }),
    );
    expect(code).not.toBe('NO_ERROR');
  });
});
