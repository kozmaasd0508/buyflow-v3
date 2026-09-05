import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceProvenance } from './types.js';

export const PROVIDER_SENDER_AUTHORITY_V1 = 'provider-sender-authority-v1';
const GMAIL_TRUSTED_AUTHSERV_ID = 'mx.google.com';
const GMAIL_AUTHORITY_EXTRACTOR = 'gmail-provider-authentication-results';

function normalizeDomain(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  if (!normalized || normalized.length > 253) return null;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized)) return null;
  if (normalized.includes('..')) return null;
  return normalized;
}

function firstAuthenticationResultsHeader(document: EmailDocumentV1): string | null {
  const header = document.headers.find((item) =>
    item.name.trim().toLowerCase() === 'authentication-results'
  );
  return header?.value ?? null;
}

function authservId(value: string): string | null {
  const firstSegment = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return normalizeDomain(firstSegment);
}

function dmarcObservation(value: string): { verdict: string; headerFrom: string | null } | null {
  const segments = value.split(';').slice(1);
  for (const segment of segments) {
    const method = segment.match(/^\s*dmarc\s*=\s*([a-z_]+)/i);
    if (!method?.[1]) continue;
    const headerFrom = segment.match(/\bheader\.from\s*=\s*([^\s;]+)/i)?.[1] ?? null;
    return {
      verdict: method[1].trim().toLowerCase(),
      headerFrom: normalizeDomain(headerFrom?.replace(/^"|"$/g, '')),
    };
  }
  return null;
}

/**
 * Convert provider-verified sender authentication into explicit TrustLink
 * provenance. Raw message/header evidence is never trusted generically.
 *
 * Gmail v1 policy is intentionally strict:
 * - source provider must be Gmail;
 * - only the first Authentication-Results header is considered, because Gmail
 *   prepends its own receiving-MTA result ahead of message-supplied headers;
 * - authserv-id must be exactly mx.google.com;
 * - DMARC must pass;
 * - authenticated header.from must exactly match the normalized visible sender
 *   domain used by the canonical event.
 *
 * Any missing, malformed, contradictory or non-Gmail case returns no authority.
 */
export function deriveTrustedProviderSenderAuthorityProvenance(
  document: EmailDocumentV1,
): EvidenceProvenance[] {
  if (document.provider !== 'gmail') return [];

  const headerValue = firstAuthenticationResultsHeader(document);
  if (!headerValue) return [];
  if (authservId(headerValue) !== GMAIL_TRUSTED_AUTHSERV_ID) return [];

  const dmarc = dmarcObservation(headerValue);
  if (!dmarc || dmarc.verdict !== 'pass' || !dmarc.headerFrom) return [];

  const senderDomain = normalizeDomain(document.sender.primaryDomain);
  if (!senderDomain || senderDomain !== dmarc.headerFrom) return [];

  return [{
    field: 'sender_authority',
    source: 'provider_adapter',
    parserVersion: PROVIDER_SENDER_AUTHORITY_V1,
    extractorId: GMAIL_AUTHORITY_EXTRACTOR,
    extractorVersion: PROVIDER_SENDER_AUTHORITY_V1,
    confidence: null,
    qualifiers: [
      'trusted_sender_authority',
      'provider:gmail',
      `authserv_id:${GMAIL_TRUSTED_AUTHSERV_ID}`,
      'dmarc:pass',
      `header_from:${senderDomain}`,
    ],
  }];
}
