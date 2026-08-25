import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';
import {
  invoiceIdentityKey,
  orderIdentityKey,
  paymentIdentityKey,
  shipmentIdentityKey,
} from './identity-keys.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';

export interface CandidateIndex {
  orderExact: Map<string, Set<string>>;
  orderMerchantNamespaceExact: Map<string, Set<string>>;
  orderMerchantNamespaceReviewAlias: Map<string, Set<string>>;
  orderDiscovery: Map<string, Set<string>>;
  trackingExact: Map<string, Set<string>>;
  trackingDiscovery: Map<string, Set<string>>;
  paymentExact: Map<string, Set<string>>;
  paymentDiscovery: Map<string, Set<string>>;
  invoiceExact: Map<string, Set<string>>;
  invoiceDiscovery: Map<string, Set<string>>;
}

function add(map: Map<string, Set<string>>, key: string | null, purchaseId: string) {
  if (!key) return;
  const set = map.get(key) ?? new Set<string>();
  set.add(purchaseId);
  map.set(key, set);
}

function discoveryKey(userId: string, id: string | null): string | null {
  return id ? `${encodeURIComponent(userId.trim().toLowerCase())}:${id}` : null;
}

/**
 * Returns a conservative review-only base for order identifiers decorated with
 * a short alphabetic merchant prefix, e.g. KB9160675123 -> 9160675123.
 *
 * This is deliberately NOT canonical normalization. The relation is used only
 * to discover a REVIEW candidate inside the same exact merchant namespace.
 */
export function decoratedOrderReviewBase(value: string | null | undefined): string | null {
  const normalized = normalizeStableIdentifier(value);
  if (!normalized) return null;
  const match = normalized.match(/^[A-Z]{1,4}([0-9][A-Z0-9]{5,})$/);
  return match?.[1] ?? null;
}

export function merchantNamespaceOrderKey(
  userId: string,
  merchantNamespace: string | null | undefined,
  orderId: string | null,
): string | null {
  const normalizedNamespace = merchantNamespace?.trim().toLowerCase() || null;
  const normalizedOrder = normalizeStableIdentifier(orderId);
  if (!normalizedNamespace || !normalizedOrder) return null;
  return `${encodeURIComponent(userId.trim().toLowerCase())}:${encodeURIComponent(normalizedNamespace)}:${normalizedOrder}`;
}

export function buildCandidateIndex(snapshot: PurchaseIdentitySnapshot): CandidateIndex {
  const index: CandidateIndex = {
    orderExact: new Map(),
    orderMerchantNamespaceExact: new Map(),
    orderMerchantNamespaceReviewAlias: new Map(),
    orderDiscovery: new Map(),
    trackingExact: new Map(),
    trackingDiscovery: new Map(),
    paymentExact: new Map(),
    paymentDiscovery: new Map(),
    invoiceExact: new Map(),
    invoiceDiscovery: new Map(),
  };

  const purchaseById = new Map(snapshot.purchases.map((purchase) => [purchase.purchaseId, purchase]));

  for (const order of snapshot.orders) {
    const purchase = purchaseById.get(order.purchaseId);
    if (!purchase) continue;
    const normalizedOrder = normalizeStableIdentifier(order.orderId);
    const reviewBase = decoratedOrderReviewBase(order.orderId);
    add(index.orderExact, orderIdentityKey(purchase.userId, order.merchantId, order.orderId), order.purchaseId);
    add(index.orderMerchantNamespaceExact, merchantNamespaceOrderKey(purchase.userId, order.merchantNamespace, order.orderId), order.purchaseId);
    // Exact forms are indexed here as possible bases so a later decorated form
    // can find them. Decorated stored forms are additionally indexed by their
    // stripped review-only base. Neither key grants hard-link authority.
    add(index.orderMerchantNamespaceReviewAlias, merchantNamespaceOrderKey(purchase.userId, order.merchantNamespace, normalizedOrder), order.purchaseId);
    add(index.orderMerchantNamespaceReviewAlias, merchantNamespaceOrderKey(purchase.userId, order.merchantNamespace, reviewBase), order.purchaseId);
    add(index.orderDiscovery, discoveryKey(purchase.userId, normalizedOrder), order.purchaseId);
  }

  for (const shipment of snapshot.shipments) {
    const purchase = purchaseById.get(shipment.purchaseId);
    if (!purchase) continue;
    const normalizedTracking = normalizeStableIdentifier(shipment.trackingId);
    add(index.trackingExact, shipmentIdentityKey(purchase.userId, shipment.carrierId, shipment.trackingId), shipment.purchaseId);
    add(index.trackingDiscovery, discoveryKey(purchase.userId, normalizedTracking), shipment.purchaseId);
  }

  for (const payment of snapshot.payments) {
    const purchase = purchaseById.get(payment.purchaseId);
    if (!purchase) continue;
    const normalizedPayment = normalizeStableIdentifier(payment.paymentReference);
    add(index.paymentExact, paymentIdentityKey(purchase.userId, payment.providerId, payment.paymentReference), payment.purchaseId);
    add(index.paymentDiscovery, discoveryKey(purchase.userId, normalizedPayment), payment.purchaseId);
  }

  for (const invoice of snapshot.invoices) {
    const purchase = purchaseById.get(invoice.purchaseId);
    if (!purchase) continue;
    const normalizedInvoice = normalizeStableIdentifier(invoice.invoiceId);
    add(index.invoiceExact, invoiceIdentityKey(purchase.userId, invoice.issuerId, invoice.invoiceId), invoice.purchaseId);
    add(index.invoiceDiscovery, discoveryKey(purchase.userId, normalizedInvoice), invoice.purchaseId);
  }

  return index;
}

export function candidatePurchaseIds(event: CanonicalEvent, index: CandidateIndex): Set<string> {
  const result = new Set<string>();
  const order = normalizeStableIdentifier(event.orderIdNormalized ?? event.orderIdRaw);
  const orderReviewBase = decoratedOrderReviewBase(order);
  const tracking = normalizeStableIdentifier(event.trackingIdNormalized ?? event.trackingIdRaw);
  const payment = normalizeStableIdentifier(event.paymentReference);
  const invoice = normalizeStableIdentifier(event.invoiceIdNormalized ?? event.invoiceIdRaw);

  const keys: Array<[Map<string, Set<string>>, string | null]> = [
    [index.orderExact, orderIdentityKey(event.userId, event.merchantId, order)],
    [index.orderMerchantNamespaceExact, merchantNamespaceOrderKey(event.userId, event.merchantNamespace, order)],
    [index.orderMerchantNamespaceReviewAlias, merchantNamespaceOrderKey(event.userId, event.merchantNamespace, orderReviewBase ?? order)],
    [index.orderDiscovery, discoveryKey(event.userId, order)],
    [index.trackingExact, shipmentIdentityKey(event.userId, event.carrierId, tracking)],
    [index.trackingDiscovery, discoveryKey(event.userId, tracking)],
    [index.paymentExact, paymentIdentityKey(event.userId, event.paymentProviderId, payment)],
    [index.paymentDiscovery, discoveryKey(event.userId, payment)],
    [index.invoiceExact, invoiceIdentityKey(event.userId, event.invoiceIssuerId, invoice)],
    [index.invoiceDiscovery, discoveryKey(event.userId, invoice)],
  ];

  for (const [map, key] of keys) {
    if (!key) continue;
    for (const purchaseId of map.get(key) ?? []) result.add(purchaseId);
  }
  return result;
}
