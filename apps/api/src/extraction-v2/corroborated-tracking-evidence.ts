import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { currentMessageLines } from './event-type-extractor.js';
import type { EvidenceBundle, EvidenceClaim } from './types.js';

export const CORROBORATED_TRACKING_EVIDENCE_VERSION = 'corroborated-tracking-evidence-v3';

const TRANSPORT_CONTEXT = /\b(?:csomag|kuldemeny|kezbesit|szallitas|szallitmany|futar|futarszolgalat|nyomkovet|tracking|shipment|parcel|package|delivery|courier|carrier)\w*\b/i;
const TRACKING_LABEL_CONTEXT = /\b(?:tracking|nyomkovet|kuldemeny\s*(?:szam|azonosito)|fuvarlevel\s*szam|csomag\s*szam|parcel\s*(?:number|id)|shipment\s*(?:number|id))\w*\b/i;
const NUMERIC_IDENTIFIER = /\b\d{10,30}\b/g;
const LONG_NUMERIC_IDENTIFIER = /\b\d{20,30}\b/g;

function normalized(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ');
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

function numericIdentifiersNearTrackingContext(document: EmailDocumentV1): string[] {
  const lines = [document.subject ?? '', ...currentMessageLines(document.text)];
  const candidates: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeText(lines[index] ?? '');
    const isSubject = index === 0;
    const hasRelevantContext = isSubject
      ? TRANSPORT_CONTEXT.test(line)
      : TRACKING_LABEL_CONTEXT.test(line);
    if (!hasRelevantContext) continue;

    for (const match of line.matchAll(NUMERIC_IDENTIFIER)) {
      candidates.push(normalized(match[0]));
    }

    if (!isSubject && TRACKING_LABEL_CONTEXT.test(line)) {
      const nextLine = normalizeText(lines[index + 1] ?? '');
      for (const match of nextLine.matchAll(NUMERIC_IDENTIFIER)) {
        candidates.push(normalized(match[0]));
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

function longNumericIdentifiersInTransportMessage(document: EmailDocumentV1): string[] {
  const currentText = normalizeText([
    document.subject ?? '',
    ...currentMessageLines(document.text),
  ].join('\n'));
  if (!TRANSPORT_CONTEXT.test(currentText)) return [];
  return [...new Set(
    [...currentText.matchAll(LONG_NUMERIC_IDENTIFIER)]
      .map((match) => normalized(match[0]))
      .filter(Boolean),
  )];
}

/**
 * Numeric identifiers are never tracking evidence by themselves. Shorter carrier
 * ids (10-19 digits) require local subject/label context. Very long ids (20-30
 * digits) may also be corroborated from the current transport message as a whole,
 * preserving the earlier conservative rule for long airwaybill-style identities.
 * In every case shipment/delivery + carrier evidence is mandatory and known
 * order/invoice/payment identifiers are excluded before resolving exactly one id.
 */
export function deriveCorroboratedTrackingEvidence(
  document: EmailDocumentV1,
  bundle: EvidenceBundle,
): EvidenceClaim<string>[] {
  if (!bundle.claims.some(isStrongShipmentOrDeliveryClaim)) return [];
  if (!bundle.claims.some(isCarrierEvidence)) return [];

  const protectedIds = claimedNonTrackingIdentifiers(bundle);
  const candidates = [...new Set([
    ...numericIdentifiersNearTrackingContext(document),
    ...longNumericIdentifiersInTransportMessage(document),
  ])].filter((value) => !protectedIds.has(value));

  if (candidates.length !== 1) return [];

  return [{
    field: 'tracking_number',
    value: candidates[0]!,
    confidence: 0.93,
    source: 'document_structure',
    extractorId: 'corroborated-tracking-evidence',
    extractorVersion: CORROBORATED_TRACKING_EVIDENCE_VERSION,
    qualifiers: ['corroborated_numeric_tracking_identifier'],
  }];
}
