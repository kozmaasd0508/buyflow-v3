import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { currentMessageLines } from './event-type-extractor.js';

export type CarrierTechnicalEvidenceV16Kind = 'event' | 'tracking_number' | 'carrier';

export interface CarrierTechnicalEvidenceV16 {
  kind: CarrierTechnicalEvidenceV16Kind;
  rawValue: string;
  normalizedValue: string;
  namespace?: string;
  source: 'carrier_semantic';
  sourcePath: string;
  extractorId: 'carrier-semantic-evidence-v1.6';
  extractorVersion: '1.6.0';
  confidence: number;
  qualifiers: string[];
}

export interface CarrierTechnicalEvidenceV16Result {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: CarrierTechnicalEvidenceV16[];
}

function normalizeDomain(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function headerBlob(document: EmailDocumentV1): string {
  return document.headers
    .map((header) => `${header.name.trim().toLowerCase()}: ${String(header.value ?? '')}`)
    .join('\n');
}

/**
 * TechnicalEvidence v1.6 only grants provider namespace when the visible sender
 * domain and a stored authentication result agree. A forged From alone is not
 * enough. We accept either DKIM pass or DMARC pass for the exact provider/root.
 */
function hasAuthenticatedProvider(document: EmailDocumentV1, rootDomain: string): boolean {
  const primary = normalizeDomain(document.sender.primaryDomain);
  if (primary !== rootDomain && !primary.endsWith(`.${rootDomain}`)) return false;

  const headers = headerBlob(document);
  const escaped = rootDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dkim = new RegExp(`dkim=pass[^\\n]*(?:header\\.i=@|d=)(?:[a-z0-9.-]+\\.)?${escaped}\\b`, 'i').test(headers);
  const dmarc = new RegExp(`dmarc=pass[^\\n]*header\\.from=(?:[a-z0-9.-]+\\.)?${escaped}\\b`, 'i').test(headers);
  return dkim || dmarc;
}

function currentText(document: EmailDocumentV1): string {
  return currentMessageLines(document.text).join('\n').trim();
}

function pushCarrier(
  rows: CarrierTechnicalEvidenceV16[],
  carrier: string,
  namespace: string,
  sourcePath: string,
  qualifiers: string[],
  confidence = 0.998,
): void {
  rows.push({
    kind: 'carrier',
    rawValue: carrier,
    normalizedValue: carrier,
    namespace,
    source: 'carrier_semantic',
    sourcePath,
    extractorId: 'carrier-semantic-evidence-v1.6',
    extractorVersion: '1.6.0',
    confidence,
    qualifiers,
  });
}

function pushTracking(
  rows: CarrierTechnicalEvidenceV16[],
  rawValue: string,
  normalizedValue: string,
  namespace: string,
  sourcePath: string,
  qualifiers: string[],
  confidence = 0.998,
): void {
  rows.push({
    kind: 'tracking_number',
    rawValue,
    normalizedValue,
    namespace,
    source: 'carrier_semantic',
    sourcePath,
    extractorId: 'carrier-semantic-evidence-v1.6',
    extractorVersion: '1.6.0',
    confidence,
    qualifiers,
  });
}

function pushEvent(
  rows: CarrierTechnicalEvidenceV16[],
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
    extractorId: 'carrier-semantic-evidence-v1.6',
    extractorVersion: '1.6.0',
    confidence,
    qualifiers,
  });
}

function htmlHrefValues(html: string | null): string[] {
  if (!html) return [];
  const values: string[] = [];
  const pattern = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  for (const match of html.matchAll(pattern)) {
    const value = (match[1] ?? match[2] ?? '').replace(/&amp;/gi, '&').trim();
    if (value) values.push(value);
  }
  return values;
}

function packetaTrackingFromOfficialUrl(document: EmailDocumentV1): string | null {
  for (const raw of htmlHrefValues(document.html)) {
    try {
      const parsed = new URL(raw);
      if (normalizeDomain(parsed.hostname) !== 'tracking.packeta.com') continue;
      const id = parsed.searchParams.get('id')?.trim().toUpperCase() ?? '';
      if (/^Z\d{8,20}$/.test(id)) return id;
    } catch {
      // Malformed links are ignored; no fallback to generic id parameters.
    }
  }
  return null;
}

