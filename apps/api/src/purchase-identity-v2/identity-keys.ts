import { normalizeStableIdentifier } from './identifier-normalizer.js';

export type OrderIdentityKey = string;
export type ShipmentIdentityKey = string;
export type InvoiceIdentityKey = string;
export type PaymentIdentityKey = string;

function normalizeScope(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized || null;
}

function scopedIdentityKey(
  kind: 'order' | 'shipment' | 'invoice' | 'payment',
  userId: string | null | undefined,
  namespaceId: string | null | undefined,
  stableId: string | null | undefined,
): string | null {
  const user = normalizeScope(userId);
  const namespace = normalizeScope(namespaceId);
  const identifier = normalizeStableIdentifier(stableId);
  if (!user || !namespace || !identifier) return null;

  return [kind, user, namespace, identifier]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

/**
 * Order identity is only exact inside a canonical merchant namespace.
 */
export function orderIdentityKey(
  userId: string | null | undefined,
  merchantId: string | null | undefined,
  orderId: string | null | undefined,
): OrderIdentityKey | null {
  return scopedIdentityKey('order', userId, merchantId, orderId);
}

/**
 * Tracking identity is only exact inside a carrier namespace.
 */
export function shipmentIdentityKey(
  userId: string | null | undefined,
  carrierId: string | null | undefined,
  trackingId: string | null | undefined,
): ShipmentIdentityKey | null {
  return scopedIdentityKey('shipment', userId, carrierId, trackingId);
}

/**
 * Invoice identity is only exact inside an issuer namespace.
 */
export function invoiceIdentityKey(
  userId: string | null | undefined,
  issuerId: string | null | undefined,
  invoiceId: string | null | undefined,
): InvoiceIdentityKey | null {
  return scopedIdentityKey('invoice', userId, issuerId, invoiceId);
}

/**
 * Payment identity is only exact inside a payment-provider namespace.
 */
export function paymentIdentityKey(
  userId: string | null | undefined,
  providerId: string | null | undefined,
  paymentReference: string | null | undefined,
): PaymentIdentityKey | null {
  return scopedIdentityKey('payment', userId, providerId, paymentReference);
}
