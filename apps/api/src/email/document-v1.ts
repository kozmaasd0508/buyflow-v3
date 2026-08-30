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

export interface EmailAuthenticationResults {
  dkim: EmailAuthenticationVerdict;
  spf: EmailAuthenticationVerdict;
  dmarc: EmailAuthenticationVerdict;
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
  bodyText: string | null;
  bodyHtml: string | null;
  headers: EmailHeader[];
  folders: string[];
  attachments: EmailAttachmentMetadata[];
  structuredData: EmailStructuredDataRecord[];
  links: NormalizedEmailLink[];
  authentication: EmailAuthenticationResults;
  rawRef: RawEmailReference | null;
  normalizerVersion: string;
  traceId: string | null;
}

export interface UpgradeNormalizedEmailOptions {
  bodyText?: string | null;
  structuredData?: EmailStructuredDataRecord[];
  links?: NormalizedEmailLink[];
  authentication?: Partial<EmailAuthenticationResults>;
  rawRef?: RawEmailReference | null;
  normalizerVersion?: string;
  traceId?: string | null;
}

const UNKNOWN_AUTHENTICATION: EmailAuthenticationResults = {
  dkim: 'unknown',
  spf: 'unknown',
  dmarc: 'unknown',
};

/**
 * Backwards-compatible adapter for the current provider contract.
 * It intentionally does not invent plain text, structured data or authentication
 * results that the provider did not supply.
 */
export function upgradeNormalizedEmailToDocumentV1(
  email: NormalizedEmail,
  options: UpgradeNormalizedEmailOptions = {},
): NormalizedEmailDocumentV1 {
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
    bodyText: options.bodyText ?? null,
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
    rawRef: options.rawRef ?? null,
    normalizerVersion: options.normalizerVersion ?? 'email-document-v1',
    traceId: options.traceId ?? null,
  };
}
