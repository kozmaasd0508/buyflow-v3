import { createHmac, randomBytes } from 'node:crypto';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { env } from '../config.js';
import type { NormalizedEmail } from '../email/types.js';
import { parseDeterministicCommerceEmail } from '../ingestion/deterministic-commerce-parser.js';

const BODY_MAX_CHARS = 80_000;
const GENERIC_ORDER_PARSER_VERSION_PATTERN = /^generic-order-confirmation-v\d+(?:\.\d+)*$/;
const PROCESS_LOCAL_FINGERPRINT_SECRET = randomBytes(32).toString('hex');

export interface GenericCommerceShadowDiagnostic {
  mode: 'generic-commerce-shadow';
  would_write: false;
  validation_status: 'review';
  eligible_for_purchase_creation: false;
  parser_version: string;
  event_type: 'order_created';
  confidence: number;
  sender_domain_fingerprint: string;
  evidence_present: {
    order_number: boolean;
    total: boolean;
    currency: boolean;
    payment_method: boolean;
    shipping_method: boolean;
    product_rows: number;
  };
  reasons: string[];
}

function senderDomains(email: NormalizedEmail): string[] {
  return [...new Set(
    email.from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )].sort();
}

function bodyText(email: NormalizedEmail): string {
  return email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, BODY_MAX_CHARS)
    : (email.snippet ?? '').trim().slice(0, BODY_MAX_CHARS);
}

function fingerprintDomains(domains: string[]): string {
  // In production the already-secret Nylas webhook secret provides a stable
  // HMAC key. Tests/local environments without it get a process-local random
  // key, so the raw domain is never emitted either way.
  const key = env.NYLAS_WEBHOOK_SECRET ?? PROCESS_LOCAL_FINGERPRINT_SECRET;
  return createHmac('sha256', key)
    .update(`generic-commerce-shadow:v1:${domains.join('|')}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Observe only true generic fall-throughs from the central deterministic
 * commerce parser. If a known merchant/carrier adapter wins earlier, this is
 * not an unknown-merchant candidate and no generic diagnostic is emitted.
 */
export function observeGenericCommerceShadowEmail(
  email: NormalizedEmail,
): GenericCommerceShadowDiagnostic | null {
  const domains = senderDomains(email);
  const parsed = parseDeterministicCommerceEmail({
    senderDomains: domains,
    subject: email.subject,
    bodyText: bodyText(email),
  });

  if (!parsed || !GENERIC_ORDER_PARSER_VERSION_PATTERN.test(parsed.parserVersion)) {
    return null;
  }

  const extraction = parsed.extraction;
  return {
    mode: 'generic-commerce-shadow',
    would_write: false,
    validation_status: 'review',
    eligible_for_purchase_creation: false,
    parser_version: parsed.parserVersion,
    event_type: 'order_created',
    confidence: extraction.confidence,
    sender_domain_fingerprint: fingerprintDomains(domains),
    evidence_present: {
      order_number: Boolean(extraction.order_number),
      total: extraction.total !== null,
      currency: Boolean(extraction.currency),
      payment_method: Boolean(extraction.payment_method),
      shipping_method: Boolean(extraction.shipping_method),
      product_rows: extraction.products.length,
    },
    reasons: [...parsed.reasons],
  };
}

export function emitGenericCommerceShadowEmailObservation(
  email: NormalizedEmail,
  log: (label: string, payload: string) => void = console.info,
): GenericCommerceShadowDiagnostic | null {
  const row = observeGenericCommerceShadowEmail(email);
  if (!row) return null;

  log('[generic-commerce-shadow]', JSON.stringify(row));
  return row;
}
