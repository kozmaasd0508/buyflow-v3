import assert from 'node:assert/strict';
import test from 'node:test';
import { DeferredResolutionGraph } from './deferred-resolution-graph.js';
import type { CanonicalEvent } from './types.js';

function event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: overrides.eventId ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'user-1',
    eventType: overrides.eventType ?? 'other',
    sourceProvider: overrides.sourceProvider ?? 'test',
    sourceMessageId: overrides.sourceMessageId ?? crypto.randomUUID(),
    senderDomain: overrides.senderDomain ?? 'shop.example',
    receivedAt: overrides.receivedAt ?? '2026-08-27T20:00:00Z',
    occurredAt: overrides.occurredAt ?? null,
    merchantRaw: overrides.merchantRaw ?? 'Shop',
    merchantId: overrides.merchantId ?? 'shop',
    merchantNamespace: overrides.merchantNamespace ?? null,
    purchaseCreationAuthority: overrides.purchaseCreationAuthority,
    purchaseCreationReasons: overrides.purchaseCreationReasons,
    orderRelation: overrides.orderRelation,
    orderIdRaw: overrides.orderIdRaw ?? null,
    orderIdNormalized: overrides.orderIdNormalized ?? null,
    trackingIdRaw: overrides.trackingIdRaw ?? null,
    trackingIdNormalized: overrides.trackingIdNormalized ?? null,
    invoiceIdRaw: overrides.invoiceIdRaw ?? null,
    invoiceIdNormalized: overrides.invoiceIdNormalized ?? null,
    paymentReference: overrides.paymentReference ?? null,
    amount: overrides.amount ?? null,
    currency: overrides.currency ?? null,
    orderUrl: overrides.orderUrl ?? null,
    trackingUrl: overrides.trackingUrl ?? null,
    productFingerprints: overrides.productFingerprints ?? [],
    provenance: overrides.provenance ?? [],
    sourceRole: overrides.sourceRole,
    carrierId: overrides.carrierId ?? null,
    paymentProviderId: overrides.paymentProviderId ?? null,
    invoiceIssuerId: overrides.invoiceIssuerId ?? null,
    platformMerchantId: overrides.platformMerchantId ?? null,
    sellerMerchantId: overrides.sellerMerchantId ?? null,
    conflicts: overrides.conflicts ?? [],
  };
}

test('carrier-first lifecycle waits, then resolves after merchant shipment proves the same tracking identity', () => {
  const graph = new DeferredResolutionGraph();

  const carrierFirst = graph.applyEvent(event({
    eventId: 'carrier-delivered',
    eventType: 'delivered',
    sourceRole: 'carrier',
    senderDomain: 'tracking.express-one.hu',
    merchantRaw: null,
    merchantId: null,
    orderIdRaw: null,
    orderIdNormalized: null,
    carrierId: 'express-one',
    trackingIdRaw: 'TRACK-77',
    trackingIdNormalized: 'TRACK77',
  }));

  assert.equal(carrierFirst.decision.kind, 'UNLINKED');
  assert.equal(carrierFirst.mutated, false);
  assert.equal(carrierFirst.unresolvedStored, true);
  assert.equal(graph.unresolvedSnapshot().records[0]?.status, 'unresolved');

  const created = graph.applyEvent(event({
    eventId: 'order-root',
    eventType: 'order_created',
    orderIdRaw: 'ORDER-1',
    orderIdNormalized: 'ORDER1',
  }));
  assert.equal(created.decision.kind, 'NEW_PURCHASE');
  assert.deepEqual(created.recoveredEventIds, []);

  const merchantShipment = graph.applyEvent(event({
    eventId: 'merchant-shipment',
    eventType: 'shipment_created',
    orderIdRaw: 'ORDER-1',
    orderIdNormalized: 'ORDER1',
    carrierId: 'express-one',
    trackingIdRaw: 'TRACK-77',
    trackingIdNormalized: 'TRACK77',
  }));

  assert.equal(merchantShipment.decision.kind, 'LINKED');
  assert.deepEqual(merchantShipment.recoveredEventIds, ['carrier-delivered']);

  const snapshot = graph.snapshot();
  assert.equal(snapshot.purchases.length, 1);
  assert.equal(snapshot.shipments.length, 1);
  assert.equal(snapshot.shipments[0]?.status, 'delivered');
  assert.equal(snapshot.purchases[0]?.state, 'fulfilled');

  const unresolved = graph.unresolvedSnapshot().records[0];
  assert.equal(unresolved?.status, 'resolved');
  assert.equal(unresolved?.attemptCount, 1);
  assert.equal(unresolved?.resolvedPurchaseId, snapshot.purchases[0]?.purchaseId);
});

