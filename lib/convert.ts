import { detectTemplate } from '@/lib/banks/registry';
import { applyTemplate } from '@/lib/parse/applyTemplate';
import { inferColumnMapping } from '@/lib/parse/llmFallback';
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
   * Whether the statement may be sent to the LLM when no template matches.
   * Off unless the user ticked the consent box — this transmits financial data
   * to a third party.
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
  const detected = detectTemplate(doc.firstPageText, options.bankHint);

  if (detected) {
    report({ stage: 'parsing', bankName: detected.template.bankName });
    const result = applyTemplate(grid, detected.template, allText);
    if (result) {
      report({ stage: 'validating' });
      const validation = validate(result.transactions, {
        openingBalance: result.meta.openingBalance,
        closingBalance: result.meta.closingBalance,
        statedTransactionCount: result.meta.statedTransactionCount,
      });

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
  const validation = validate(result.transactions, {
    openingBalance: result.meta.openingBalance,
    closingBalance: result.meta.closingBalance,
    statedTransactionCount: result.meta.statedTransactionCount,
  });

  return {
    ok: true,
    transactions: result.transactions,
    meta: { ...result.meta, parsedBy: 'llm', pageCount: doc.numPages },
    validation,
    notices: [...notices, ...result.notices, ...inferred.notices],
  };
}
