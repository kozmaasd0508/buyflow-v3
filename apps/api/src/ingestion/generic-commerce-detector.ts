import type { BuyFlowEmailEventType } from '../ai/openai-email-extractor.js';
import type { EmailDocumentV1 } from './email-document.js';

export const GENERIC_COMMERCE_SHADOW_VERSION = 'generic-commerce-v1-shadow';

export interface GenericCommerceShadowResult {
  eventType: BuyFlowEmailEventType;
  confidence: number;
  reasons: string[];
  orderNumber: string | null;
  total: { amount: number; currency: string } | null;
  carrier: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

const ORDER_CONFIRMATION_PATTERNS = [
  /\bthank(?:s| you)? for your order\b/i,
  /\bwe (?:have )?received your order\b/i,
  /\byour order (?:is )?confirmed\b/i,
  /\border confirmation\b/i,
  /\bkoszonjuk!?\s*(?:megkaptuk|hogy leadtad)?[^\n.]{0,80}\b(?:rendelesed|megrendelesed)\b/i,
  /\bmegkaptuk\s+(?:a\s+)?(?:rendelesedet|megrendelesedet)\b/i,
  /\b(?:rendelesed|megrendelesed)\s+(?:feldolgozas alatt|mar keszul)\b/i,
  /\brendelesi osszesito\b/i,
];

const TOTAL_LABEL_PATTERNS = [
  /\bbrutto osszeg\b/i,
  /\bvegosszeg\b/i,
  /\border total\b/i,
  /\bgrand total\b/i,
  /\btotal amount\b/i,
];

function chooseLikelyTotal(document: EmailDocumentV1): { amount: number; currency: string } | null {
  const normalized = normalizeText(document.text);
  const lines = normalized.split('\n');
  for (const line of lines) {
    if (!TOTAL_LABEL_PATTERNS.some((pattern) => pattern.test(line))) continue;
    const candidate = document.signals.amounts.find((amount) => normalizeText(amount.raw).trim() && line.includes(normalizeText(amount.raw).trim()));
    if (candidate) return { amount: candidate.amount, currency: candidate.currency };
  }
  const amounts = document.signals.amounts;
  if (amounts.length === 1) return { amount: amounts[0]!.amount, currency: amounts[0]!.currency };
  return null;
}

export function detectGenericCommerceV1(document: EmailDocumentV1): GenericCommerceShadowResult | null {
  const context = normalizeText(`${document.subject ?? ''}\n${document.text}`);
  const reasons: string[] = [];
  let score = 0;

  if (ORDER_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(context))) {
    score += 3;
    reasons.push('generic_order_confirmation_language');
  }
  if (document.signals.orderNumbers.length > 0) {
    score += 2;
    reasons.push('generic_order_number_candidate');
  }
  if (document.sections.some((section) => section.type === 'order_summary')) {
    score += 2;
    reasons.push('generic_order_summary_section');
  }
  if (document.signals.paymentMethods.length > 0) {
    score += 1;
    reasons.push('generic_payment_method_label');
  }
  if (document.signals.shippingMethods.length > 0) {
    score += 1;
    reasons.push('generic_shipping_method_label');
  }
  if (TOTAL_LABEL_PATTERNS.some((pattern) => pattern.test(context))) {
    score += 1;
    reasons.push('generic_total_label');
  }

  if (score < 5) return null;

  const total = chooseLikelyTotal(document);
  const confidence = Math.min(0.95, 0.58 + score * 0.045);
  return {
    eventType: 'order_created',
    confidence,
    reasons,
    orderNumber: document.signals.orderNumbers[0] ?? null,
    total,
    carrier: document.signals.couriers[0] ?? null,
    paymentMethod: document.signals.paymentMethods[0] ?? null,
    shippingMethod: document.signals.shippingMethods[0] ?? null,
  };
}