test('same tracking under another carrier never wakes the unresolved event', () => {
  const graph = new DeferredResolutionGraph();
  graph.applyEvent(event({
    eventId: 'carrier-first',
    eventType: 'delivered',
    sourceRole: 'carrier',
    merchantRaw: null,
    merchantId: null,
    carrierId: 'express-one',
    trackingIdRaw: 'SAME-77',
    trackingIdNormalized: 'SAME77',
  }));

  graph.applyEvent(event({
    eventId: 'root',
    eventType: 'order_created',
    orderIdRaw: 'ORDER-2',
    orderIdNormalized: 'ORDER2',
  }));

  const otherCarrier = graph.applyEvent(event({
    eventId: 'gls-shipment',
    eventType: 'shipment_created',
    orderIdRaw: 'ORDER-2',
    orderIdNormalized: 'ORDER2',
    carrierId: 'gls',
    trackingIdRaw: 'SAME-77',
    trackingIdNormalized: 'SAME77',
  }));

  assert.equal(otherCarrier.decision.kind, 'LINKED');
  assert.deepEqual(otherCarrier.recoveredEventIds, []);
  assert.equal(graph.unresolvedSnapshot().records[0]?.status, 'unresolved');
  assert.equal(graph.snapshot().purchases[0]?.state, 'open');
});

test('same merchant namespaced order can resolve an earlier invoice lifecycle event', () => {
  const graph = new DeferredResolutionGraph();

  const invoice = graph.applyEvent(event({
    eventId: 'invoice-first',
    eventType: 'invoice_created',
    sourceRole: 'merchant',
    merchantId: null,
    merchantNamespace: 'sender-domain:shop.example',
    orderIdRaw: '9876',
    orderIdNormalized: '9876',
    invoiceIdRaw: null,
    invoiceIdNormalized: null,
  }));
  assert.equal(invoice.decision.kind, 'UNLINKED');
  assert.equal(invoice.unresolvedStored, true);

  const root = graph.applyEvent(event({
    eventId: 'root-later',
    eventType: 'order_created',
    sourceRole: 'merchant',
    merchantId: null,
    merchantNamespace: 'sender-domain:shop.example',
    purchaseCreationAuthority: 'authorized',
    orderIdRaw: '9876',
    orderIdNormalized: '9876',
  }));

  assert.equal(root.decision.kind, 'NEW_PURCHASE');
  assert.deepEqual(root.recoveredEventIds, ['invoice-first']);
  assert.equal(graph.snapshot().invoices.length, 1);
  assert.equal(graph.unresolvedSnapshot().records[0]?.status, 'resolved');
});

test('review and pending events are never put into automatic deferred recovery', () => {
  const graph = new DeferredResolutionGraph({
    purchases: [
      { purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'a', primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p2', userId: 'user-1', canonicalMerchantId: 'b', primaryOrderIdentityId: 'o2', state: 'open' },
    ],
    orders: [
      { orderIdentityId: 'o1', purchaseId: 'p1', merchantId: 'a', orderId: '12345', relation: 'primary', parentOrderIdentityId: null },
      { orderIdentityId: 'o2', purchaseId: 'p2', merchantId: 'b', orderId: '12345', relation: 'primary', parentOrderIdentityId: null },
    ],
    shipments: [],
    payments: [],
    invoices: [],
  });

  const review = graph.applyEvent(event({
    eventId: 'ambiguous',
    eventType: 'payment_completed',
    merchantId: null,
    merchantRaw: null,
    orderIdRaw: '12345',
    orderIdNormalized: '12345',
  }));
  assert.equal(review.decision.kind, 'REVIEW');
  assert.equal(review.unresolvedStored, false);
  assert.equal(graph.unresolvedSnapshot().records.length, 0);
});
