import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender, merchantDisplayName } from '../email/sender-role.js';

const PARSER_VERSION = 'deterministic-aboutyou-v1';

export interface AboutYouCommerceParseResult {
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

function shipmentExtraction(orderNumber: string): EmailExtraction {
  return {
    event_type: 'shipment',
    merchant: merchantDisplayName('aboutyou'),
    merchant_legal_name: null,
    order_number: orderNumber,
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
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
  };
}

export function parseAboutYouCommerceEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AboutYouCommerceParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'aboutyou')) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');

  const shipmentSubject = subject.match(
    /\bszallitasi informaciok\s*:\s*(ayhu-\d{3}-\d{6,12})\b/i,
  );
  const bodyOrder = body.match(/\brendelesszam\s+(ayhu-\d{3}-\d{6,12})\b/i);
  const orderNumber = shipmentSubject?.[1] ?? bodyOrder?.[1] ?? null;

  const explicitShipment = /\bszallitas megerositese\b/i.test(body)
    && /\ba csomag uton van\b/i.test(body);

  if (!shipmentSubject?.[1] || !orderNumber || !explicitShipment) return null;

  return {
    extraction: shipmentExtraction(orderNumber),
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_aboutyou_sender',
      'explicit_aboutyou_shipment_subject',
      'explicit_package_in_transit',
      'explicit_order_number',
    ],
  };
}
