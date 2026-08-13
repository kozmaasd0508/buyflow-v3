import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender, merchantDisplayName } from '../email/sender-role.js';

const PARSER_VERSION = 'deterministic-pre-advice-v1';

export interface PreAdviceCommerceParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
  shipmentPhase: 'shipment_created';
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function shipmentExtraction(input: {
  merchant: string;
  orderNumber: string;
  trackingNumber: string;
  carrier: string | null;
}): EmailExtraction {
  return {
    event_type: 'shipment',
    merchant: input.merchant,
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
    carrier: input.carrier,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
  };
}

function carrierFromText(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/express\s*one|expressone/.test(normalized)) return 'Express One';
  if (/\bgls\b/.test(normalized)) return 'GLS';
  if (/\bdpd\b/.test(normalized)) return 'DPD';
  if (/\bfoxpost\b/.test(normalized)) return 'Foxpost';
  if (/\bpacketa\b/.test(normalized)) return 'Packeta';
  if (/\bdhl\b/.test(normalized)) return 'DHL';
  if (/\bups\b/.test(normalized)) return 'UPS';
  return null;
}

function parseGymBeamPreAdvice(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): PreAdviceCommerceParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'gymbeam')) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;

  const shipmentSubject = /\bmegrendelesed uton van\b/i.test(subject);
  const packed = /\bbecsomagoltuk\b/i.test(body);
  const futureHandoff = /\bhamarosan\b[\s\S]{0,120}\b(?:szallito ceg|futarszolgalat)\b[\s\S]{0,80}\bkezebe kerul\b/i.test(body);
  if (!shipmentSubject || !packed || !futureHandoff) return null;

  const orderMatch = body.match(/\ba\s+(\d{8,20})\s+szamu\s+rendelesed(?:et)?\b/i);
  const trackingMatch = body.match(/\ba\s+([a-z0-9-]{10,32})\s+szammal\s+kovetheted\s+a\s+csomagot\b/i);
  const carrier = carrierFromText(context);
  if (!orderMatch?.[1] || !trackingMatch?.[1] || !carrier) return null;

  return {
    extraction: shipmentExtraction({
      merchant: merchantDisplayName('gymbeam'),
      orderNumber: orderMatch[1],
      trackingNumber: trackingMatch[1].toUpperCase(),
      carrier,
    }),
    parserVersion: PARSER_VERSION,
    shipmentPhase: 'shipment_created',
    reasons: [
      'known_gymbeam_sender',
      'explicit_packed_evidence',
      'explicit_future_carrier_handoff',
      'explicit_order_number',
      'explicit_tracking_number',
    ],
  };
}

function parseJatektengerPreAdvice(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): PreAdviceCommerceParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'jatektenger')) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;

  const statusMail = /\bmegrendeles statusz modositas\b/i.test(subject);
  const statedHandoff = /\bcsomag atadva a futarszolgalatnak kiszallitashoz\b/i.test(body);
  const explicitFutureHandoff = /\ba kovetkezo atadaskor atadjak a futarszolgalat reszere\b/i.test(body);
  if (!statusMail || !statedHandoff || !explicitFutureHandoff) return null;

  const orderMatch = body.match(/\bazonosito\s*[:#-]?\s*(\d{4,8}-\d{4,12})\b/i);
  const trackingMatch = body.match(/\bcsomagszam\s*[:#-]?\s*([a-z0-9-]{10,32})\b/i);
  const carrier = carrierFromText(context);
  if (!orderMatch?.[1] || !trackingMatch?.[1] || !carrier) return null;

  return {
    extraction: shipmentExtraction({
      merchant: merchantDisplayName('jatektenger'),
      orderNumber: orderMatch[1],
      trackingNumber: trackingMatch[1].toUpperCase(),
      carrier,
    }),
    parserVersion: PARSER_VERSION,
    shipmentPhase: 'shipment_created',
    reasons: [
      'known_jatektenger_sender',
      'merchant_status_claims_handoff',
      'body_explicitly_says_future_handoff',
      'explicit_order_number',
      'explicit_tracking_number',
    ],
  };
}

export function parseMerchantPreAdviceEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): PreAdviceCommerceParseResult | null {
  return parseGymBeamPreAdvice(input) ?? parseJatektengerPreAdvice(input);
}