function normalizePacketaId(value: string): string | null {
  const normalized = value.replace(/[\s-]+/g, '').toUpperCase();
  return /^Z\d{8,20}$/.test(normalized) ? normalized : null;
}

function extractPacketa(document: EmailDocumentV1): CarrierTechnicalEvidenceV16[] {
  if (!hasAuthenticatedProvider(document, 'packeta.hu')) return [];
  const rows: CarrierTechnicalEvidenceV16[] = [];
  const subject = document.subject ?? '';
  const text = currentText(document);

  const labelledRaw = text.match(/\bCsomagsz[aá]m\s+(Z(?:[\s-]*\d){8,20})\b/i)?.[1]
    ?? text.match(/\bCsomag\s+(Z(?:[\s-]*\d){8,20})\b/i)?.[1]
    ?? null;
  const labelled = labelledRaw ? normalizePacketaId(labelledRaw) : null;
  const urlId = packetaTrackingFromOfficialUrl(document);
  const tracking = labelled ?? urlId;

  // Provider identity alone is neutral. A concrete provider-scoped parcel id is
  // required before carrier/tracking evidence is emitted.
  if (!tracking) return [];

  pushCarrier(rows, 'Packeta', 'PACKETA', 'authentication+packeta.parcel', [
    'authenticated_packeta_sender',
    'explicit_packeta_parcel_identity',
  ]);
  pushTracking(rows, labelledRaw ?? tracking, tracking, 'PACKETA', labelled
    ? 'body.packeta.labelled_parcel_number'
    : 'html.href.tracking.packeta.com.query.id', [
    'authenticated_packeta_sender',
    ...(labelled ? ['explicit_packeta_parcel_label'] : ['official_packeta_tracking_url']),
  ]);

  // Exact current recipient-delivery handoff semantics. This is intentionally
  // narrower than generic words such as "szállítás" or "csomag".
  if (/A\s+sz[aá]ll[ií]tm[aá]nyt\s+elfogadt[aá]k\s+a\s+sz[aá]ll[ií]t[aá]sra/i.test(subject)
    && /felad[oó]\s+most\s+adta\s+fel\s+az\s+[ÖO]n\s+csomagj[aá]t/i.test(text)) {
    pushEvent(rows, 'shipment', 'subject+body.packeta.accepted_transport', [
      'authenticated_packeta_sender',
      'packeta_accepted_for_transport_template',
      'recipient_delivery_context',
    ], 0.995);
  }

  return rows;
}

function expressOneTracking(document: EmailDocumentV1, text: string): { raw: string; value: string; sourcePath: string } | null {
  const patterns: Array<{ pattern: RegExp; sourcePath: string }> = [
    {
      pattern: /k[oö]vetkez[oő]\s+k[uü]ldem[eé]nysz[aá]mon\s*\(fuvarlev[eé]lsz[aá]mon\)[^\d]{0,120}(\d{18,32})\b/i,
      sourcePath: 'body.express_one.hu_waybill_label',
    },
    {
      pattern: /(?:following\s+)?air\s+waybill\s*:\s*(\d{18,32})\b/i,
      sourcePath: 'body.express_one.air_waybill',
    },
    {
      pattern: /shipment\s+is\s+registered\s+in\s+our\s+system\s+with\s+the\s+following\s+ID\s*:\s*(\d{18,32})\b/i,
      sourcePath: 'body.express_one.registered_id',
    },
    {
      pattern: /with\s+the\s+shipment\s+ID\s+(\d{18,32})\b/i,
      sourcePath: 'body.express_one.shipment_id',
    },
    {
      pattern: /\b(?:a\s+)?(\d{18,32})\s+k[uü]ldem[eé]nysz[aá]mon\s+nyilv[aá]ntartott\b/i,
      sourcePath: 'body.express_one.hu_shipment_number',
    },
    {
      pattern: /\b(?:[A-Za-z0-9 .&-]+\s+által\s+)?(\d{18,32})\s+sz[aá]mon\s+feladott\s+k[uü]ldem[eé]ny\b/i,
      sourcePath: 'body.express_one.delivered_shipment_number',
    },
  ];
  for (const item of patterns) {
    const raw = text.match(item.pattern)?.[1]?.trim();
    if (raw) return { raw, value: raw, sourcePath: item.sourcePath };
  }

  for (const raw of htmlHrefValues(document.html)) {
    try {
      const parsed = new URL(raw);
      if (normalizeDomain(parsed.hostname) !== 'tracking.expressone.hu') continue;
      const trackingNr = parsed.searchParams.get('trackingNr')?.trim() ?? '';
      if (/^\d{18,32}$/.test(trackingNr)) {
        return { raw: trackingNr, value: trackingNr, sourcePath: 'html.href.tracking.expressone.hu.query.trackingNr' };
      }
    } catch {
      // Ignore malformed URLs; opaque `h=` tokens are not shipment identity.
    }
  }
  return null;
}

