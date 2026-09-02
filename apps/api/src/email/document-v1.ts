import type {
  EmailAddress,
  EmailAttachmentMetadata,
  EmailHeader,
  EmailProviderName,
  NormalizedEmail,
} from './types.js';

export type EmailAuthenticationVerdict =
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'neutral'
  | 'none'
  | 'temperror'
  | 'permerror'
  | 'unknown';

export type EmailAuthenticationSource =
  | 'authentication_results'
  | 'arc_authentication_results'
  | 'received_spf'
  | 'mixed'
  | 'none';

export interface EmailAuthenticationResults {
  dkim: EmailAuthenticationVerdict;
  spf: EmailAuthenticationVerdict;
  dmarc: EmailAuthenticationVerdict;
  /**
   * MailLens parses header evidence but does not authenticate the authserv-id.
   * Therefore these verdicts are diagnostic only and never hard trust evidence.
   */
  trusted: boolean;
  source: EmailAuthenticationSource;
  rawHeader?: string | null;
}

export type EmailStructuredDataKind = 'json_ld' | 'microdata' | 'schema_org' | 'other';

export interface EmailStructuredDataRecord {
  kind: EmailStructuredDataKind;
  schemaType?: string | null;
  payload: unknown;
  source: 'body_html' | 'body_text' | 'header' | 'attachment';
}

export interface NormalizedEmailLink {
  href: string;
  text?: string | null;
  rel?: string[];
  source: 'body_html' | 'body_text' | 'structured_data';
}

export type EmailBodyTextSource =
  | 'provider_plain'
  | 'html_derived'
  | 'snippet_fallback'
  | 'none'
  | 'legacy';

export interface EmailNormalizationMetadataV1 {
  bodyTextSource: EmailBodyTextSource;
  bodyTextTruncated: boolean;
  semanticTextTruncated: boolean;
  hiddenHtmlRemoved: boolean;
  quotedHistoryDetected: boolean;
}

/**
 * Immutable pointer to the original provider payload/MIME object.
 * Raw message bytes live in object storage, never inline in Postgres rows.
 */
export interface RawEmailReference {
  objectKey: string;
  sha256: string;
  sizeBytes: number | null;
  contentType: string | null;
  retainedUntil: string | null;
}

export interface NormalizedEmailDocumentV1 {
  schemaVersion: '1';
  provider: EmailProviderName;
  providerMessageId: string;
  providerThreadId: string | null;
  subject: string | null;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  receivedAt: string;
  snippet: string | null;
  /** Full bounded body evidence chosen by MailLens. */
  bodyText: string | null;
  /** Current authored/visible semantic text with quoted history excluded when safely detectable. */
  semanticText: string | null;
  bodyHtml: string | null;
  headers: EmailHeader[];
  folders: string[];
  attachments: EmailAttachmentMetadata[];
  structuredData: EmailStructuredDataRecord[];
  links: NormalizedEmailLink[];
  authentication: EmailAuthenticationResults;
  normalization: EmailNormalizationMetadataV1;
  rawRef: RawEmailReference | null;
  normalizerVersion: string;
  traceId: string | null;
}

export interface UpgradeNormalizedEmailOptions {
  bodyText?: string | null;
  semanticText?: string | null;
  structuredData?: EmailStructuredDataRecord[];
  links?: NormalizedEmailLink[];
  authentication?: Partial<EmailAuthenticationResults>;
  normalization?: Partial<EmailNormalizationMetadataV1>;
  rawRef?: RawEmailReference | null;
  normalizerVersion?: string;
  traceId?: string | null;
}

const UNKNOWN_AUTHENTICATION: EmailAuthenticationResults = {
  dkim: 'unknown',
  spf: 'unknown',
  dmarc: 'unknown',
  trusted: false,
  source: 'none',
};

function legacyNormalization(email: NormalizedEmail): EmailNormalizationMetadataV1 {
  return {
    bodyTextSource: email.bodyText
      ? 'provider_plain'
      : email.bodyHtml
        ? 'legacy'
        : email.snippet
          ? 'snippet_fallback'
          : 'none',
    bodyTextTruncated: false,
    semanticTextTruncated: false,
    hiddenHtmlRemoved: false,
    quotedHistoryDetected: false,
  };
}

/**
 * Backwards-compatible adapter for the current provider contract.
 * It intentionally does not invent structured data or authentication results
 * that the provider did not supply. Provider-supplied bodyText is preserved.
 */
export function upgradeNormalizedEmailToDocumentV1(
  email: NormalizedEmail,
  options: UpgradeNormalizedEmailOptions = {},
): NormalizedEmailDocumentV1 {
  const bodyText = options.bodyText ?? email.bodyText ?? null;
  return {
    schemaVersion: '1',
    provider: email.provider,
    providerMessageId: email.providerMessageId,
    providerThreadId: email.providerThreadId ?? null,
    subject: email.subject ?? null,
    from: email.from,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    receivedAt: email.receivedAt,
    snippet: email.snippet ?? null,
    bodyText,
    semanticText: options.semanticText ?? bodyText,
    bodyHtml: email.bodyHtml ?? null,
    headers: email.headers ?? [],
    folders: email.folders,
    attachments: email.attachments,
    structuredData: options.structuredData ?? [],
    links: options.links ?? [],
    authentication: {
      ...UNKNOWN_AUTHENTICATION,
      ...options.authentication,
    },
    normalization: {
      ...legacyNormalization(email),
      ...options.normalization,
    },
    rawRef: options.rawRef ?? null,
    normalizerVersion: options.normalizerVersion ?? 'email-document-v1',
    traceId: options.traceId ?? null,
  };
}
