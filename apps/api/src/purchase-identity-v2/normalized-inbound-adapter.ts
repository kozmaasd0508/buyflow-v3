import type { NormalizedEmail } from '../email/types.js';
import type { NormalizedInboundPlan } from '../pipeline/normalized-inbound-pipeline.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import type { CanonicalEvent, CanonicalEventType, EvidenceProvenance } from './types.js';

export interface MerchantIdentityResolver {
  resolve(input: {
    merchantRaw: string | null;
    senderDomain: string | null;
  }): string | null;
}

export interface CanonicalEventAdapterInput {
  userId: string;
  email: NormalizedEmail;
  plan: NormalizedInboundPlan;
  merchantResolver?: MerchantIdentityResolver;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
}

function mapEventType(classification: string | null): CanonicalEventType {
  switch (classification) {
    case 'order_created':
      return 'order_created';
    case 'order_updated':
      return 'order_updated';
    case 'payment_completed':
      return 'payment_completed';
    case 'shipment':
      return 'shipment_created';
    case 'delivery':
      return 'delivered';
    case 'invoice_or_receipt':
      return 'invoice_created';
    case 'refund':
      return 'refund_created';
    case 'return':
      return 'return_created';
    case 'cancelled':
    case 'cancellation':
      return 'cancelled';
    default:
      return 'other';
  }
}

function field(result: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (result[name] !== undefined && result[name] !== null) return result[name];
  }
  return null;
}

function provenanceFor(fields: Array<[string, unknown]>, parserVersion: string | null): EvidenceProvenance[] {
  return fields
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([name]) => ({
      field: name,
      source: 'provider_adapter' as const,
      parserVersion,
    }));
}

export function canonicalEventFromNormalizedInbound(input: CanonicalEventAdapterInput): CanonicalEvent | null {
  const { email, plan } = input;
  if (!plan.classification || plan.classification.startsWith('security_')) return null;

  const result = (plan.validatedResult ?? plan.structuredResult) as Record<string, unknown>;
  const senderDomain = (email.from[0]?.email.split('@').pop() ?? '').toLowerCase() || null;
  const merchantRaw = stringOrNull(field(result, 'merchant', 'merchant_name'));
  const merchantId = input.merchantResolver?.resolve({ merchantRaw, senderDomain }) ?? null;

  const orderIdRaw = stringOrNull(field(result, 'order_number', 'order_id'));
  const trackingIdRaw = stringOrNull(field(result, 'tracking_number', 'tracking_id'));
  const invoiceIdRaw = stringOrNull(field(result, 'invoice_number', 'invoice_id'));
  const paymentReference = stringOrNull(field(result, 'payment_reference', 'transaction_id', 'payment_id'));
  const amount = numberOrNull(field(result, 'total', 'amount', 'total_amount'));
  const currency = stringOrNull(field(result, 'currency'));
  const orderUrl = stringOrNull(field(result, 'order_url'));
  const trackingUrl = stringOrNull(field(result, 'tracking_url'));
  const productFingerprints = arrayStrings(field(result, 'product_fingerprints'));

  const occurredAt = stringOrNull(field(result, 'occurred_at', 'event_time', 'event_date'));
  const eventType = mapEventType(plan.classification);

  const sourceFields: Array<[string, unknown]> = [
    ['merchant', merchantRaw],
    ['order_id', orderIdRaw],
    ['tracking_id', trackingIdRaw],
    ['invoice_id', invoiceIdRaw],
    ['payment_reference', paymentReference],
    ['amount', amount],
    ['currency', currency],
    ['order_url', orderUrl],
    ['tracking_url', trackingUrl],
  ];

  return {
    eventId: `${email.provider}:${email.providerMessageId}`,
    userId: input.userId,
    eventType,
    sourceProvider: email.provider,
    sourceMessageId: email.providerMessageId,
    senderDomain,
    receivedAt: email.receivedAt,
    occurredAt,
    merchantRaw,
    merchantId,
    orderIdRaw,
    orderIdNormalized: normalizeStableIdentifier(orderIdRaw),
    trackingIdRaw,
    trackingIdNormalized: normalizeStableIdentifier(trackingIdRaw),
    invoiceIdRaw,
    invoiceIdNormalized: normalizeStableIdentifier(invoiceIdRaw),
    paymentReference: normalizeStableIdentifier(paymentReference),
    amount,
    currency,
    orderUrl,
    trackingUrl,
    productFingerprints,
    provenance: provenanceFor(sourceFields, plan.parserVersion),
  };
}
