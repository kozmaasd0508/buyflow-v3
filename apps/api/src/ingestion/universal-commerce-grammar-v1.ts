import type { BuyFlowEmailEventType } from '../ai/openai-email-extractor.js';
import type { EmailDocumentV1 } from './email-document.js';

export const UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION = 'universal-commerce-grammar-v1';

export type UniversalCommerceLifecycle =
  | 'order_created'
  | 'order_processing'
  | 'order_cancelled'
  | 'shipment_created'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'invoice'
  | 'payment_completed'
  | 'payment_issue'
  | 'refund'
  | 'return'
  | 'review_request'
  | 'unknown';

export type UniversalCommerceDecision = 'actionable' | 'review' | 'blocked';

export interface UniversalCommerceGrammarResult {
  grammarVersion: typeof UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION;
  lifecycle: UniversalCommerceLifecycle;
  eventType: BuyFlowEmailEventType | null;
  decision: UniversalCommerceDecision;
  confidence: number;
  positiveEvidence: string[];
  negativeEvidence: string[];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .toLowerCase();
}

function hasAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const REVIEW_REQUEST_PATTERNS = [
  /\bhow did (?:it|your order|your purchase) go\b/i,
  /\brate (?:your )?(?:order|purchase|product|experience)\b/i,
  /\breview (?:your )?(?:order|purchase|product)\b/i,
  /\bshare (?:your )?(?:review|feedback|experience)\b/i,
  /\b(?:ertekeld|ertekelesed|velemenyed|velemenye)\b.{0,80}\b(?:rendeles|vasarlas|termek)\b/i,
  /\b(?:mennyire volt elegedett|elegedett volt)\b.{0,100}\b(?:rendeles|vasarlas|termek|feldolgozas)\b/i,
];

const ORDER_CANCELLED_PATTERNS = [
  /\b(?:rendeles|megrendeles)(?:ed|e|et)?\b.{0,70}\b(?:torolve|toroltek|toroltuk|torolted|megszunt)\b/i,
  /\b(?:torolve|toroltek|toroltuk|torolted)\b.{0,70}\b(?:rendeles|megrendeles)\b/i,
  /\border\b.{0,70}\b(?:cancelled|canceled)\b/i,
  /\b(?:cancelled|canceled)\b.{0,70}\border\b/i,
];

const DELIVERED_PATTERNS = [
  /\b(?:csomag(?:ja|jat|od|odat)?|kuldemeny(?:e|et|ed|edet)?|rendeles(?:ed|e|et)?)\b.{0,70}\b(?:kezbesitve|atadasra kerult|atvette a cimzett)\b/i,
  /\b(?:sikeresen kezbesitettuk|kezbesites megtortent|atvetel megtortent)\b/i,
  /\b(?:parcel|shipment|order)\b.{0,70}\b(?:delivered|delivery completed)\b/i,
];

const OUT_FOR_DELIVERY_PATTERNS = [
  /\b(?:csomag(?:ja|jat|od|odat)?|kuldemeny(?:e|et|ed|edet)?)\b.{0,100}\b(?:kezbesitonel van|ma kezbesitjuk|mai napon kezbesit|kezbesites alatt|kezbesitonknel van)\b/i,
  /\b(?:out for delivery|with the courier for delivery)\b/i,
];

const SHIPPED_PATTERNS = [
  /\b(?:rendeles|megrendeles)(?:ed|e|et)?\b.{0,80}\b(?:feladasra kerult|elkuldve|uton van|atadtuk a futarnak|atadtuk a futarszolgalatnak)\b/i,
  /\b(?:feladtuk|elkuldtuk)\b.{0,80}\b(?:csomag|kuldemeny|rendeles)\b/i,
  /\b(?:order|parcel|shipment)\b.{0,70}\b(?:shipped|dispatched|handed to the carrier)\b/i,
];

const FUTURE_HANDOFF_PATTERNS = [
  /\b(?:hamarosan|rovidesen)\b.{0,80}\b(?:atadjuk|atadasra kerul)\b.{0,60}\b(?:futar|futarszolgalat)\b/i,
  /\b(?:feladasra var|feladasra varakozik|osszekeszitettuk)\b/i,
  /\b(?:csomagfeladas meg nem tortent meg|feladas meg nem tortent meg)\b/i,
  /\b(?:will soon be handed|waiting to be shipped|preparing for shipment)\b/i,
];

const ORDER_PROCESSING_PATTERNS = [
  /\b(?:rendeles|megrendeles)(?:ed|e|et)?\b.{0,80}\b(?:feldolgozas alatt|feldolgozasa elkezdodott|osszekeszites alatt|osszekeszitettuk|mar keszul)\b/i,
  /\b(?:feldolgozzuk|elokeszitjuk)\b.{0,80}\b(?:rendeles|megrendeles)\b/i,
  /\b(?:order)\b.{0,70}\b(?:processing|being prepared|being packed)\b/i,
];

