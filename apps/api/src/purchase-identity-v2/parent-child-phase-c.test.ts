import assert from 'node:assert/strict';
import test from 'node:test';
import { PurchaseIdentityGraph } from './graph.js';
import type { CanonicalEvent, ExplicitOrderRelation } from './types.js';

function relation(
  parentOrderId: string,
  childOrderId: string,
  overrides: Partial<ExplicitOrderRelation> = {},
): ExplicitOrderRelation {
  return {
    relation: overrides.relation ?? 'split_child',
    parentOrderIdRaw: parentOrderId,
    parentOrderIdNormalized: overrides.parentOrderIdNormalized ?? null,
    childOrderIdRaw: childOrderId,
    childOrderIdNormalized: overrides.childOrderIdNormalized ?? null,
    provenance: overrides.provenance ?? [{
      field: 'order_relation',
      source: 'body',
      parserVersion: null,
      extractorId: 'phase-c-test',
      extractorVersion: 'v1',
      confidence: 0.99,
      qualifiers: ['explicit_parent_child_order'],
    }],
  };
}

function event(overrides: Partial<CanonicalEvent>): CanonicalEvent {
  return {
    eventId: overrides.eventId ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'user-1',
    eventType: overrides.eventType ?? 'other',
    sourceProvider: overrides.sourceProvider ?? 'test',
    sourceMessageId: overrides.sourceMessageId ?? crypto.randomUUID(),
    senderDomain: overrides.senderDomain ?? 'shop.example',
    receivedAt: overrides.receivedAt ?? '2026-08-25T20:30:00.000Z',
    occurredAt: overrides.occurredAt ?? null,
    merchantRaw: overrides.merchantRaw ?? 'Shop',
    merchantId: overrides.merchantId === undefined ? 'shop' : overrides.merchantId,
    merchantNamespace: overrides.merchantNamespace ?? null,
    purchaseCreationAuthority: overrides.purchaseCreationAuthority,
    purchaseCreationReasons: overrides.purchaseCreationReasons,
    orderRelation: overrides.orderRelation ?? null,
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
    sourceRole: overrides.sourceRole ?? 'merchant',
    carrierId: overrides.carrierId ?? null,
    paymentProviderId: overrides.paymentProviderId ?? null,
    invoiceIssuerId: overrides.invoiceIssuerId ?? null,
    platformMerchantId: overrides.platformMerchantId ?? null,
    sellerMerchantId: overrides.sellerMerchantId ?? null,
    conflicts: overrides.conflicts ?? [],
  };
}

test('explicit split child shipment links to parent purchase and records machine-readable evidence', () => {
  const graph = new PurchaseIdentityGraph();
  graph.applyEvent(event({ eventType: 'order_created', orderIdRaw: 'PARENT-1' }));

  const result = graph.applyEvent(event({
    eventType: 'shipment_created',
    orderIdRaw: 'CHILD-2',
    orderRelation: relation('PARENT-1', 'CHILD-2'),
    carrierId: 'gls',
    trackingIdRaw: 'TRACK-CHILD-2',
  }));

  assert.equal(result.decision.kind, 'LINKED');
  assert.ok(result.decision.kind === 'LINKED' && result.decision.reasons.some((edge) =>
    edge.evidenceType === 'PARENT_CHILD_ORDER' && edge.strength === 'hard'
  ));

  const snapshot = graph.snapshot();
  assert.equal(snapshot.purchases.length, 1);
  assert.equal(snapshot.orders.length, 2);
  assert.equal(snapshot.shipments.length, 1);
  const child = snapshot.orders.find((item) => item.orderId === 'CHILD-2');
  assert.equal(child?.relation, 'split_child');
  assert.equal(child?.parentOrderIdentityId, snapshot.purchases[0]?.primaryOrderIdentityId);
});

test('two explicit child shipments remain separate shipments under one purchase', () => {
  const graph = new PurchaseIdentityGraph();
  graph.applyEvent(event({ eventType: 'order_created', orderIdRaw: 'PARENT-1' }));

  const first = graph.applyEvent(event({
    eventType: 'shipment_created',
    orderIdRaw: 'CHILD-2',
    orderRelation: relation('PARENT-1', 'CHILD-2'),
    carrierId: 'gls',
    trackingIdRaw: 'TRACK-1',
  }));
  const second = graph.applyEvent(event({
    eventType: 'shipment_created',
    orderIdRaw: 'CHILD-3',
    orderRelation: relation('PARENT-1', 'CHILD-3'),
    carrierId: 'gls',
    trackingIdRaw: 'TRACK-2',
  }));

  assert.equal(first.decision.kind, 'LINKED');
  assert.equal(second.decision.kind, 'LINKED');
  const snapshot = graph.snapshot();
  assert.equal(snapshot.purchases.length, 1);
  assert.equal(snapshot.orders.length, 3);
  assert.equal(snapshot.shipments.length, 2);
  assert.deepEqual(snapshot.shipments.map((item) => item.trackingId).sort(), ['TRACK-1', 'TRACK-2']);
});

