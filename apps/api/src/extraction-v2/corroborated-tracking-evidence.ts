import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { currentMessageLines } from './event-type-extractor.js';
import type { EvidenceBundle, EvidenceClaim } from './types.js';

export const CORROBORATED_TRACKING_EVIDENCE_VERSION = 'corroborated-tracking-evidence-v2';

const TRANSPORT_CONTEXT = /\b(?:csomag|kuldemeny|kezbesit|szallitas|szallitmany|futar|futarszolgalat|nyomkovet|tracking|shipment|parcel|package|delivery|courier|carrier)\w*\b/i;
const TRACKING_LABEL_CONTEXT = /\b(?:tracking|nyomkovet|kuldemeny\s*(?:szam|azonosito)|fuvarlevel\s*szam|csomag\s*szam|parcel\s*(?:number|id)|shipment\s*(?:number|id))\w*\b/i;
const NUMERIC_IDENTIFIER = /\b\d{10,30}\b/g;

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

function numericIdentifiersNearTrackingContext(document: EmailDocumentV1): string[] {
  const lines = [document.subject ?? '', ...currentMessageLines(document.text)];
  const candidates: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const normalizedLine = line.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ');
    const isSubject = index === 0;
    const hasRelevantContext = isSubject
      ? TRANSPORT_CONTEXT.test(normalizedLine)
      : TRACKING_LABEL_CONTEXT.test(normalizedLine);
    if (!hasRelevantContext) continue;

    for (const match of normalizedLine.matchAll(NUMERIC_IDENTIFIER)) {
      candidates.push(normalized(match[0]));
    }

    if (!isSubject && TRACKING_LABEL_CONTEXT.test(normalizedLine)) {
      const nextLine = lines[index + 1] ?? '';
      for (const match of nextLine.matchAll(NUMERIC_IDENTIFIER)) {
        candidates.push(normalized(match[0]));
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * A numeric identifier is not tracking evidence by itself. It becomes eligible
 * only when independent v2 evidence already proves shipment/delivery context and
 * carrier identity, and the number is located in a transport subject or next to
 * an explicit tracking/parcel label. This avoids accidentally promoting phone,
 * date, invoice or account numbers from the rest of the message.
 */
export function deriveCorroboratedTrackingEvidence(
  document: EmailDocumentV1,
  bundle: EvidenceBundle,
): EvidenceClaim<string>[] {
  if (!bundle.claims.some(isStrongShipmentOrDeliveryClaim)) return [];
  if (!bundle.claims.some(isCarrierEvidence)) return [];

  const protectedIds = claimedNonTrackingIdentifiers(bundle);
  const candidates = numericIdentifiersNearTrackingContext(document)
    .filter((value) => !protectedIds.has(value));

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
