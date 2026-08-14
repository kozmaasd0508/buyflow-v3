import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender, merchantDisplayName } from '../email/sender-role.js';

const PARSER_VERSION = 'alza-commerce-v1';

export interface AlzaCommerceParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
  shipmentPhase: 'ready_for_pickup';
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ');
}

export function parseAlzaCommerceEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AlzaCommerceParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'alza')) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const subjectMatch = subject.match(/\bvedd at\s+(\d{9,12})\s+sz\.?\s+megrendelesed\b/i);
  if (!subjectMatch?.[1]) return null;

  const orderNumber = subjectMatch[1];
  const bodyHasSameOrder = new RegExp(`\\b${orderNumber}\\s+sz\\.?\\s+megrendelesed\\b`, 'i').test(body)
    || new RegExp(`\\bmegrendeles\\s+${orderNumber}\\b`, 'i').test(body);
  const explicitPickup = /\bmegrendelesed megerkezett\b/i.test(body) && /\balzaboxba\b/i.test(body);
  if (!bodyHasSameOrder || !explicitPickup) return null;

  const extraction: EmailExtraction = {
    event_type: 'shipment',
    merchant: merchantDisplayName('alza'),
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
    shipping_method: 'AlzaBox',
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
  };

  return {
    extraction,
    parserVersion: PARSER_VERSION,
    shipmentPhase: 'ready_for_pickup',
    reasons: ['known_alza_sender', 'explicit_ready_for_pickup_subject', 'same_order_number_in_body', 'explicit_alzabox_arrival'],
  };
}