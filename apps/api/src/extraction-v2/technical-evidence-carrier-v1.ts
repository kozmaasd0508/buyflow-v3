import type { EmailDocumentV1 } from '../ingestion/email-document.js';

export type CarrierTechnicalEvidenceKind = 'event' | 'tracking_number' | 'carrier';

export interface CarrierTechnicalEvidenceV1 {
  kind: CarrierTechnicalEvidenceKind;
  rawValue: string;
  normalizedValue: string;
  namespace?: string;
  source: 'carrier_semantic';
  sourcePath: string;
  extractorId: 'carrier-semantic-evidence-v1';
  extractorVersion: '1.0.0';
  confidence: number;
  qualifiers: string[];
}

export interface CarrierTechnicalEvidenceV1Result {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: CarrierTechnicalEvidenceV1[];
}

function normalizedDomain(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function pushCarrier(
  rows: CarrierTechnicalEvidenceV1[],
  carrier: string,
  namespace: string,
  confidence: number,
  qualifier: string,
): void {
  rows.push({
    kind: 'carrier',
    rawValue: carrier,
    normalizedValue: carrier,
    namespace,
    source: 'carrier_semantic',
    sourcePath: 'sender.primaryDomain',
    extractorId: 'carrier-semantic-evidence-v1',
    extractorVersion: '1.0.0',
    confidence,
    qualifiers: [qualifier, 'authenticated_sender_namespace_required'],
  });
}

function pushTracking(
  rows: CarrierTechnicalEvidenceV1[],
  value: string,
  namespace: string,
  sourcePath: string,
  qualifiers: string[],
  confidence = 0.995,
): void {
  rows.push({
    kind: 'tracking_number',
    rawValue: value,
    normalizedValue: value.toUpperCase(),
    namespace,
    source: 'carrier_semantic',
    sourcePath,
    extractorId: 'carrier-semantic-evidence-v1',
    extractorVersion: '1.0.0',
    confidence,
    qualifiers,
  });
}

function pushEvent(
  rows: CarrierTechnicalEvidenceV1[],
  event: 'shipment' | 'delivery',
  sourcePath: string,
  qualifiers: string[],
  confidence: number,
): void {
  rows.push({
    kind: 'event',
    rawValue: event,
    normalizedValue: event,
    source: 'carrier_semantic',
    sourcePath,
    extractorId: 'carrier-semantic-evidence-v1',
    extractorVersion: '1.0.0',
    confidence,
    qualifiers,
  });
}

function extractDpd(document: EmailDocumentV1): CarrierTechnicalEvidenceV1[] {
  if (normalizedDomain(document.sender.primaryDomain) !== 'dpd.hu') return [];
  const rows: CarrierTechnicalEvidenceV1[] = [];
  const subject = document.subject ?? '';
  const text = document.text ?? '';
  const parcel = subject.match(/^Értesítés\s+(\d{12,16})\b/i)?.[1]
    ?? text.match(/\b(\d{12,16})\b(?=[\s\S]{0,40}(?:küldemény|csomag))/i)?.[1];

  pushCarrier(rows, 'DPD', 'DPD', 0.995, 'dpd_sender_domain');
  if (parcel) {
    pushTracking(rows, parcel, 'DPD', 'subject.dpd.parcel_number', ['dpd_sender_domain', 'dpd_notification_subject']);
  }

  if (/sikeres\s+kézbesítéséről/i.test(subject) && /sikeresen\s+kézbesítettük/i.test(text)) {
    pushEvent(rows, 'delivery', 'subject+body.dpd.delivered', ['dpd_delivered_template'], 0.995);
  } else if (/küldemény\s+mai\s+kézbesítéséről/i.test(subject)
    && /futárunk\s+a\s+mai\s+napon\s+kézbesítésre\s+átvette/i.test(text)) {
    pushEvent(rows, 'shipment', 'subject+body.dpd.out_for_delivery', ['dpd_out_for_delivery_template'], 0.99);
  } else if (/küldemény\s+feladásáról/i.test(subject)
    && /(?:adott\s+fel|feladott\s+csomag)/i.test(text)) {
    pushEvent(rows, 'shipment', 'subject+body.dpd.shipped', ['dpd_shipment_template'], 0.99);
  }

  return rows;
}

function extractFoxpost(document: EmailDocumentV1): CarrierTechnicalEvidenceV1[] {
  if (normalizedDomain(document.sender.primaryDomain) !== 'foxpost.hu') return [];
  const rows: CarrierTechnicalEvidenceV1[] = [];
  const subject = document.subject ?? '';
  const text = document.text ?? '';

  pushCarrier(rows, 'Foxpost', 'FOXPOST', 0.995, 'foxpost_sender_domain');

  const foxIds = new Set<string>();
  for (const pattern of [
    /\bCsomagszám:\s*(CLFOX[A-Z0-9]{8,40})\b/gi,
    /\bFOXPOST\s+azonosítószáma:\s*(CLFOX[A-Z0-9]{8,40})\b/gi,
    /\bCsomagod\s+azonosítószáma:\s*(CLFOX[A-Z0-9]{8,40})\b/gi,
  ]) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) foxIds.add(match[1].toUpperCase());
    }
  }
  for (const id of foxIds) {
    pushTracking(rows, id, 'FOXPOST', 'body.foxpost.labelled_identifier', ['foxpost_sender_domain', 'explicit_foxpost_identifier_label']);
  }

  const packeta = text.match(/\bPacketa\s+azonosítószáma:\s*(Z\d{8,20})\b/i)?.[1];
  if (packeta) {
    pushTracking(rows, packeta, 'PACKETA', 'body.foxpost.packeta_identifier', ['foxpost_sender_domain', 'explicit_packeta_identifier_label'], 0.99);
  }

  // Pre-advice explicitly says the parcel has NOT been handed to Foxpost yet.
  // Keep the identity evidence, but do not promote it to a physical shipment event.
  if (/^Előértesítés$/i.test(subject) && /még\s+nem\s+adták\s+át\s+a\s+FOXPOST\s+részére/i.test(text)) {
    return rows;
  }

  if (/raktárunkban\s+van/i.test(subject) && /beérkezett\s+raktárunkba/i.test(text)) {
    pushEvent(rows, 'shipment', 'subject+body.foxpost.in_warehouse', ['foxpost_in_warehouse_template'], 0.99);
  } else if (/Csomagod\s+megérkezett/i.test(subject) && /megérkezett,?\s+amely\s+átvehető/i.test(text)) {
    pushEvent(rows, 'shipment', 'subject+body.foxpost.ready_for_pickup', ['foxpost_ready_for_pickup_template'], 0.995);
  }

  return rows;
}

