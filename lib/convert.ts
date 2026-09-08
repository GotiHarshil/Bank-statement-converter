import { detectTemplate } from '@/lib/banks/registry';
import { LEARNED_TEMPLATE_HINT_PREFIX } from '@/lib/banks/available';
import { applyTemplate, type ApplyResult } from '@/lib/parse/applyTemplate';
import { inferColumnMapping, layoutFingerprint, toStoredTemplate } from '@/lib/parse/llmFallback';
import { hydrateTemplate, templateStore } from '@/lib/banks/learned/hydrate';
import { extractDocument, pageToText } from '@/lib/pdf/extract';
import { buildGrid } from '@/lib/pdf/grid';
import { validate } from '@/lib/validate/reconcile';
import { ConvertError, type ConvertSuccessBody } from '@/lib/schema';

/** Progress events emitted while converting, for the upload UI. */
export type ConvertProgress =
  | { stage: 'extracting'; page: number; totalPages: number }
  | { stage: 'reconstructing' }
  | { stage: 'parsing'; bankName: string }
  | { stage: 'inferring' }
  | { stage: 'validating' };

export interface ConvertOptions {
  password?: string;
  /** Template id chosen by the user in the bank-hint dropdown. */
  bankHint?: string;
  /**
   * Whether the statement may be sent to the LLM when no shipped or learned
   * template matches. The web UI always enables this; callers that must not
   * transmit statement data to a third party can still set this to `false`.
   */
  allowLlmFallback?: boolean;
  onProgress?: (progress: ConvertProgress) => void;
}

/**
 * The whole conversion, from PDF bytes to a validated result.
 *
 * Deterministic templates run first. The LLM is consulted only when no template
 * matches or a template fails to reconcile, and even then only to identify which
 * column is which — never to read the numbers.
 */