const ORDER_CREATED_PATTERNS = [
  /\b(?:megrendeles|rendeles)\s+visszaigazolas(?:a)?\b/i,
  /\b(?:sikeres )?(?:megrendeles|rendeles)\b.{0,50}\b(?:rogzitve|rogzitettuk|megerositve|megkaptuk|beerkezett)\b/i,
  /\b(?:megrendeleset|rendeleset|megrendelesedet|rendelesedet)\b.{0,70}\b(?:rogzitettuk|megkaptuk|visszaigazoljuk|elfogadtuk)\b/i,
  /\b(?:thank you for your order|order confirmation|your order is confirmed|we received your order|we have received your order)\b/i,
  /\b(?:bestellbestatigung|confirmation de commande|confirmacion de pedido)\b/i,
];

const INVOICE_PATTERNS = [
  /\b(?:szamla|e-szamla)\b.{0,60}\b(?:erkezett|elkeszult|kiallitva|csatolva)\b/i,
  /\b(?:invoice|receipt)\b.{0,60}\b(?:issued|ready|attached|available)\b/i,
  /\b(?:szamlaja erkezett|szamlad elkeszult)\b/i,
];

const PAYMENT_COMPLETED_PATTERNS = [
  /\b(?:sikeres fizetes|fizetes sikeres|sikeres tranzakcio|tranzakcio sikeres|befizetes beerkezett)\b/i,
  /\bpayment\b.{0,50}\b(?:completed|successful|received)\b/i,
];

const PAYMENT_ISSUE_PATTERNS = [
  /\b(?:sikertelen fizetes|sikertelen bankkartyas fizetes|fizetes sikertelen)\b/i,
  /\b(?:payment failed|payment unsuccessful)\b/i,
];

const REFUND_PATTERNS = [
  /\b(?:visszaterites|visszafizetes)\b.{0,60}\b(?:elindult|megtortent|sikeres|feldolgozva)\b/i,
  /\brefund\b.{0,60}\b(?:issued|processed|completed|started)\b/i,
];

const RETURN_PATTERNS = [
  /\b(?:visszakuldes|visszakuldesi kerelem|elallasi kerelem)\b/i,
  /\b(?:return request|return started|returned item)\b/i,
];

function structuralEvidence(document: EmailDocumentV1): string[] {
  const evidence: string[] = [];
  if (document.signals.orderNumbers.length > 0) evidence.push('order_identity');
  if (document.signals.trackingNumbers.length > 0) evidence.push('tracking_identity');
  if (document.sections.some((section) => section.type === 'order_summary')) evidence.push('order_summary');
  if (document.signals.products.length > 0) evidence.push('product_rows');
  if (document.signals.amounts.length > 0) evidence.push('money_candidate');
  if (document.signals.paymentMethods.length > 0) evidence.push('payment_method');
  if (document.signals.shippingMethods.length > 0) evidence.push('shipping_method');
  if (document.signals.couriers.length > 0) evidence.push('carrier_candidate');
  return evidence;
}

function mapLifecycleToEvent(lifecycle: UniversalCommerceLifecycle): BuyFlowEmailEventType | null {
  switch (lifecycle) {
    case 'order_created': return 'order_created';
    case 'order_processing':
    case 'order_cancelled':
    case 'payment_issue': return 'order_updated';
    case 'shipment_created':
    case 'shipped':
    case 'out_for_delivery': return 'shipment';
    case 'delivered': return 'delivery';
    case 'invoice': return 'invoice_or_receipt';
    case 'payment_completed': return 'payment_completed';
    case 'refund': return 'refund';
    case 'return': return 'return';
    case 'review_request':
    case 'unknown': return null;
  }
}

function result(input: {
  lifecycle: UniversalCommerceLifecycle;
  decision: UniversalCommerceDecision;
  confidence: number;
  positiveEvidence: string[];
  negativeEvidence?: string[];
}): UniversalCommerceGrammarResult {
  return {
    grammarVersion: UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION,
    lifecycle: input.lifecycle,
    eventType: mapLifecycleToEvent(input.lifecycle),
    decision: input.decision,
    confidence: input.confidence,
    positiveEvidence: unique(input.positiveEvidence),
    negativeEvidence: unique(input.negativeEvidence ?? []),
  };
}

