import { htmlToCompactText, type EmailExtraction } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';
import { isExpressOneOutboundPickupNoise } from './commerce-email-filter.js';
import {
  parseDeterministicCommerceEmail,
  type DeterministicCommerceParseResult,
} from './deterministic-commerce-parser.js';
import { buildEmailDocumentV1 } from './email-document.js';
import {
  detectGenericCommerceV1,
  GENERIC_COMMERCE_SHADOW_VERSION,
} from './generic-commerce-detector.js';
import { parseGenericCommerceV5SubjectFallback } from './generic-commerce-v5-subject-fallback.js';
import {
  isProviderLifecycleV6Noise,
  parseProviderLifecycleV6,
} from './provider-lifecycle-v6-adapter.js';
import { enrichProviderFieldsV1 } from './provider-field-enrichment-v1.js';

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

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
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

function authoredReplyPrefix(email: NormalizedEmail): string {
  const body = normalizedEmailToDeterministicInput(email).bodyText;
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    const normalized = normalizeText(line).trim();
    if (
      /^>/.test(line.trim())
      || /-----\s*original message\s*-----/i.test(line)
      || /^(?:from|felado)\s*:/i.test(normalized)
      || /\bezt irta\s*\(idopont\s*:/i.test(normalized)
      || /\bwrote\s*:\s*$/i.test(normalized)
    ) {
      break;
    }
    kept.push(line);
  }

  return kept.join('\n').trim();
}

function isReplyOrForwardSubject(subject: string | null | undefined): boolean {
  return /^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i.test(subject ?? '');
}

function hasExplicitNewOrderEvidence(text: string): boolean {
  const normalized = normalizeText(text);
  return [
    /\bmegrendeles\s+visszaigazolasa\b/i,
    /\b(?:rendeles|megrendeles).{0,50}\b(?:letrejott|rogzitettuk|elfogadtuk)\b/i,
    /\b(?:koszonjuk|thank you).{0,80}\b(?:rendelesed|megrendelesed|your order)\b/i,
    /\b(?:order confirmation|your order is confirmed|we received your order)\b/i,
    /\b(?:megrendelesi|rendelesi)\s+(?:szam|azonosito)\s*[:#-]\s*[a-z0-9][a-z0-9./_-]{3,30}\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function explicitNewOrderNumber(text: string): string | null {
  const normalized = normalizeText(text);
  const patterns = [
    /\b(?:megrendelesi|rendelesi)\s+(?:szam|azonosito)\s*[:#-]\s*#?([a-z0-9][a-z0-9./_-]{3,39})\b/i,
    /\b(?:megrendeles|rendeles)\s+visszaigazolasa?\s*[:#-]\s*#?([a-z0-9][a-z0-9./_-]{3,39})\b/i,
    /\border\s*(?:number|no\.?|id)\s*[:#-]\s*#?([a-z0-9][a-z0-9./_-]{3,39})\b/i,
  ];

  for (const pattern of patterns) {
    const candidate = normalized.match(pattern)?.[1]?.trim().replace(/[.,;:)]+$/, '');
    if (candidate && /\d/.test(candidate)) return candidate;
  }
  return null;
}

function guardReplyThreadOrderCreation(
  email: NormalizedEmail,
  parsed: DeterministicCommerceParseResult,
): DeterministicCommerceParseResult | null {
  if (parsed.extraction.event_type !== 'order_created') return parsed;
  if (!isReplyOrForwardSubject(email.subject)) return parsed;

  const authoredPrefix = authoredReplyPrefix(email);
  if (authoredPrefix && hasExplicitNewOrderEvidence(authoredPrefix)) {
    const freshOrderNumber = explicitNewOrderNumber(authoredPrefix);
    return {
      ...parsed,
      extraction: {
        ...parsed.extraction,
        order_number: freshOrderNumber,
      },
      reasons: [...new Set([
        ...parsed.reasons,
        'reply_thread_explicit_new_order_evidence',
        ...(freshOrderNumber ? ['reply_thread_order_number_from_authored_prefix'] : []),
      ])],
    };
  }

  return null;
}

function genericShadowExtraction(email: NormalizedEmail): DeterministicCommerceParseResult | null {
  const document = buildEmailDocumentV1(email);
  const generic = detectGenericCommerceV1(document);
  if (!generic) return null;

  const normalizedPaymentMethod = normalizeText(generic.paymentMethod ?? '');
  const isCashOnDelivery = /\butanvet(?:tel)?\b|\bcash on delivery\b|\bcod\b/i.test(normalizedPaymentMethod);

  const extraction: EmailExtraction = {
    event_type: generic.eventType,
    merchant: document.sender.primaryName ?? document.sender.primaryDomain,
    merchant_legal_name: null,
    order_number: generic.orderNumber,
    subtotal: null,
    shipping_amount: generic.shippingAmount?.amount ?? null,
    discount_amount: null,
    total: generic.total?.amount ?? null,
    currency: generic.total?.currency ?? null,
    payment_status: isCashOnDelivery ? 'cash_on_delivery' : null,
    payment_method: generic.paymentMethod,
    paid_amount: null,
    paid_currency: null,
    shipping_method: generic.shippingMethod,
    tracking_number: document.signals.trackingNumbers[0] ?? null,
    carrier: generic.carrier,
    parcel_sender: null,
    cod_amount: generic.codAmount?.amount ?? null,
    cod_currency: generic.codAmount?.currency ?? null,
    invoice_number: null,
    products: generic.products.map((product) => ({
      name: product.name,
      brand: null,
      model: null,
      variant: null,
      sku: null,
      gtin: null,
      category: null,
      quantity: product.quantity,
      unit_price: product.unitPrice ?? null,
      total_price: product.totalPrice ?? null,
      currency: product.currency ?? generic.total?.currency ?? null,
      product_url: null,
      image_url: null,
      confidence: product.totalPrice !== undefined ? 0.8 : 0.72,
    })),
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
      ...(document.signals.products.length ? [`product_candidates:${document.signals.products.length}`] : []),
      ...(generic.shippingAmount ? ['generic_shipping_amount_label'] : []),
      ...(generic.codAmount ? ['generic_cod_amount_label'] : []),
    ],
  };
}

export function parseNormalizedDeterministicEmail(
  email: NormalizedEmail,
): DeterministicCommerceParseResult | null {
  if (isExpressOneOutboundPickupNoise(email)) return null;
  if (isProviderLifecycleV6Noise(email)) return null;

  const providerLifecycle = parseProviderLifecycleV6(email);
  if (providerLifecycle) {
    return guardReplyThreadOrderCreation(
      email,
      enrichProviderFieldsV1(email, providerLifecycle),
    );
  }

  const deterministic = parseDeterministicCommerceEmail(
    normalizedEmailToDeterministicInput(email),
  );
  const parsed = deterministic
    ?? genericShadowExtraction(email)
    ?? parseGenericCommerceV5SubjectFallback(email);

  if (!parsed) return null;
  return guardReplyThreadOrderCreation(
    email,
    enrichProviderFieldsV1(email, parsed),
  );
}
