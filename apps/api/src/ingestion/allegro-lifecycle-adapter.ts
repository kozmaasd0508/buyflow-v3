import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { parseAllegroSalesDocumentEmail } from './allegro-sales-document-adapter.js';

const PARSER_VERSION = 'allegro-lifecycle-v1';
const ALLEGRO_SENDER_DOMAINS = new Set(['allegro.com', 'allegro.hu', 'allegro.pl', 'allegro.cz', 'allegro.sk']);
const ALLEGRO_RELAY_DOMAIN = 'allegromail.com';
const ORDER_UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export interface AllegroLifecycleParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
  shipmentPhase?: 'shipped' | 'out_for_delivery' | 'delivered';
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '');
}

function isExactSender(domains: string[], allowed: Set<string> | string): boolean {
  const normalized = domains.map(normalizeDomain);
  if (typeof allowed === 'string') return normalized.includes(allowed);
  return normalized.some((domain) => allowed.has(domain));
}

function extractPurchaseUuid(body: string): string | null {
  const match = body.match(new RegExp(`\\/vasarlasok\\/vasarlasi-elozmenyek\\/(${ORDER_UUID_PATTERN})(?:[?/#\\s]|$)`, 'i'));
  return match?.[1]?.toLowerCase() ?? null;
}

function extractTrackingFromMerchantBody(body: string): { carrier: string; tracking: string } | null {
  const normalized = normalizeText(body);
  const labelled = normalized.match(/\bszallitoi es kuldemenyazonosito\b[\s\S]{0,160}?\b(DPD|GLS|Packeta)\s+([A-Z0-9-]{8,32})\b/i);
  if (labelled?.[1] && labelled[2]) {
    return { carrier: labelled[1].toUpperCase() === 'PACKETA' ? 'Packeta' : labelled[1].toUpperCase(), tracking: labelled[2].toUpperCase() };
  }

  const compact = normalized.match(/\b(DPD|GLS|Packeta)\s+([A-Z0-9-]{8,32})\b/i);
  if (!compact?.[1] || !compact[2]) return null;
  return { carrier: compact[1].toUpperCase() === 'PACKETA' ? 'Packeta' : compact[1].toUpperCase(), tracking: compact[2].toUpperCase() };
}

function extractRelayTracking(subject: string): string | null {
  const match = normalizeText(subject).match(/^ertesites\s+([A-Z0-9-]{8,32})\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function extractRelayMerchant(subject: string, tracking: string): string | null {
  const normalized = normalizeText(subject);
  const escapedTracking = tracking.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`^ertesites\\s+${escapedTracking}\\s+(.{2,120}?)\\s+kuldemeny\\s+mai\\s+kezbesiteserol$`, 'i'));
  const merchant = match?.[1]?.trim() ?? null;
  return merchant && !/^DPD$/i.test(merchant) ? merchant : null;
}

function extraction(input: {
  eventType: 'shipment' | 'delivery';
  orderNumber?: string | null;
  trackingNumber: string;
  merchant?: string | null;
  carrier: string;
  confidence: number;
}): EmailExtraction {
  return {
    event_type: input.eventType,
    merchant: input.merchant ?? null,
    merchant_legal_name: null,
    order_number: input.orderNumber ?? null,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: input.trackingNumber,
    carrier: input.carrier,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: input.confidence,
  };
}

export function parseAllegroLifecycleEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AllegroLifecycleParseResult | null {
  const subject = normalizeText(input.subject ?? '');
  const body = input.bodyText ?? '';
  const normalizedBody = normalizeText(body);

  if (isExactSender(input.senderDomains, ALLEGRO_SENDER_DOMAINS)) {
    const orderNumber = extractPurchaseUuid(body);
    const logistics = extractTrackingFromMerchantBody(body);
    if (!orderNumber || !logistics) return null;

    const shippedSubject = /\bcsomagod mar uton van\b/i.test(subject);
    const explicitShipped = /\bcsomagodat most adtak fel\b/i.test(normalizedBody);
    if (shippedSubject && explicitShipped) {
      return {
        extraction: extraction({
          eventType: 'shipment',
          merchant: 'Allegro',
          orderNumber,
          trackingNumber: logistics.tracking,
          carrier: logistics.carrier,
          confidence: 0.995,
        }),
        parserVersion: PARSER_VERSION,
        shipmentPhase: 'shipped',
        reasons: [
          'known_allegro_sender',
          'explicit_allegro_shipped_subject',
          'explicit_purchase_history_uuid',
          'explicit_carrier_tracking_pair',
          'explicit_package_handed_off',
        ],
      };
    }

    const outForDeliverySubject = /\bfutar ma erkezik\b/i.test(subject);
    if (outForDeliverySubject) {
      return {
        extraction: extraction({
          eventType: 'shipment',
          merchant: 'Allegro',
          orderNumber,
          trackingNumber: logistics.tracking,
          carrier: logistics.carrier,
          confidence: 0.995,
        }),
        parserVersion: PARSER_VERSION,
        shipmentPhase: 'out_for_delivery',
        reasons: [
          'known_allegro_sender',
          'explicit_allegro_out_for_delivery_subject',
          'explicit_purchase_history_uuid',
          'explicit_carrier_tracking_pair',
        ],
      };
    }

    return null;
  }

  if (!isExactSender(input.senderDomains, ALLEGRO_RELAY_DOMAIN)) return null;

  const salesDocument = parseAllegroSalesDocumentEmail(input);
  if (salesDocument) return salesDocument;

  const tracking = extractRelayTracking(subject);
  if (!tracking) return null;

  if (/\bnemzetkozi kuldemeny feladasarol\b/i.test(subject)) {
    return {
      extraction: extraction({ eventType: 'shipment', trackingNumber: tracking, carrier: 'DPD', confidence: 0.99 }),
      parserVersion: PARSER_VERSION,
      shipmentPhase: 'shipped',
      reasons: ['known_allegro_dpd_relay', 'explicit_dpd_dispatch_subject', 'explicit_tracking_number'],
    };
  }

  if (/\bkuldemeny mai kezbesiteserol\b/i.test(subject)) {
    return {
      extraction: extraction({
        eventType: 'shipment',
        trackingNumber: tracking,
        merchant: extractRelayMerchant(subject, tracking),
        carrier: 'DPD',
        confidence: 0.99,
      }),
      parserVersion: PARSER_VERSION,
      shipmentPhase: 'out_for_delivery',
      reasons: ['known_allegro_dpd_relay', 'explicit_delivery_today_subject', 'explicit_tracking_number', 'future_delivery_not_delivered'],
    };
  }

  const deliveredSubject = /\bsikeres kezbesiteserol\b/i.test(subject);
  const deliveredBody = /\bsikeresen kezbesitettuk\b/i.test(normalizedBody);
  if (deliveredSubject && deliveredBody) {
    return {
      extraction: extraction({ eventType: 'delivery', trackingNumber: tracking, carrier: 'DPD', confidence: 0.995 }),
      parserVersion: PARSER_VERSION,
      shipmentPhase: 'delivered',
      reasons: ['known_allegro_dpd_relay', 'explicit_successful_delivery_subject', 'explicit_successful_delivery_body', 'explicit_tracking_number'],
    };
  }

  return null;
}
