import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { currentMessageLines } from './event-type-extractor.js';
import type { EvidenceBundle, EvidenceClaim } from './types.js';

export const CORROBORATED_EVENT_EVIDENCE_VERSION = 'corroborated-event-evidence-v1';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

function hasStrongClaim(bundle: EvidenceBundle, field: string, predicate: (value: unknown) => boolean, minimumConfidence = 0.9): boolean {
  return bundle.claims.some((claim) => (
    claim.field === field
    && claim.confidence >= minimumConfidence
    && predicate(claim.value)
  ));
}

function currentMessageText(document: EmailDocumentV1): string {
  return normalizeText([
    document.subject ?? '',
    ...currentMessageLines(document.text),
  ].join('\n'));
}

function hasInvoiceAttachment(document: EmailDocumentV1): boolean {
  return document.attachments.some((attachment) => {
    if (attachment.isInline) return false;
    const filename = normalizeText(attachment.filename ?? '');
    const contentType = normalizeText(attachment.contentType ?? '');
    const looksLikeDocument = /(?:\.pdf|\.xml|\.html?)$/i.test(filename)
      || /(?:pdf|xml|html)/i.test(contentType);
    return looksLikeDocument && /\b(?:invoice|receipt|szamla|nyugta|bizonylat)\b/i.test(filename);
  });
}

function invoiceContext(document: EmailDocumentV1): boolean {
  const text = currentMessageText(document);
  return /\b(?:invoice|receipt|szamla|nyugta|bizonylat)\b/i.test(text)
    || hasInvoiceAttachment(document);
}

export function deriveCorroboratedEventEvidence(
  document: EmailDocumentV1,
  bundle: EvidenceBundle,
): EvidenceClaim<string>[] {
  const claims: EvidenceClaim<string>[] = [];

  const refunded = hasStrongClaim(
    bundle,
    'payment_status',
    (value) => typeof value === 'string' && value.toLowerCase() === 'refunded',
    0.95,
  );
  if (refunded) {
    claims.push({
      field: 'event_type',
      value: 'refund',
      confidence: 0.985,
      source: 'document_structure',
      extractorId: 'corroborated-event-evidence',
      extractorVersion: CORROBORATED_EVENT_EVIDENCE_VERSION,
      qualifiers: ['corroborated_refund_status'],
    });
  }

  const explicitInvoiceNumber = hasStrongClaim(
    bundle,
    'invoice_number',
    (value) => typeof value === 'string' && value.trim().length >= 4,
    0.9,
  );
  const invoiceAttachment = hasInvoiceAttachment(document);
  const invoiceDocument = invoiceContext(document);

  if ((explicitInvoiceNumber && invoiceDocument) || invoiceAttachment) {
    claims.push({
      field: 'event_type',
      value: 'invoice_or_receipt',
      confidence: explicitInvoiceNumber ? 0.965 : 0.955,
      source: invoiceAttachment ? 'attachment' : 'document_structure',
      extractorId: 'corroborated-event-evidence',
      extractorVersion: CORROBORATED_EVENT_EVIDENCE_VERSION,
      qualifiers: ['corroborated_invoice_document'],
    });
  }

  return claims;
}
