import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { currentMessageLines } from './event-type-extractor.js';
import type { EvidenceBundle, EvidenceClaim } from './types.js';

export const CORROBORATED_TRACKING_EVIDENCE_VERSION = 'corroborated-tracking-evidence-v1';

const TRANSPORT_CONTEXT = /\b(?:csomag|kuldemeny|kezbesit|szallitas|szallitmany|futar|futarszolgalat|nyomkovet|tracking|shipment|parcel|package|delivery|courier|carrier)\w*\b/i;
const LONG_NUMERIC_IDENTIFIER = /\b\d{20,30}\b/g;

function normalized(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function isStrongShipmentOrDeliveryClaim(claim: EvidenceClaim): boolean {
  return claim.field === 'event_type'
    && (claim.value === 'shipment' || claim.value === 'delivery')
    && Number.isFinite(claim.confidence)
    && claim.confidence >= 0.90;
}

function isCarrierEvidence(claim: EvidenceClaim): boolean {
  return claim.field === 'carrier'
    && typeof claim.value === 'string'
    && Boolean(claim.value.trim())
    && Number.isFinite(claim.confidence)
    && claim.confidence >= 0.79;
}

function claimedNonTrackingIdentifiers(bundle: EvidenceBundle): Set<string> {
  const protectedFields = new Set(['order_number', 'invoice_number', 'payment_reference']);
  return new Set(bundle.claims
    .filter((claim) => protectedFields.has(claim.field))
    .map((claim) => normalized(claim.value))
    .filter(Boolean));
}

/**
 * A long bare number is not tracking evidence by itself. It becomes eligible only
 * when independent v2 evidence already proves a shipment/delivery context and a
 * carrier, the current message contains transport language, and exactly one long
 * identifier remains after excluding known order/invoice/payment identifiers.
 */
export function deriveCorroboratedTrackingEvidence(
  document: EmailDocumentV1,
  bundle: EvidenceBundle,
): EvidenceClaim<string>[] {
  if (!bundle.claims.some(isStrongShipmentOrDeliveryClaim)) return [];
  if (!bundle.claims.some(isCarrierEvidence)) return [];

  const currentText = [document.subject ?? '', ...currentMessageLines(document.text)].join('\n');
  if (!TRANSPORT_CONTEXT.test(currentText)) return [];

  const protectedIds = claimedNonTrackingIdentifiers(bundle);
  const candidates = [...new Set(
    [...currentText.matchAll(LONG_NUMERIC_IDENTIFIER)]
      .map((match) => normalized(match[0]))
      .filter((value) => value && !protectedIds.has(value)),
  )];

  if (candidates.length !== 1) return [];

  return [{
    field: 'tracking_number',
    value: candidates[0]!,
    confidence: 0.93,
    source: 'document_structure',
    extractorId: 'corroborated-tracking-evidence',
    extractorVersion: CORROBORATED_TRACKING_EVIDENCE_VERSION,
    qualifiers: ['corroborated_long_tracking_identifier'],
  }];
}
