import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { extractEmailAuthenticationResults } from './authentication-v1.js';
import {
  upgradeNormalizedEmailToDocumentV1,
  type RawEmailReference,
  type NormalizedEmailDocumentV1,
} from './document-v1.js';
import { extractNormalizedEmailLinks } from './link-extraction-v1.js';
import { extractStructuredDataRecords } from './structured-markup.js';
import type { NormalizedEmail } from './types.js';

export const NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER = 'normalized-email-document-v1';

export interface NormalizeEmailDocumentV1Options {
  rawRef?: RawEmailReference | null;
  traceId?: string | null;
  normalizerVersion?: string;
  maxBodyTextChars?: number;
}

/**
 * Provider-neutral normalization stage. It converts already-fetched provider
 * content into one stable document before deterministic extraction or AI.
 * No lifecycle or identity decision is made here.
 */
export function normalizeEmailDocumentV1(
  email: NormalizedEmail,
  options: NormalizeEmailDocumentV1Options = {},
): NormalizedEmailDocumentV1 {
  const maxBodyTextChars = Math.min(
    Math.max(options.maxBodyTextChars ?? 100_000, 1_000),
    500_000,
  );

  const suppliedText = email.bodyText?.trim() || null;
  const derivedText = !suppliedText && email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, maxBodyTextChars).trim() || null
    : null;
  const bodyText = (suppliedText ?? derivedText ?? email.snippet?.trim() ?? null)?.slice(0, maxBodyTextChars) ?? null;

  const structuredData = email.bodyHtml
    ? extractStructuredDataRecords(email.bodyHtml)
    : [];
  const links = extractNormalizedEmailLinks({
    bodyHtml: email.bodyHtml ?? null,
    bodyText,
    structuredData,
  });
  const authentication = extractEmailAuthenticationResults(email.headers ?? []);

  return upgradeNormalizedEmailToDocumentV1(email, {
    bodyText,
    structuredData,
    links,
    authentication,
    rawRef: options.rawRef ?? null,
    normalizerVersion: options.normalizerVersion ?? NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER,
    traceId: options.traceId ?? null,
  });
}
