import type { BuyFlowEmailEventType } from '../ai/openai-email-extractor.js';
import type { EmailDocumentProductCandidate, EmailDocumentV1 } from './email-document.js';

export const GENERIC_COMMERCE_SHADOW_VERSION = 'generic-commerce-v3-shadow';

export interface GenericCommerceShadowResult {
  eventType: BuyFlowEmailEventType;
  confidence: number;
  reasons: string[];
  orderNumber: string | null;
  total: { amount: number; currency: string } | null;
  shippingAmount: { amount: number; currency: string } | null;
  codAmount: { amount: number; currency: string } | null;
  carrier: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  products: EmailDocumentProductCandidate[];
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
  /\b(?:automata\s+)?megrendeles\s+visszaigazolas\b/i,
  /\b(?:sikeres\s+)?rendeles\s+megerosites(?:e|et)?\b/i,
  /\brendeles\s+megerositese\b/i,
  /\bmegrendelesi\s+szam\s*:\s*#?[a-z0-9-]{5,}\b/i,
  /#?[a-z0-9-]{5,}\s+szamu\s+(?:rendelese|megrendelese)\s+letrejott\b/i,
  /\bkoszonjuk\s+megrendeleset.{0,120}\brogzitettuk\b.{0,80}#?\d{5,}\b/i,
  /\b(?:rendeles|megrendeles|order)\s*(?:#|no\.?|nr\.?|szam(?:u)?|azonosito)?\s*[:-]?\s*(?:[a-z]{1,8}-\d[\w-]{2,}|#?\d{5,})\b/i,
  /\bkoszonjuk!?\s*(?:megkaptuk|hogy leadtad)?[^\n.]{0,80}\b(?:rendelesed|megrendelesed)\b/i,
  /\bmegkaptuk\s+(?:a\s+)?(?:rendelesedet|megrendelesedet)\b/i,
  /\b(?:rendelesed|megrendelesed)\s+(?:feldolgozas alatt|mar keszul)\b/i,
  /\brendelesi osszesito\b/i,
];

const SHIPMENT_PATTERNS = [
  /\b(?:rendelesed|megrendelesed)\s+(?:uton van|elkuldve|feladasra kerult)\b/i,
  /\b(?:rendelest|megrendelest)\s+elkuldtek\b/i,
  /\b(?:rendelesedet|megrendelesedet)\s+csomagoljak\b/i,
  /\b(?:rendelesed|megrendelesed)\s+keszen\s+all\s+a\s+szallitasra\b/i,
  /\b(?:csomag|kuldemeny).{0,60}\b(?:kezbesites ma|mai kezbesites|futar.*kezbesit|szallitas alatt)\b/i,
  /\b(?:futar|courier).{0,40}\b(?:ma erkezik|kezbesit|atvette)\b/i,
  /\b(?:shipment|parcel).{0,50}\b(?:shipped|in transit|out for delivery)\b/i,
  /\b(?:feldolgozasa|feldolgozasat)\s+megkezd(?:odott|tuk)\b/i,
  /\batadtuk\s+a\s+futarszolgalat\b/i,
  /\batadtuk\s+a\s+futarnak\b/i,
  /\bdinamikus\s+csomagkovetes\b/i,
];

const DELIVERY_PATTERNS = [
  /\bkuldemeny\s+kezbesitve\b/i,
  /\brendeles\s+kezbesitve\b/i,
  /\bcsomag\s+kezbesitve\b/i,
  /\bsikeres\s+kezbesites(?:erol|e)?\b/i,
  /\bsikeresen\s+kezbesitett(?:uk|e)?\b/i,
  /\batadasra\s+kerult\b/i,
  /\b(?:delivered|delivery completed)\b/i,
];

const INVOICE_PATTERNS = [
  /\bszamla(?:d)?\s+elkeszult\b/i,
  /\bszamlaja\s+erkezett\b/i,
  /\brendelesedhez\s+tartozo\s+szamla\b/i,
  /\b(?:invoice|receipt|nyugta)\b/i,
  /\brendeles.{0,50}\bnyugtaja\b/i,
];

const PAYMENT_PATTERNS = [
  /\bsikeres\s+bankkartyas\s+fizetes\b/i,
  /\bsikeres\s+fizetes\b/i,
  /\bfizetes\s+sikeres\b/i,
  /\bfizetes\s+megerositese\b/i,
  /\bpayment\s+(?:completed|successful|received)\b/i,
];

const REFUND_PATTERNS = [
  /\bvisszaterites(?:ed)?\s+(?:elindult|megtortent|sikeres)\b/i,
  /\brefund(?:ed)?\b/i,
];

const RETURN_PATTERNS = [
  /\bvisszakuldes(?:ed)?\b/i,
  /\belallasi\s+kerelem\b/i,
  /\breturn(?:ed)?\b/i,
];

const TOTAL_LABEL_PATTERNS = [
  /\bbrutto osszeg\b/i,
  /\bvegosszeg\b/i,
  /\border total\b/i,
  /\bgrand total\b/i,
  /\btotal amount\b/i,
];

const COURIER_DOMAIN_TOKENS = [
  'expressone', 'gls', 'dpd', 'dhl', 'ups', 'fedex', 'foxpost', 'packeta', 'sameday', 'posta', 'mpl', 'allegro',
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

function hasAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function chooseEventType(document: EmailDocumentV1, subject: string, context: string, reasons: string[]): { eventType: BuyFlowEmailEventType; score: number } | null {
  const courierSender = COURIER_DOMAIN_TOKENS.some((token) => document.sender.primaryDomain?.includes(token));

  if (hasAny(DELIVERY_PATTERNS, subject) || hasAny(DELIVERY_PATTERNS, context)) {
    reasons.push('generic_delivery_language');
    return { eventType: 'delivery', score: hasAny(DELIVERY_PATTERNS, subject) ? 5 : 4 };
  }
  if (hasAny(REFUND_PATTERNS, subject) || hasAny(REFUND_PATTERNS, context)) {
    reasons.push('generic_refund_language');
    return { eventType: 'refund', score: hasAny(REFUND_PATTERNS, subject) ? 5 : 4 };
  }
  if (hasAny(RETURN_PATTERNS, subject) || hasAny(RETURN_PATTERNS, context)) {
    reasons.push('generic_return_language');
    return { eventType: 'return', score: hasAny(RETURN_PATTERNS, subject) ? 5 : 4 };
  }
  // A payment-specific subject outranks receipt language that may only appear in the body.
  if (hasAny(PAYMENT_PATTERNS, subject)) {
    reasons.push('generic_payment_completed_language');
    return { eventType: 'payment_completed', score: 5 };
  }
  if (hasAny(INVOICE_PATTERNS, subject) || hasAny(INVOICE_PATTERNS, context)) {
    reasons.push('generic_invoice_language');
    return { eventType: 'invoice_or_receipt', score: hasAny(INVOICE_PATTERNS, subject) ? 5 : 4 };
  }
  if (hasAny(PAYMENT_PATTERNS, context)) {
    reasons.push('generic_payment_completed_language');
    return { eventType: 'payment_completed', score: 4 };
  }
  if (hasAny(SHIPMENT_PATTERNS, subject) || hasAny(SHIPMENT_PATTERNS, context)) {
    const strong = hasAny(SHIPMENT_PATTERNS, subject);
    if (strong || courierSender || document.signals.trackingNumbers.length > 0 || document.signals.couriers.length > 0) {
      reasons.push('generic_shipment_language');
      if (courierSender) reasons.push('generic_courier_sender');
      return { eventType: 'shipment', score: strong ? 5 : 4 };
    }
  }
  if (hasAny(ORDER_CONFIRMATION_PATTERNS, subject) || hasAny(ORDER_CONFIRMATION_PATTERNS, context)) {
    reasons.push('generic_order_confirmation_language');
    return { eventType: 'order_created', score: hasAny(ORDER_CONFIRMATION_PATTERNS, subject) ? 5 : 3 };
  }
  return null;
}

export function detectGenericCommerceV2(document: EmailDocumentV1): GenericCommerceShadowResult | null {
  const subject = normalizeText(document.subject ?? '');
  const context = normalizeText(`${document.subject ?? ''}\n${document.text}`);
  const reasons: string[] = [];
  const event = chooseEventType(document, subject, context, reasons);
  if (!event) return null;

  let score = event.score;
  if (document.signals.orderNumbers.length > 0) {
    score += 2;
    reasons.push('generic_order_number_candidate');
  }
  if (document.signals.trackingNumbers.length > 0) {
    score += 2;
    reasons.push('generic_tracking_number_candidate');
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
  if (document.signals.products.length > 0) {
    score += 1;
    reasons.push('generic_product_line_candidates');
  }

  // A strong commerce-specific subject is sufficient by itself. Body-only matches
  // still require corroborating structure so promotional mail does not become commerce.
  if (score < 5) return null;

  const total = chooseLikelyTotal(document);
  const shippingAmount = document.signals.shippingAmounts[0] ?? null;
  const codAmount = document.signals.codAmounts[0] ?? null;
  const confidence = Math.min(0.96, 0.57 + score * 0.045);
  return {
    eventType: event.eventType,
    confidence,
    reasons,
    orderNumber: document.signals.orderNumbers[0] ?? null,
    total,
    shippingAmount: shippingAmount ? { amount: shippingAmount.amount, currency: shippingAmount.currency } : null,
    codAmount: codAmount ? { amount: codAmount.amount, currency: codAmount.currency } : null,
    carrier: document.signals.couriers[0] ?? null,
    paymentMethod: document.signals.paymentMethods[0] ?? null,
    shippingMethod: document.signals.shippingMethods[0] ?? null,
    products: document.signals.products,
  };
}

// Compatibility alias for callers/tests that imported the original symbol.
export const detectGenericCommerceV1 = detectGenericCommerceV2;