function extractExpressOne(document: EmailDocumentV1): CarrierTechnicalEvidenceV16[] {
  if (!hasAuthenticatedProvider(document, 'expressone.hu')) return [];
  const rows: CarrierTechnicalEvidenceV16[] = [];
  const subject = document.subject ?? '';
  const text = currentText(document);
  const tracking = expressOneTracking(document, text);

  // Never treat an opaque tracking.expressone.hu `h=` redirect token as parcel
  // identity. Carrier evidence becomes authoritative only with an explicit long
  // shipment/waybill id.
  if (!tracking) return [];

  pushCarrier(rows, 'Express One', 'EXPRESS_ONE', 'authentication+express_one.waybill', [
    'authenticated_expressone_sender',
    'explicit_expressone_waybill',
  ]);
  pushTracking(rows, tracking.raw, tracking.value, 'EXPRESS_ONE', tracking.sourcePath, [
    'authenticated_expressone_sender',
    'explicit_expressone_waybill',
  ]);

  const physicalInbound = /feldolgoz[aá]s[aá]t\s+megkezdt[uü]k\s+a\s+k[oö]zponti\s+rakt[aá]runkban\s*\(fizik[aá]lisan\s+[eé]rkeztett[uü]k\)/i.test(text)
    || /processing\s+of\s+your\s+parcel[\s\S]{0,180}physical\s+inbound\s+has\s+been\s+done/i.test(text);
  const outForDelivery = /fut[aá]runk\s+a\s+mai\s+napon\s+k[eé]zbes[ií]t[eé]sre\s+[aá]tvette/i.test(text)
    || /our\s+(?:driver|courier)\s+is\s+going\s+to\s+deliver\s+a\s+shipment\s+to\s+you/i.test(text);
  const delivered = /K[uü]ldem[eé]ny\s+k[eé]zbes[ií]tve/i.test(subject)
    && (/k[uü]ldem[eé]ny[\s\S]{0,120}[aá]tad[aá]sra\s+ker[uü]lt/i.test(text)
      || /shipment[\s\S]{0,180}has\s+been\s+delivered/i.test(text));

  if (delivered) {
    pushEvent(rows, 'delivery', 'subject+body.express_one.delivered', [
      'authenticated_expressone_sender',
      'expressone_delivered_template',
      'recipient_delivery_context',
    ], 0.998);
  } else if (outForDelivery) {
    pushEvent(rows, 'shipment', 'subject+body.express_one.out_for_delivery', [
      'authenticated_expressone_sender',
      'expressone_out_for_delivery_template',
      'recipient_delivery_context',
    ], 0.995);
  } else if (physicalInbound) {
    pushEvent(rows, 'shipment', 'body.express_one.physical_inbound', [
      'authenticated_expressone_sender',
      'expressone_physical_inbound_template',
      'recipient_delivery_context',
    ], 0.992);
  }

  return rows;
}

export function collectCarrierTechnicalEvidenceV16(document: EmailDocumentV1): CarrierTechnicalEvidenceV16Result {
  return {
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: [
      ...extractPacketa(document),
      ...extractExpressOne(document),
    ],
  };
}