export async function convertStatement(bytes: Uint8Array, options: ConvertOptions = {}): Promise<ConvertSuccessBody> {
  const report = options.onProgress ?? (() => undefined);

  const doc = await extractDocument(bytes, options.password, (page, totalPages) =>
    report({ stage: 'extracting', page, totalPages }),
  );

  report({ stage: 'reconstructing' });
  const grid = buildGrid(doc.pages);
  const allText = doc.pages.map(pageToText).join('\n');

  const notices: string[] = [];
  const store = templateStore();

  // A hint pointing at a specific learned layout is an explicit, deliberate
  // choice — the same override tier a shipped-template hint already gets via
  // `detectTemplate`'s `findById` bypass, just for the learned side. Checked
  // first, ahead of shipped-template detection, for the same reason: the user
  // picked this bank on purpose.
  if (options.bankHint?.startsWith(LEARNED_TEMPLATE_HINT_PREFIX)) {
    const hinted = await store.get(options.bankHint.slice(LEARNED_TEMPLATE_HINT_PREFIX.length)).catch(() => null);

    if (hinted) {
      report({ stage: 'parsing', bankName: hinted.bankName });
      const result = applyTemplate(grid, hydrateTemplate(hinted), allText);

      if (result) {
        report({ stage: 'validating' });
        const validation = validate(result.transactions, summaryOf(result));

        if (validation.ok) {
          void store.put({ ...hinted, timesUsed: hinted.timesUsed + 1 }).catch(() => undefined);

          return {
            ok: true,
            transactions: result.transactions,
            meta: { ...result.meta, parsedBy: 'template', pageCount: doc.numPages },
            validation,
            notices: [...notices, ...result.notices, `Parsed using the "${hinted.bankName}" layout you selected — no AI was used.`],
          };
        }
      }
    }

    // The hint didn't apply to this statement — a stale selection, or genuinely
    // the wrong bank. Fall through to the normal flow exactly as if no hint had
    // been given, rather than returning a mapping that doesn't actually fit.
  }

  const detected = detectTemplate(doc.firstPageText, options.bankHint);

  if (detected) {
    report({ stage: 'parsing', bankName: detected.template.bankName });
    const result = applyTemplate(grid, detected.template, allText);
    if (result) {
      report({ stage: 'validating' });
      const validation = validate(result.transactions, summaryOf(result));

      // A template that parses but does not reconcile is worse than no template
      // at all, so try the LLM mapping before returning a broken chain.
      if (validation.ok || !options.allowLlmFallback) {
        return {
          ok: true,
          transactions: result.transactions,
          meta: { ...result.meta, parsedBy: 'template', pageCount: doc.numPages },
          validation,
          notices: [...notices, ...result.notices],
        };
      }

      notices.push(
        `The ${detected.template.bankName} template parsed this statement but the running balance did not reconcile, so the column mapping was re-checked.`,
      );
    } else {
      notices.push(`The ${detected.template.bankName} template matched the cover page but not the table layout.`);
    }
  }

  // A layout learned from an earlier statement is reused deterministically: no
  // model call, no data leaving the server, so no consent needed either.
  const fingerprint = layoutFingerprint(grid, doc.firstPageText);
  const learned = await store.get(fingerprint).catch(() => null);

  if (learned) {
    report({ stage: 'parsing', bankName: learned.bankName });
    const result = applyTemplate(grid, hydrateTemplate(learned), allText);

    if (result) {
      report({ stage: 'validating' });
      const validation = validate(result.transactions, summaryOf(result));

      if (validation.ok) {
        // Count the use, but never let a bookkeeping write fail a conversion.
        void store.put({ ...learned, timesUsed: learned.timesUsed + 1 }).catch(() => undefined);

        return {
          ok: true,
          transactions: result.transactions,
          meta: { ...result.meta, parsedBy: 'template', pageCount: doc.numPages },
          validation,
          notices: [
            ...notices,
            ...result.notices,
            `Parsed using the "${learned.bankName}" layout this app learned from an earlier statement — no AI was used.`,
          ],
        };
      }
    }

    // The bank changed its layout: drop what we learned and infer again.
    await store.delete(fingerprint).catch(() => undefined);
    notices.push(
      `The stored ${learned.bankName} layout no longer matches this statement, so the column mapping was inferred again.`,
    );
  }

  if (!options.allowLlmFallback) {
    throw new ConvertError(
      detected ? 'PARSE_FAILED' : 'UNSUPPORTED_LAYOUT',
      detected
        ? 'This statement matched a known bank but its table layout could not be read. Enable AI-assisted mapping to try again.'
        : 'No built-in template recognised this statement. Enable AI-assisted mapping to try again, or pick your bank from the dropdown.',
    );
  }

  report({ stage: 'inferring' });
  const inferred = await inferColumnMapping(grid, doc.firstPageText);
  const result = applyTemplate(grid, inferred.template, allText, { headerRowIndex: inferred.headerRowIndex });

  if (!result) {
    throw new ConvertError(
      'NO_TRANSACTIONS_FOUND',
      'The column mapping was inferred but no transaction rows could be read from it.',
    );
  }

  report({ stage: 'validating' });
  const validation = validate(result.transactions, summaryOf(result));
  const learnedNotices: string[] = [];

  // Only remember a mapping the running balance proves correct.
  //
  // The balance chain is an independent oracle: if every row follows from the
  // one before it, the columns were read right. A mapping that does not
  // reconcile is still returned for the user to review, but storing it would
  // let one bad inference silently mis-parse every future statement.
  if (validation.ok) {
    const storable = toStoredTemplate(inferred.mapping, grid, inferred.fingerprint);
    if (storable) {
      await store.put(storable).catch(() => undefined);
      learnedNotices.push(
        `This layout has been saved as "${storable.bankName}", so statements like it will be converted without AI from now on.`,
      );
    }
  }

  return {
    ok: true,
    transactions: result.transactions,
    meta: { ...result.meta, parsedBy: 'llm', pageCount: doc.numPages },
    validation,
    notices: [...notices, ...result.notices, ...inferred.notices, ...learnedNotices],
  };
}

/** The fields `validate` needs from a parse result. */
function summaryOf(result: ApplyResult) {
  return {
    openingBalance: result.meta.openingBalance,
    closingBalance: result.meta.closingBalance,
    statedTransactionCount: result.meta.statedTransactionCount,
  };
}
