import type {
  EmailAddress,
  EmailAttachmentMetadata,
  EmailHeader,
  NormalizedEmail,
} from './types.js';

export type SesVerdictStatus =
  | 'PASS'
  | 'FAIL'
  | 'GRAY'
  | 'PROCESSING_FAILED'
  | 'UNKNOWN';

export type SesSecurityDisposition = 'accept' | 'quarantine' | 'reject';

interface SesVerdictLike {
  status?: string;
}

interface SesCommonHeadersLike {
  from?: string[];
  to?: string[];
  cc?: string[];
  subject?: string;
  messageId?: string;
  date?: string;
}

interface SesMailLike {
  timestamp?: string;
  messageId?: string;
  destination?: string[];
  headers?: Array<{ name?: string; value?: string }>;
  commonHeaders?: SesCommonHeadersLike;
}

interface SesReceiptLike {
  timestamp?: string;
  recipients?: string[];
  spamVerdict?: SesVerdictLike;
  virusVerdict?: SesVerdictLike;
  spfVerdict?: SesVerdictLike;
  dkimVerdict?: SesVerdictLike;
  dmarcVerdict?: SesVerdictLike;
}

export interface SesInboundNotificationLike {
  mail?: SesMailLike;
  receipt?: SesReceiptLike;
}

export interface SesSecuritySignals {
  spam: SesVerdictStatus;
  virus: SesVerdictStatus;
  spf: SesVerdictStatus;
  dkim: SesVerdictStatus;
  dmarc: SesVerdictStatus;
}

export interface SesInboundMetadata {
  providerMessageId: string;
  receivedAt: string;
  recipients: string[];
  buyflowRecipients: string[];
  subject?: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  headers: EmailHeader[];
  security: SesSecuritySignals;
  disposition: SesSecurityDisposition;
}

function normalizedVerdict(value: string | undefined): SesVerdictStatus {
  const normalized = value?.trim().toUpperCase();
  if (
    normalized === 'PASS' ||
    normalized === 'FAIL' ||
    normalized === 'GRAY' ||
    normalized === 'PROCESSING_FAILED'
  ) {
    return normalized;
  }
  return 'UNKNOWN';
}

function dedupeLower(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function emailFromAddressText(value: string): EmailAddress | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angle = trimmed.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (angle?.[2]) {
    const name = (angle[1] ?? '').trim().replace(/^"|"$/g, '').trim();
    return {
      email: angle[2].trim().toLowerCase(),
      ...(name ? { name } : {}),
    };
  }

  const plain = trimmed.match(/([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (!plain?.[1]) return null;
  return { email: plain[1].trim().toLowerCase() };
}

function normalizeAddressList(values: string[] | undefined): EmailAddress[] {
  return (values ?? [])
    .map(emailFromAddressText)
    .filter((value): value is EmailAddress => Boolean(value));
}

function normalizeHeaders(values: SesMailLike['headers']): EmailHeader[] {
  return (values ?? [])
    .filter((header) => Boolean(header.name?.trim()) && header.value !== undefined)
    .map((header) => ({
      name: header.name!.trim(),
      value: String(header.value),
    }));
}

export function classifySesSecurity(signals: SesSecuritySignals): SesSecurityDisposition {
  if (signals.virus === 'FAIL') return 'reject';
  if (
    signals.spam === 'FAIL' ||
    signals.spam === 'PROCESSING_FAILED' ||
    signals.virus === 'PROCESSING_FAILED'
  ) {
    return 'quarantine';
  }

  // Authentication verdicts remain evidence for merchant/sender trust. They do not
  // delete or drop a transactional email on their own because legitimate senders
  // can still arrive with GRAY/FAIL during forwarding or imperfect DNS setup.
  return 'accept';
}

export function extractBuyFlowRecipients(
  recipients: string[],
  buyflowDomain = 'buyflow.hu',
): string[] {
  const expectedDomain = buyflowDomain.trim().toLowerCase().replace(/^@/, '');
  return dedupeLower(recipients).filter((recipient) => {
    const at = recipient.lastIndexOf('@');
    if (at <= 0) return false;
    return recipient.slice(at + 1) === expectedDomain;
  });
}

export function normalizeSesInboundMetadata(
  notification: SesInboundNotificationLike,
  buyflowDomain = 'buyflow.hu',
): SesInboundMetadata {
  const mail = notification.mail;
  const receipt = notification.receipt;
  const providerMessageId = mail?.messageId?.trim();
  if (!providerMessageId) {
    throw new Error('SES inbound notification is missing mail.messageId');
  }

  const receivedAt = receipt?.timestamp?.trim() || mail?.timestamp?.trim();
  if (!receivedAt || Number.isNaN(Date.parse(receivedAt))) {
    throw new Error('SES inbound notification is missing a valid receipt timestamp');
  }

  const recipients = dedupeLower(
    (receipt?.recipients?.length ? receipt.recipients : mail?.destination) ?? [],
  );

  const security: SesSecuritySignals = {
    spam: normalizedVerdict(receipt?.spamVerdict?.status),
    virus: normalizedVerdict(receipt?.virusVerdict?.status),
    spf: normalizedVerdict(receipt?.spfVerdict?.status),
    dkim: normalizedVerdict(receipt?.dkimVerdict?.status),
    dmarc: normalizedVerdict(receipt?.dmarcVerdict?.status),
  };

  return {
    providerMessageId,
    receivedAt: new Date(receivedAt).toISOString(),
    recipients,
    buyflowRecipients: extractBuyFlowRecipients(recipients, buyflowDomain),
    ...(mail?.commonHeaders?.subject ? { subject: mail.commonHeaders.subject } : {}),
    from: normalizeAddressList(mail?.commonHeaders?.from),
    to: normalizeAddressList(mail?.commonHeaders?.to ?? mail?.destination),
    cc: normalizeAddressList(mail?.commonHeaders?.cc),
    headers: normalizeHeaders(mail?.headers),
    security,
    disposition: classifySesSecurity(security),
  };
}

export function toNormalizedSesEmail(input: {
  metadata: SesInboundMetadata;
  bodyHtml?: string;
  snippet?: string;
  attachments?: EmailAttachmentMetadata[];
}): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: input.metadata.providerMessageId,
    subject: input.metadata.subject,
    from: input.metadata.from,
    to: input.metadata.to,
    cc: input.metadata.cc,
    bcc: [],
    receivedAt: input.metadata.receivedAt,
    ...(input.snippet ? { snippet: input.snippet } : {}),
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    headers: input.metadata.headers,
    folders: ['inbound'],
    attachments: input.attachments ?? [],
  };
}
