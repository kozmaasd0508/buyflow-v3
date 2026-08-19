import { htmlToCompactText, type EmailExtraction } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  parseDeterministicCommerceEmail,
  type DeterministicCommerceParseResult,
} from './deterministic-commerce-parser.js';
import { buildEmailDocumentV1 } from './email-document.js';
import {
  detectGenericCommerceV1,
  GENERIC_COMMERCE_SHADOW_VERSION,
} from './generic-commerce-detector.js';

const DEFAULT_BODY_MAX_CHARS = 80_000;

export interface DeterministicNormalizedEmailInput {
  senderDomains: string[];
  subject?: string | null;
  bodyText: string;
}

function senderDomains(email: NormalizedEmail): string[] {
  return [...new Set(
    email.from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

export function normalizedEmailToDeterministicInput(
  email: NormalizedEmail,
  maxChars = DEFAULT_BODY_MAX_CHARS,
): DeterministicNormalizedEmailInput {
  const bodyText = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, maxChars)
    : (email.snippet ?? '').trim().slice(0, maxChars);

  return {
    senderDomains: senderDomains(email),
    subject: email.subject ?? null,
    bodyText,
  };
}

function genericShadowExtraction(email: NormalizedEmail): DeterministicCommerceParseResult | null {
  const document = buildEmailDocumentV1(email);
  const generic = detectGenericCommerceV1(document);
  if (!generic) return null;

  const extraction: EmailExtraction = {
    event_type: generic.eventType,
    merchant: document.sender.primaryName ?? document.sender.primaryDomain,
    merchant_legal_name: null,
    order_number: generic.orderNumber,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: generic.total?.amount ?? null,
    currency: generic.total?.currency ?? null,
    payment_status: generic.paymentMethod && /utanvet|cash on delivery|cod/i.test(generic.paymentMethod)
      ? 'cash_on_delivery'
      : null,
    payment_method: generic.paymentMethod,
    paid_amount: null,
    paid_currency: null,
    shipping_method: generic.shippingMethod,
    tracking_number: document.signals.trackingNumbers[0] ?? null,
    carrier: generic.carrier,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: generic.confidence,
  };

  return {
    extraction,
    parserVersion: GENERIC_COMMERCE_SHADOW_VERSION,
    reasons: [
      ...generic.reasons,
      `email_document_v${document.schemaVersion}`,
      ...(document.sender.primaryDomain ? [`sender_domain:${document.sender.primaryDomain}`] : []),
      ...(document.sections.length ? [`structured_sections:${document.sections.length}`] : []),
      ...(document.signals.amounts.length ? [`money_candidates:${document.signals.amounts.length}`] : []),
    ],
  };
}

export function parseNormalizedDeterministicEmail(
  email: NormalizedEmail,
): DeterministicCommerceParseResult | null {
  const deterministic = parseDeterministicCommerceEmail(
    normalizedEmailToDeterministicInput(email),
  );
  return deterministic ?? genericShadowExtraction(email);
}
