import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';

export interface CandidateIndex {
  order: Map<string, Set<string>>;
  tracking: Map<string, Set<string>>;
  payment: Map<string, Set<string>>;
  invoice: Map<string, Set<string>>;
}

function add(map: Map<string, Set<string>>, key: string | null, purchaseId: string) {
  if (!key) return;
  const set = map.get(key) ?? new Set<string>();
  set.add(purchaseId);
  map.set(key, set);
}

function userKey(userId: string, id: string | null): string | null {
  return id ? `${userId}::${id}` : null;
}

function merchantOrderKey(userId: string, merchantId: string | null, orderId: string | null): string | null {
  if (!merchantId || !orderId) return null;
  return `${userId}::${merchantId}::${orderId}`;
}

export function buildCandidateIndex(snapshot: PurchaseIdentitySnapshot): CandidateIndex {
  const index: CandidateIndex = {
    order: new Map(),
    tracking: new Map(),
    payment: new Map(),
    invoice: new Map(),
  };

  const purchaseById = new Map(snapshot.purchases.map((purchase) => [purchase.purchaseId, purchase]));

  for (const order of snapshot.orders) {
    const purchase = purchaseById.get(order.purchaseId);
    if (!purchase) continue;
    const normalizedOrder = normalizeStableIdentifier(order.orderId);
    add(index.order, merchantOrderKey(purchase.userId, order.merchantId, normalizedOrder), order.purchaseId);
    add(index.order, userKey(purchase.userId, normalizedOrder), order.purchaseId);
  }

  for (const shipment of snapshot.shipments) {
    const purchase = purchaseById.get(shipment.purchaseId);
    if (!purchase) continue;
    add(index.tracking, userKey(purchase.userId, normalizeStableIdentifier(shipment.trackingId)), shipment.purchaseId);
  }

  for (const payment of snapshot.payments) {
    const purchase = purchaseById.get(payment.purchaseId);
    if (!purchase) continue;
    add(index.payment, userKey(purchase.userId, normalizeStableIdentifier(payment.paymentReference)), payment.purchaseId);
  }

  for (const invoice of snapshot.invoices) {
    const purchase = purchaseById.get(invoice.purchaseId);
    if (!purchase) continue;
    add(index.invoice, userKey(purchase.userId, normalizeStableIdentifier(invoice.invoiceId)), invoice.purchaseId);
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
    [index.order, merchantOrderKey(event.userId, event.merchantId, order)],
    [index.order, userKey(event.userId, order)],
    [index.tracking, userKey(event.userId, tracking)],
    [index.payment, userKey(event.userId, payment)],
    [index.invoice, userKey(event.userId, invoice)],
  ];

  for (const [map, key] of keys) {
    if (!key) continue;
    for (const purchaseId of map.get(key) ?? []) result.add(purchaseId);
  }
  return result;
}
