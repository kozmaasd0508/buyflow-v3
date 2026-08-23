import assert from 'node:assert/strict';
import test from 'node:test';
import { PurchaseIdentityGraph } from './graph.js';
import type { CanonicalEvent } from './types.js';

function event(overrides: Partial<CanonicalEvent>): CanonicalEvent {
  return {
    eventId: overrides.eventId ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'user-1',
    eventType: overrides.eventType ?? 'other',
    sourceProvider: overrides.sourceProvider ?? 'test',
    sourceMessageId: overrides.sourceMessageId ?? crypto.randomUUID(),
    senderDomain: overrides.senderDomain ?? 'shop.example',
    receivedAt: overrides.receivedAt ?? '2026-08-20T10:00:00.000Z',
    occurredAt: overrides.occurredAt ?? null,
    merchantRaw: overrides.merchantRaw ?? 'Shop',
    merchantId: overrides.merchantId ?? 'shop',
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
    carrierId: overrides.carrierId ?? null,
    paymentProviderId: overrides.paymentProviderId ?? null,
    invoiceIssuerId: overrides.invoiceIssuerId ?? null,
    conflicts: overrides.conflicts ?? [],
  };
}

test('builds one purchase timeline from order, shipment, payment, invoice and delivery', () => {
  const graph = new PurchaseIdentityGraph();

  const created = graph.applyEvent(event({ eventType: 'order_created', orderIdRaw: 'ABC-123' }));
  assert.equal(created.decision.kind, 'NEW_PURCHASE');
  assert.equal(created.productionWrites, 0);
  assert.equal(created.aiCalls, 0);

  const shipped = graph.applyEvent(event({
    eventType: 'shipment_created',
    orderIdRaw: 'ABC123',
    carrierId: 'gls',
    trackingIdRaw: 'GLS-77',
  }));
  assert.equal(shipped.decision.kind, 'LINKED');

  const paid = graph.applyEvent(event({
    eventType: 'payment_completed',
    orderIdRaw: 'ABC123',
    paymentProviderId: 'barion',
    paymentReference: 'PAY-9',
    amount: 12990,
    currency: 'HUF',
  }));
  assert.equal(paid.decision.kind, 'LINKED');

  const invoiced = graph.applyEvent(event({
    eventType: 'invoice_created',
    orderIdRaw: 'ABC123',
    invoiceIssuerId: 'billingo',
    invoiceIdRaw: 'INV-42',
  }));
  assert.equal(invoiced.decision.kind, 'LINKED');

  const delivered = graph.applyEvent(event({
    eventType: 'delivered',
    carrierId: 'gls',
    trackingIdRaw: 'GLS77',
    merchantId: null,
    merchantRaw: null,
    orderIdRaw: null,
  }));
  assert.equal(delivered.decision.kind, 'LINKED');

  const snapshot = graph.snapshot();
  assert.equal(snapshot.purchases.length, 1);
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.shipments.length, 1);
  assert.equal(snapshot.payments.length, 1);
  assert.equal(snapshot.invoices.length, 1);
  assert.equal(snapshot.shipments[0]?.carrierId, 'gls');
  assert.equal(snapshot.payments[0]?.providerId, 'barion');
  assert.equal(snapshot.invoices[0]?.issuerId, 'billingo');
  assert.equal(snapshot.purchases[0]?.state, 'fulfilled');
  assert.equal(snapshot.shipments[0]?.status, 'delivered');
});

test('supports multiple shipments under one purchase', () => {
  const graph = new PurchaseIdentityGraph();
  graph.applyEvent(event({ eventType: 'order_created', orderIdRaw: 'ORDER-1' }));
  graph.applyEvent(event({ eventType: 'shipment_created', orderIdRaw: 'ORDER1', carrierId: 'gls', trackingIdRaw: 'TRACK-1' }));
  graph.applyEvent(event({ eventType: 'shipment_created', orderIdRaw: 'ORDER1', carrierId: 'gls', trackingIdRaw: 'TRACK-2' }));

  assert.equal(graph.snapshot().shipments.length, 2);
});

test('keeps ambiguous event review-only and does not mutate graph', () => {
  const graph = new PurchaseIdentityGraph({
    purchases: [
      { purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'shop-a', primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p2', userId: 'user-1', canonicalMerchantId: 'shop-b', primaryOrderIdentityId: 'o2', state: 'open' },
    ],
    orders: [
      { orderIdentityId: 'o1', purchaseId: 'p1', merchantId: 'shop-a', orderId: '12345', relation: 'primary', parentOrderIdentityId: null },
      { orderIdentityId: 'o2', purchaseId: 'p2', merchantId: 'shop-b', orderId: '12345', relation: 'primary', parentOrderIdentityId: null },
    ],
    shipments: [],
    payments: [],
    invoices: [],
  });

  const before = graph.snapshot();
  const result = graph.applyEvent(event({
    eventType: 'payment_completed',
    merchantId: null,
    merchantRaw: null,
    orderIdRaw: '12345',
    paymentReference: 'PAY-X',
  }));

  assert.equal(result.decision.kind, 'REVIEW');
  assert.equal(result.mutated, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('keeps hard-conflict event pending and does not mutate graph', () => {
  const graph = new PurchaseIdentityGraph();
  graph.applyEvent(event({ eventType: 'order_created', orderIdRaw: 'ORDER-1' }));
  const before = graph.snapshot();

  const result = graph.applyEvent(event({
    eventType: 'shipment_created',
    orderIdRaw: 'ORDER1',
    conflicts: [{
      field: 'order_number',
      values: ['ORDER1', 'ORDER2'],
      evidence: [],
      severity: 'hard',
      explanation: 'conflicting strong order identifiers',
    }],
  }));

  assert.equal(result.decision.kind, 'PENDING');
  assert.equal(result.mutated, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('adds explicit split child order to the same purchase', () => {
  const graph = new PurchaseIdentityGraph();
  graph.applyEvent(event({ eventType: 'order_created', orderIdRaw: 'PARENT-1' }));

  const added = graph.addParentChildOrder('user-1', {
    parentOrderId: 'PARENT1',
    childOrderId: 'CHILD-2',
    merchantId: 'shop',
    relation: 'split_child',
  });

  assert.equal(added, true);
  const snapshot = graph.snapshot();
  assert.equal(snapshot.purchases.length, 1);
  assert.equal(snapshot.orders.length, 2);
  assert.equal(snapshot.orders.find((item) => item.orderId === 'CHILD-2')?.relation, 'split_child');
});

test('refuses parent-child relation when child already belongs to another purchase', () => {
  const graph = new PurchaseIdentityGraph({
    purchases: [
      { purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'shop', primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p2', userId: 'user-1', canonicalMerchantId: 'shop', primaryOrderIdentityId: 'o2', state: 'open' },
    ],
    orders: [
      { orderIdentityId: 'o1', purchaseId: 'p1', merchantId: 'shop', orderId: 'PARENT-1', relation: 'primary', parentOrderIdentityId: null },
      { orderIdentityId: 'o2', purchaseId: 'p2', merchantId: 'shop', orderId: 'CHILD-2', relation: 'primary', parentOrderIdentityId: null },
    ],
    shipments: [],
    payments: [],
    invoices: [],
  });

  const added = graph.addParentChildOrder('user-1', {
    parentOrderId: 'PARENT1',
    childOrderId: 'CHILD2',
    merchantId: 'shop',
    relation: 'split_child',
  });

  assert.equal(added, false);
  assert.equal(graph.snapshot().orders.length, 2);
});