test('relation-bearing child order cannot create a new Purchase when parent is missing', () => {
  const graph = new PurchaseIdentityGraph();
  const result = graph.applyEvent(event({
    eventType: 'order_created',
    orderIdRaw: 'CHILD-2',
    purchaseCreationAuthority: 'authorized',
    orderRelation: relation('MISSING-PARENT', 'CHILD-2'),
  }));

  assert.equal(result.decision.kind, 'UNLINKED');
  assert.equal(result.mutated, false);
  assert.equal(graph.snapshot().purchases.length, 0);
});

test('relation without explicit provenance is review-only', () => {
  const graph = new PurchaseIdentityGraph();
  graph.applyEvent(event({ eventType: 'order_created', orderIdRaw: 'PARENT-1' }));
  const before = graph.snapshot();

  const result = graph.applyEvent(event({
    eventType: 'shipment_created',
    orderIdRaw: 'CHILD-2',
    orderRelation: relation('PARENT-1', 'CHILD-2', { provenance: [] }),
    carrierId: 'gls',
    trackingIdRaw: 'TRACK-2',
  }));

  assert.equal(result.decision.kind, 'REVIEW');
  assert.equal(result.mutated, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('ambiguous parent order id across purchases remains REVIEW', () => {
  const graph = new PurchaseIdentityGraph({
    purchases: [
      { purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'shop-a', primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p2', userId: 'user-1', canonicalMerchantId: 'shop-b', primaryOrderIdentityId: 'o2', state: 'open' },
    ],
    orders: [
      { orderIdentityId: 'o1', purchaseId: 'p1', merchantId: 'shop-a', orderId: 'PARENT-1', relation: 'primary', parentOrderIdentityId: null },
      { orderIdentityId: 'o2', purchaseId: 'p2', merchantId: 'shop-b', orderId: 'PARENT-1', relation: 'primary', parentOrderIdentityId: null },
    ],
    shipments: [],
    payments: [],
    invoices: [],
  });
  const before = graph.snapshot();

  const result = graph.applyEvent(event({
    eventType: 'shipment_created',
    merchantId: null,
    merchantRaw: null,
    sourceRole: 'unknown',
    orderIdRaw: 'CHILD-2',
    orderRelation: relation('PARENT-1', 'CHILD-2'),
    trackingIdRaw: 'TRACK-2',
  }));

  assert.equal(result.decision.kind, 'REVIEW');
  assert.equal(result.mutated, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('existing child identity on another purchase blocks explicit relation mutation', () => {
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
  const before = graph.snapshot();

  const result = graph.applyEvent(event({
    eventType: 'shipment_created',
    orderIdRaw: 'CHILD-2',
    orderRelation: relation('PARENT-1', 'CHILD-2'),
    carrierId: 'gls',
    trackingIdRaw: 'TRACK-X',
  }));

  assert.equal(result.decision.kind, 'REVIEW');
  assert.equal(result.mutated, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('unknown merchant exact sender namespace can carry explicit split relation safely', () => {
  const graph = new PurchaseIdentityGraph();
  const created = graph.applyEvent(event({
    eventType: 'order_created',
    merchantId: null,
    merchantRaw: 'Unknown Shop',
    merchantNamespace: 'unknown-shop.example',
    senderDomain: 'unknown-shop.example',
    sourceRole: 'merchant',
    purchaseCreationAuthority: 'authorized',
    orderIdRaw: 'PARENT-9',
  }));
  assert.equal(created.decision.kind, 'NEW_PURCHASE');

  const child = graph.applyEvent(event({
    eventType: 'shipment_created',
    merchantId: null,
    merchantRaw: 'Unknown Shop',
    merchantNamespace: 'unknown-shop.example',
    senderDomain: 'unknown-shop.example',
    sourceRole: 'merchant',
    orderIdRaw: 'CHILD-10',
    orderRelation: relation('PARENT-9', 'CHILD-10'),
    carrierId: 'gls',
    trackingIdRaw: 'TRACK-10',
  }));

  assert.equal(child.decision.kind, 'LINKED');
  assert.ok(child.decision.kind === 'LINKED' && child.decision.reasons.some((edge) =>
    edge.evidenceType === 'PARENT_CHILD_ORDER' && edge.strength === 'hard'
  ));
  assert.equal(graph.snapshot().orders.length, 2);
  assert.equal(graph.snapshot().shipments.length, 1);
});