export function evaluateUniversalCommerceGrammarV1(document: EmailDocumentV1): UniversalCommerceGrammarResult {
  const subject = normalizeText(document.subject ?? '');
  const context = normalizeText(`${document.subject ?? ''}\n${document.text}`);
  const structure = structuralEvidence(document);
  const hasOrderIdentity = structure.includes('order_identity');
  const hasTrackingIdentity = structure.includes('tracking_identity');
  const hasCommerceStructure = structure.filter((item) => [
    'order_summary', 'product_rows', 'money_candidate', 'payment_method', 'shipping_method',
  ].includes(item)).length >= 2;

  if (hasAny(REVIEW_REQUEST_PATTERNS, context)) {
    return result({
      lifecycle: 'review_request',
      decision: 'blocked',
      confidence: 0.99,
      positiveEvidence: structure,
      negativeEvidence: ['review_request_language'],
    });
  }

  if (hasAny(ORDER_CANCELLED_PATTERNS, context)) {
    return result({
      lifecycle: 'order_cancelled',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.97 : 0.82,
      positiveEvidence: [...structure, 'explicit_order_cancelled'],
    });
  }

  if (hasAny(DELIVERED_PATTERNS, context)) {
    return result({
      lifecycle: 'delivered',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasTrackingIdentity ? 0.98 : hasOrderIdentity ? 0.93 : 0.8,
      positiveEvidence: [...structure, 'explicit_delivered'],
    });
  }

  if (hasAny(OUT_FOR_DELIVERY_PATTERNS, context)) {
    return result({
      lifecycle: 'out_for_delivery',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasTrackingIdentity ? 0.97 : hasOrderIdentity ? 0.91 : 0.79,
      positiveEvidence: [...structure, 'explicit_out_for_delivery'],
    });
  }

  if (hasAny(FUTURE_HANDOFF_PATTERNS, context)) {
    return result({
      lifecycle: 'order_processing',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.94 : 0.8,
      positiveEvidence: [...structure, 'future_carrier_handoff'],
      negativeEvidence: ['not_yet_shipped'],
    });
  }

  if (hasAny(SHIPPED_PATTERNS, context)) {
    return result({
      lifecycle: 'shipped',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasTrackingIdentity ? 0.98 : hasOrderIdentity ? 0.93 : 0.8,
      positiveEvidence: [...structure, 'explicit_shipped'],
    });
  }

  if (hasAny(INVOICE_PATTERNS, context)) {
    const invoiceCorroborated = hasOrderIdentity || structure.includes('money_candidate');
    return result({
      lifecycle: 'invoice',
      decision: invoiceCorroborated ? 'actionable' : 'review',
      confidence: invoiceCorroborated ? 0.94 : 0.8,
      positiveEvidence: [...structure, 'explicit_invoice'],
    });
  }

  if (hasAny(REFUND_PATTERNS, context)) {
    return result({
      lifecycle: 'refund',
      decision: hasOrderIdentity || structure.includes('money_candidate') ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.95 : 0.82,
      positiveEvidence: [...structure, 'explicit_refund'],
    });
  }

  if (hasAny(RETURN_PATTERNS, context)) {
    return result({
      lifecycle: 'return',
      decision: hasOrderIdentity || hasTrackingIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity || hasTrackingIdentity ? 0.94 : 0.8,
      positiveEvidence: [...structure, 'explicit_return'],
    });
  }

  if (hasAny(PAYMENT_ISSUE_PATTERNS, context)) {
    return result({
      lifecycle: 'payment_issue',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.95 : 0.81,
      positiveEvidence: [...structure, 'explicit_payment_issue'],
    });
  }

  if (hasAny(PAYMENT_COMPLETED_PATTERNS, context)) {
    return result({
      lifecycle: 'payment_completed',
      decision: hasOrderIdentity || structure.includes('money_candidate') ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.96 : structure.includes('money_candidate') ? 0.9 : 0.8,
      positiveEvidence: [...structure, 'explicit_payment_completed'],
    });
  }

  if (hasAny(ORDER_PROCESSING_PATTERNS, context)) {
    return result({
      lifecycle: 'order_processing',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.94 : 0.8,
      positiveEvidence: [...structure, 'explicit_order_processing'],
    });
  }

  if (hasAny(ORDER_CREATED_PATTERNS, context)) {
    const enoughEvidence = hasOrderIdentity && (hasCommerceStructure || structure.includes('order_summary'));
    const strongSubject = hasAny(ORDER_CREATED_PATTERNS, subject);
    return result({
      lifecycle: 'order_created',
      decision: enoughEvidence ? 'actionable' : 'review',
      confidence: enoughEvidence ? (strongSubject ? 0.98 : 0.95) : 0.82,
      positiveEvidence: [...structure, 'explicit_order_created'],
    });
  }

  return result({
    lifecycle: 'unknown',
    decision: 'review',
    confidence: 0,
    positiveEvidence: structure,
  });
}
