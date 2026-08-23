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

export function buildCandidateIndex(snapshot: PurchaseIdentitySnapshot): CandidateIndex {
  const index: CandidateIndex = {
    orderExact: new Map(),
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
    add(index.orderExact, orderIdentityKey(purchase.userId, order.merchantId, order.orderId), order.purchaseId);
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
  const tracking = normalizeStableIdentifier(event.trackingIdNormalized ?? event.trackingIdRaw);
  const payment = normalizeStableIdentifier(event.paymentReference);
  const invoice = normalizeStableIdentifier(event.invoiceIdNormalized ?? event.invoiceIdRaw);

  const keys: Array<[Map<string, Set<string>>, string | null]> = [
    [index.orderExact, orderIdentityKey(event.userId, event.merchantId, order)],
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
