import type { BuyFlowEmailEventType, EmailExtraction } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';
import type { DeterministicCommerceParseResult } from './deterministic-commerce-parser.js';

export const GENERIC_COMMERCE_V5_SHADOW_VERSION = 'generic-commerce-v5-shadow';

function normalizeSubject(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function senderDomain(email: NormalizedEmail): string | null {
  const address = email.from[0]?.email?.trim().toLowerCase();
  if (!address) return null;
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : null;
}

function classifySubject(subject: string): { eventType: BuyFlowEmailEventType; reason: string } | null {
  // Explicit customer refund workflow, including support-thread prefixes such as "Re:".
  if (/refund.{0,24}request|request.{0,24}refund/i.test(subject)) {
    return { eventType: 'refund', reason: 'v5_refund_request_subject' };
  }

  // Delivery-delay notifications are shipment lifecycle evidence even when no tracking id is in the subject.
  if (/kesik.{0,32}kezbesites|kezbesites.{0,32}kesik/i.test(subject)) {
    return { eventType: 'shipment', reason: 'v5_delivery_delay_subject' };
  }

  // Parcel deposited into a locker / parcel machine. Require both parcel and placement language.
  if (/(?:csomag|kuldemeny).{0,90}(?:automata|csomagautomata).{0,45}(?:helyezes|elhelyezes)/i.test(subject)) {
    return { eventType: 'shipment', reason: 'v5_parcel_locker_placement_subject' };
  }

  // Merchant lifecycle update with a concrete order reference. "Fontos információ" alone is deliberately insufficient.
  if (/\b\d{5,}\s+rendeles\b.{0,100}\bfontos\s+informacio\b/i.test(subject)
      || /\bfontos\s+informacio\b.{0,100}\b\d{5,}\s+rendeles\b/i.test(subject)) {
    return { eventType: 'order_updated', reason: 'v5_order_reference_update_subject' };
  }

  return null;
}

export function parseGenericCommerceV5SubjectFallback(email: NormalizedEmail): DeterministicCommerceParseResult | null {
  const subject = normalizeSubject(email.subject ?? '');
  if (!subject) return null;

  const match = classifySubject(subject);
  if (!match) return null;

  const domain = senderDomain(email);
  const extraction: EmailExtraction = {
    event_type: match.eventType,
    merchant: email.from[0]?.name ?? domain,
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
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.82,
  };

  return {
    extraction,
    parserVersion: GENERIC_COMMERCE_V5_SHADOW_VERSION,
    reasons: [match.reason, ...(domain ? [`sender_domain:${domain}`] : [])],
  };
}
