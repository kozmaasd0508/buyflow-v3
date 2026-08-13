import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender, merchantDisplayName } from '../email/sender-role.js';

const PARSER_VERSION = 'deterministic-zalando-v1';

export interface ZalandoCommerceParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function shipmentExtraction(input: {
  orderNumber: string;
  trackingNumber: string;
  carrier?: string | null;
}): EmailExtraction {
  return {
    event_type: 'shipment',
    merchant: merchantDisplayName('zalando'),
    merchant_legal_name: null,
    order_number: input.orderNumber,
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
    carrier: input.carrier ?? null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
  };
}

export function parseZalandoCommerceEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): ZalandoCommerceParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'zalando')) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;

  const explicitShipment = /\bcsomagodat osszeallitottuk es utnak inditottuk\b/i.test(body)
    || /\bhurra!\s*utnak inditottuk\b/i.test(context);
  if (!explicitShipment) return null;

  const orderMatch = body.match(/\brendelesszam\s*[:#-]?\s*(\d{10,20})\b/i);
  const trackingMatch = body.match(/\ba nyomkovetesi szamod\s*:\s*([a-z0-9-]{8,32})\b/i);
  if (!orderMatch?.[1] || !trackingMatch?.[1]) return null;

  let carrier: string | null = null;
  if (/gls-group\.eu|\bgls\b/i.test(context)) carrier = 'GLS';
  else if (/\bdpd\b/i.test(context)) carrier = 'DPD';
  else if (/\bdhl\b/i.test(context)) carrier = 'DHL';
  else if (/\bups\b/i.test(context)) carrier = 'UPS';

  return {
    extraction: shipmentExtraction({
      orderNumber: orderMatch[1],
      trackingNumber: trackingMatch[1].toUpperCase(),
      carrier,
    }),
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_zalando_sender',
      'explicit_zalando_shipment_sentence',
      'explicit_order_number',
      'explicit_tracking_number',
      ...(carrier ? ['explicit_or_linked_carrier_evidence'] : []),
    ],
  };
}
