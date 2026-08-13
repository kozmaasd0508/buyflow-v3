import type {
  BuyFlowEmailEventType,
  EmailExtraction,
} from '../ai/openai-email-extractor.js';

const PARSER_VERSION = 'deterministic-carrier-v1';

interface CarrierRule {
  name: string;
  domainTokens: string[];
}

const CARRIER_RULES: CarrierRule[] = [
  { name: 'Express One', domainTokens: ['expressone'] },
  { name: 'GLS', domainTokens: ['gls'] },
  { name: 'DPD', domainTokens: ['dpd'] },
  { name: 'Foxpost', domainTokens: ['foxpost'] },
  { name: 'Packeta', domainTokens: ['packeta'] },
  { name: 'DHL', domainTokens: ['dhl'] },
  { name: 'UPS', domainTokens: ['ups'] },
];

const TRACKING_LABEL_PATTERN = /\b(?:tracking(?:\s*(?:number|no\.?|id))?|nyomkovetesi\s*(?:szam|azonosito)|csomag(?:szam|azonosito)|kul[d]?emeny(?:szam|azonosito)|parcel(?:\s*(?:number|no\.?|id))|shipment(?:\s*(?:number|no\.?|id)))\s*[:#-]?\s*([a-z0-9][a-z0-9-]{7,31})\b/gi;

const FUTURE_DELIVERY_PATTERNS = [
  /\bout for delivery\b/i,
  /\bkezbesites alatt\b/i,
  /\bkezbesitesre kerul\b/i,
  /\bkezbesitjuk\b/i,
  /\bkezbesites varhato\b/i,
];

const DELIVERED_PATTERNS = [
  /\bhas been delivered\b/i,
  /\bwas delivered\b/i,
  /\bdelivered successfully\b/i,
  /\bsuccessfully delivered\b/i,
  /\bsikeresen kezbesitett(?:uk|ek)?\b/i,
  /\bkezbesitve\b/i,
  /\batvette\b/i,
  /\batvetel megtortent\b/i,
];

export interface DeterministicCommerceParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function domainHasToken(domain: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[.-])${escaped}([.-]|$)`, 'i').test(domain);
}

export function detectCarrierFromDomains(domains: string[]): string | null {
  const normalized = domains.map(normalizeDomain);
  for (const rule of CARRIER_RULES) {
    if (normalized.some((domain) => rule.domainTokens.some((token) => domainHasToken(domain, token)))) {
      return rule.name;
    }
  }
  return null;
}

export function extractLabeledTrackingNumber(text: string): string | null {
  const normalized = normalizeText(text);
  TRACKING_LABEL_PATTERN.lastIndex = 0;
  const match = TRACKING_LABEL_PATTERN.exec(normalized);
  if (!match?.[1]) return null;
  return match[1].trim().toUpperCase();
}

function detectCarrierEventType(text: string): BuyFlowEmailEventType {
  const normalized = normalizeText(text);
  if (FUTURE_DELIVERY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'shipment';
  }
  if (DELIVERED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'delivery';
  }
  return 'shipment';
}

function emptyExtraction(input: {
  eventType: BuyFlowEmailEventType;
  trackingNumber: string;
  carrier: string;
}): EmailExtraction {
  return {
    event_type: input.eventType,
    merchant: null,
    merchant_legal_name: null,
    order_number: null,
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
    confidence: 0.96,
  };
}

export function parseDeterministicCommerceEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicCommerceParseResult | null {
  const carrier = detectCarrierFromDomains(input.senderDomains);
  if (!carrier) return null;

  const contextText = `${input.subject ?? ''}\n${input.bodyText ?? ''}`;
  const trackingNumber = extractLabeledTrackingNumber(contextText);
  if (!trackingNumber) return null;

  const eventType = detectCarrierEventType(contextText);
  return {
    extraction: emptyExtraction({ eventType, trackingNumber, carrier }),
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_carrier_sender',
      'explicit_tracking_label',
      eventType === 'delivery' ? 'explicit_delivery_evidence' : 'shipment_or_transit_evidence',
    ],
  };
}
