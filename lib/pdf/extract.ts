import { extractImages, getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import { ConvertError, type ExtractedDocument, type PageText, type TextItem } from '@/lib/schema';

/**
 * Below this many text items a page has too little text to carry transaction
 * data on its own. This alone does not mean the page is scanned — a real
 * statement's cover page or trailing "END OF STATEMENT" page is legitimately
 * this sparse — so it only makes a page a *candidate*; `pageLooksScanned`
 * decides from there.
 */
const SCANNED_PAGE_ITEM_THRESHOLD = 20;

/**
 * Raw embedded-image pixel count above which a sparse-text page is treated as
 * an actual scan rather than a cover page carrying a small logo.
 *
 * A bank's letterhead logo is typically under 200×200 (40,000px); even a
 * low-quality full-page scan is well past 300×300 (90,000px). This sits
 * comfortably between the two, so a real scan is caught while a sparse but
 * genuinely digital page (a footer with a logo and a disclaimer) is not.
 */
const LARGE_IMAGE_PIXEL_THRESHOLD = 100_000;

/** `%PDF` — validated on the bytes, never on the filename. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

interface RawTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

/**
 * Extracts every run of text with its position on the page.
 *
 * Coordinates are normalised to a top-left origin (y increases downwards) so
 * that row clustering can sort naturally top-to-bottom. Positions are the
 * whole point: a flat text dump loses which number is Debit vs Credit vs
 * Balance, which is the single mistake that makes a converter untrustworthy.
 */
export async function extractDocument(
  data: Uint8Array,
  password?: string,
  onPage?: (pageNumber: number, totalPages: number) => void,
): Promise<ExtractedDocument> {
  if (!looksLikePdf(data)) {
    throw new ConvertError('NOT_A_PDF', 'That file is not a PDF — its contents do not start with %PDF.');
  }

  const pdf = await openDocument(data, password);

  try {
    const pages: PageText[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const items: TextItem[] = [];
      for (const raw of content.items as RawTextItem[]) {
        const str = raw.str;
        if (typeof str !== 'string' || str.trim() === '') continue;

        const t = raw.transform;
        if (!t || t.length < 6) continue;

        const b = t[1] ?? 0;
        const d = t[3] ?? 0;
        const x = t[4] ?? 0;
        const baselineY = t[5] ?? 0;
        const fontSize = Math.hypot(b, d) || Math.abs(d) || 10;
        const height = raw.height && raw.height > 0 ? raw.height : fontSize;

        items.push({
          str,
          x,
          // Flip to a top-left origin: distance of the baseline from the page top.
          y: viewport.height - baselineY,
          width: raw.width ?? 0,
          height,
          fontSize,
        });
      }

      pages.push({ pageNumber, width: viewport.width, height: viewport.height, items });
      page.cleanup();
      onPage?.(pageNumber, pdf.numPages);
    }

    await assertNotScanned(pdf, pages);

    const firstPage = pages[0];
    return {
      pages,
      numPages: pdf.numPages,
      firstPageText: firstPage ? pageToText(firstPage) : '',
    };
  } finally {
    // Release the worker-side document; the buffer is never persisted anywhere.
    await destroyDocument(pdf);
  }
}

/**
 * Tears down the document and its worker.
 *
 * `PDFDocumentProxy` itself has no `destroy` — teardown lives on the loading
 * task. Failing to release it leaks the decoded PDF, which for this app means
 * leaking somebody's bank statement.
 */
async function destroyDocument(pdf: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<void> {
  try {
    pdf.cleanup();
    const task = (pdf as { loadingTask?: { destroy?: () => Promise<void> } }).loadingTask;
    await task?.destroy?.();
  } catch {
    // Teardown failures must never mask a successful parse.
  }
}

async function openDocument(data: Uint8Array, password?: string) {
  const { PasswordException, PasswordResponses } = await getResolvedPDFJS();
  try {
    // pdf.js detaches the buffer it is given, so hand it a private copy.
    return await getDocumentProxy(new Uint8Array(data), {
      password: password ?? '',
      useSystemFonts: false,
    });
  } catch (err) {
    if (err instanceof PasswordException) {
      if (err.code === PasswordResponses.INCORRECT_PASSWORD) {
        throw new ConvertError('PASSWORD_INCORRECT', 'That password did not unlock the PDF. Please check and try again.');
      }
      throw new ConvertError(
        'PASSWORD_REQUIRED',
        'This statement is password-protected. Indian banks usually derive it from your date of birth, PAN, or customer ID.',
      );
    }
    throw new ConvertError('PARSE_FAILED', 'The PDF could not be opened. It may be corrupt or use an unsupported encryption scheme.');
  }
}

/**
 * Fails loudly on scans rather than emitting an empty spreadsheet. Silent
 * empty output is far worse than a clear "unsupported".
 *
 * A page is only a *candidate* scan on text sparseness alone — plenty of real
 * statements have a legitimately sparse cover or closing page (a logo plus a
 * disclaimer). It is confirmed as an actual scan only when that sparse page
 * also carries a large embedded image, which a decorative logo does not.
 * Images are checked lazily, only for candidate pages, so a normal statement
 * never pays for the extra work.
 */
async function assertNotScanned(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, pages: PageText[]): Promise<void> {
  const candidates = pages.filter((p) => p.items.length < SCANNED_PAGE_ITEM_THRESHOLD);
  if (candidates.length === 0) return;

  const scanned: number[] = [];
  for (const page of candidates) {
    if (await pageLooksScanned(pdf, page)) scanned.push(page.pageNumber);
  }
  if (scanned.length === 0) return;

  if (scanned.length === pages.length) {
    throw new ConvertError(
      'SCANNED_PDF_UNSUPPORTED',
      'This PDF contains scanned images rather than selectable text. Download the digital statement from your bank instead — OCR is not supported.',
    );
  }

  throw new ConvertError(
    'SCANNED_PDF_UNSUPPORTED',
    `Page${scanned.length > 1 ? 's' : ''} ${scanned.join(', ')} contain no selectable text (scanned image). Refusing to emit partial output.`,
  );
}

/** Whether a text-sparse page also carries an image large enough to be the page's actual content. */
async function pageLooksScanned(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, page: PageText): Promise<boolean> {
  try {
    const images = await extractImages(pdf, page.pageNumber);
    const totalPixels = images.reduce((sum, img) => sum + img.width * img.height, 0);
    return totalPixels >= LARGE_IMAGE_PIXEL_THRESHOLD;
  } catch {
    // If image inspection itself fails, fall back to the original signal:
    // sparse text alone is treated as a scan, which is the safer default.
    return true;
  }
}

/** Reading-order text for a page, used for template detection and header hunting. */
export function pageToText(page: PageText): string {
  const sorted = [...page.items].sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x));
  const lines: string[] = [];
  let currentY = Number.NEGATIVE_INFINITY;
  let line: string[] = [];
  for (const item of sorted) {
    if (Math.abs(item.y - currentY) > 2) {
      if (line.length) lines.push(line.join(' '));
      line = [];
      currentY = item.y;
    }
    line.push(item.str);
  }
  if (line.length) lines.push(line.join(' '));
  return lines.join('\n');
}
