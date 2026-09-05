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

export const NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER = 'normalized-email-document-v1.1';

export interface NormalizeEmailDocumentV1Options {
  rawRef?: RawEmailReference | null;
  traceId?: string | null;
  normalizerVersion?: string;
  maxBodyTextChars?: number;
}

function decodeNumericHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ' ';
    })
    .replace(/&#([0-9]{1,7});?/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ' ';
    });
}

function stripHiddenHtml(html: string): { html: string; removed: boolean } {
  let next = html;
  const before = next;
  next = next
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');

  const hiddenBlock = /<([a-z0-9]+)\b(?=[^>]*(?:\bhidden\b|\baria-hidden\s*=\s*["']?true["']?|\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)[^"']*["']))[^>]*>[\s\S]*?<\/\1\s*>/gi;
  for (let pass = 0; pass < 8; pass += 1) {
    const stripped = next.replace(hiddenBlock, ' ');
    if (stripped === next) break;
    next = stripped;
  }

  return { html: next, removed: next !== before };
}

function quotedHistoryBoundary(text: string): number | null {
  const lines = text.split(/\r?\n/);
  let offset = 0;
  let authoredChars = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const strongBoundary = (
      /^>/.test(trimmed)
      || /^-{2,}\s*(?:original message|forwarded message|eredeti üzenet|eredeti uzenet)\s*-{2,}$/i.test(trimmed)
      || /^on .{3,160} wrote:\s*$/i.test(trimmed)
      || /^am .{3,160} schrieb .{0,80}:\s*$/i.test(trimmed)
      || /^le .{3,160} a écrit\s*:\s*$/i.test(trimmed)
      || /^el .{3,160} escribió\s*:\s*$/i.test(trimmed)
      || /\bezt írta\s*\(|\bezt irta\s*\(/i.test(trimmed)
    );
    if (strongBoundary && authoredChars >= 12) return offset;
    authoredChars += trimmed.length;
    offset += line.length + 1;
  }
  return null;
}

function bounded(value: string, maxChars: number): { value: string; truncated: boolean } {
  return {
    value: value.slice(0, maxChars),
    truncated: value.length > maxChars,
  };
}

function semanticTextOf(bodyText: string | null, maxChars: number) {
  if (!bodyText) {
    return { value: null as string | null, truncated: false, quotedHistoryDetected: false };
  }
  const boundary = quotedHistoryBoundary(bodyText);
  const current = boundary === null ? bodyText : bodyText.slice(0, boundary).trim();
  const clipped = bounded(current, maxChars);
  return {
    value: clipped.value.trim() || null,
    truncated: clipped.truncated,
    quotedHistoryDetected: boundary !== null,
  };
}

/**
 * Provider-neutral MailLens normalization stage. It produces the single stable
 * evidence document consumed by source privacy gates, deterministic parsing,
 * universal semantics and future EventMind input. It never decides identity.
 */
export function normalizeEmailDocumentV1(
  email: NormalizedEmail,
  options: NormalizeEmailDocumentV1Options = {},
): NormalizedEmailDocumentV1 {
  const maxBodyTextChars = Math.min(
    Math.max(options.maxBodyTextChars ?? 100_000, 1_000),
    500_000,
  );

  let bodyTextSource: 'provider_plain' | 'html_derived' | 'snippet_fallback' | 'none' = 'none';
  let hiddenHtmlRemoved = false;
  let rawBodyText: string | null = null;

  const suppliedText = email.bodyText?.trim() || null;
  if (suppliedText) {
    bodyTextSource = 'provider_plain';
    rawBodyText = suppliedText;
  } else if (email.bodyHtml) {
    bodyTextSource = 'html_derived';
    const sanitized = stripHiddenHtml(decodeNumericHtmlEntities(email.bodyHtml));
    hiddenHtmlRemoved = sanitized.removed;
    rawBodyText = htmlToCompactText(sanitized.html, maxBodyTextChars + 1).trim() || null;
  } else if (email.snippet?.trim()) {
    bodyTextSource = 'snippet_fallback';
    rawBodyText = email.snippet.trim();
  }

  const boundedBody = rawBodyText
    ? bounded(rawBodyText, maxBodyTextChars)
    : { value: '', truncated: false };
  const bodyText = boundedBody.value || null;
  const semantic = semanticTextOf(bodyText, maxBodyTextChars);

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
    semanticText: semantic.value,
    structuredData,
    links,
    authentication,
    normalization: {
      bodyTextSource,
      bodyTextTruncated: boundedBody.truncated,
      semanticTextTruncated: semantic.truncated || boundedBody.truncated,
      hiddenHtmlRemoved,
      quotedHistoryDetected: semantic.quotedHistoryDetected,
    },
    rawRef: options.rawRef ?? null,
    normalizerVersion: options.normalizerVersion ?? NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER,
    traceId: options.traceId ?? null,
  });
}

/**
 * Re-materializes the MailLens semantic view as the legacy NormalizedEmail
 * contract. Raw HTML remains in the MailLens document/archive but is omitted
 * here so legacy semantic stages cannot accidentally bypass hidden/quote rules.
 */
export function mailLensSemanticEmailV1(
  email: NormalizedEmail,
  maxBodyTextChars = 100_000,
): NormalizedEmail {
  const document = normalizeEmailDocumentV1(email, { maxBodyTextChars });
  return {
    provider: document.provider,
    providerMessageId: document.providerMessageId,
    ...(document.providerThreadId ? { providerThreadId: document.providerThreadId } : {}),
    ...(document.subject ? { subject: document.subject } : {}),
    from: document.from,
    to: document.to,
    cc: document.cc,
    bcc: document.bcc,
    receivedAt: document.receivedAt,
    ...(document.snippet ? { snippet: document.snippet } : {}),
    ...(document.semanticText ? { bodyText: document.semanticText } : {}),
    headers: document.headers,
    folders: document.folders,
    attachments: document.attachments,
  };
}