function normalizePacketaTracking(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '');
  return /^Z\d{8,20}$/.test(normalized) ? normalized : null;
}

function extractPacketa(document: EmailDocumentV1): CarrierTechnicalEvidenceV1[] {
  // Keep provider authority narrow: marketing/newsletter subdomains are intentionally excluded.
  if (normalizedDomain(document.sender.primaryDomain) !== 'packeta.hu') return [];

  const rows: CarrierTechnicalEvidenceV1[] = [];
  const subject = document.subject ?? '';
  const text = document.text ?? '';

  pushCarrier(rows, 'Packeta', 'PACKETA', 0.995, 'packeta_sender_domain');

  const labelled = normalizePacketaTracking(
    text.match(/csomagja\s+Z-számát\s+(Z(?:[\s-]*\d){8,20})\b/i)?.[1] ?? '',
  );
  const parcelNumberLabel = normalizePacketaTracking(
    text.match(/\bCsomagszám\s*:?[\s]*(Z(?:[\s-]*\d){8,20})\b/i)?.[1] ?? '',
  );
  const linkLabel = normalizePacketaTracking(
    text.match(/csomag\s+nyomonkövetése\s+(Z(?:[\s-]*\d){8,20})\b/i)?.[1] ?? '',
  );
  const endpoint = normalizePacketaTracking(
    text.match(/https?:\/\/tracking\.packeta\.com\/?\?id=(Z\d{8,20})\b/i)?.[1] ?? '',
  );

  // A Packeta hard identifier requires corroboration by at least two independent
  // template primitives, and every present primitive must resolve to the same Z-id.
  const observedIds = [labelled, parcelNumberLabel, linkLabel, endpoint]
    .filter((value): value is string => Boolean(value));
  const uniqueIds = new Set(observedIds);
  const tracking = observedIds[0];
  if (tracking && observedIds.length >= 2 && uniqueIds.size === 1) {
    pushTracking(
      rows,
      tracking,
      'PACKETA',
      'body.packeta.corroborated_z_identifier',
      ['packeta_sender_domain', 'packeta_tracking_endpoint', 'corroborated_packeta_z_identifier'],
      0.995,
    );
  }

  const modernAcceptedForTransport = /átadta\s+nekünk\s+az\s+Ön\s+alábbi\s+megrendelését/i.test(text)
    && /szerződéses\s+szállítópartnerünk\s+fog\s+kézbesíteni/i.test(text);
  const legacyBuyerShipment = /feladó\s+most\s+adta\s+fel\s+az\s+Ön\s+csomagját/i.test(text)
    && /kerül\s+kézbesítésre/i.test(text);
  const acceptedForTransport = /^A\s+szállítmányt\s+elfogadták\s+a\s+szállításra$/i.test(subject)
    && (modernAcceptedForTransport || legacyBuyerShipment)
    && /tracking\.packeta\.com/i.test(text);

  if (acceptedForTransport) {
    pushEvent(
      rows,
      'shipment',
      'subject+body.packeta.accepted_for_transport',
      ['packeta_sender_domain', 'packeta_accepted_for_transport_template'],
      0.995,
    );
  }

  return rows;
}

export function collectCarrierTechnicalEvidenceV1(document: EmailDocumentV1): CarrierTechnicalEvidenceV1Result {
  const evidence = [
    ...extractDpd(document),
    ...extractFoxpost(document),
    ...extractPacketa(document),
  ];

  return {
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence,
  };
}
