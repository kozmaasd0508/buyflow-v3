import assert from 'node:assert/strict';
import test from 'node:test';
import { PurchaseIdentityGraph } from './graph.js';
import type { CanonicalEvent } from './types.js';

const USER_ID = 'lifecycle-root-test-user';
const MERCHANT_NAMESPACE = 'orders.example-shop.test';
const ORDER_ID = 'ROOT-778812';

function event(input: {
  id: string;
  eventType: CanonicalEvent['eventType'];
  authority: CanonicalEvent['purchaseCreationAuthority'];
  orderId?: string | null;
  trackingId?: string | null;
}): CanonicalEvent {
  const orderId = input.orderId === undefined ? ORDER_ID : input.orderId;
  const trackingId = input.trackingId ?? null;
  return {
    eventId: `lifecycle-root:${input.id}`,
    userId: USER_ID,
    eventType: input.eventType,
    sourceProvider: 'gmail',
    sourceMessageId: `message:${input.id}`,
    senderDomain: MERCHANT_NAMESPACE,
    receivedAt: '2026-08-29T18:00:00.000Z',
    occurredAt: null,
    merchantRaw: 'Example Shop',
    merchantId: null,
    merchantNamespace: MERCHANT_NAMESPACE,
    purchaseCreationAuthority: input.authority,
    purchaseCreationReasons: input.authority === 'authorized' ? ['test-independent-root-evidence'] : [],
    orderRelation: null,
    orderIdRaw: orderId,
    orderIdNormalized: orderId,
    trackingIdRaw: trackingId,
    trackingIdNormalized: trackingId,
    invoiceIdRaw: null,
    invoiceIdNormalized: null,
    paymentReference: null,
    amount: null,
    currency: null,
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: [{
      field: 'order_number',
      source: 'body',
      parserVersion: 'lifecycle-root-test',
      confidence: 1,
      qualifiers: ['deterministic-root-evidence'],
    }],
    sourceRole: 'merchant',
    carrierId: trackingId ? 'dpd' : null,
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
  };
}

test('authorized ORDER_PROCESSING-style canonical event can create the first Purchase root', () => {
  const graph = new PurchaseIdentityGraph();
  const applied = graph.applyEvent(event({
    id: 'processing-root',
    eventType: 'order_updated',
    authority: 'authorized',
  }));

  assert.equal(applied.decision.kind, 'NEW_PURCHASE');
  assert.equal(applied.mutated, true);
  assert.equal(applied.productionWrites, 0);
  assert.equal(applied.aiCalls, 0);
  assert.equal(applied.snapshot.purchases.length, 1);
  assert.equal(applied.snapshot.orders.length, 1);
  assert.equal(applied.snapshot.orders[0]?.orderId, ORDER_ID);
});

test('lifecycle-only shipment cannot create a Purchase without independent root authority', () => {
  const graph = new PurchaseIdentityGraph();
  const applied = graph.applyEvent(event({
    id: 'shipment-only',
    eventType: 'shipment_created',
    authority: 'none',
    trackingId: 'DPD-1234567890',
  }));

  assert.equal(applied.decision.kind, 'UNLINKED');
  assert.equal(applied.mutated, false);
  assert.equal(applied.snapshot.purchases.length, 0);
  assert.equal(applied.snapshot.shipments.length, 0);
});

test('review-only root evidence fails closed for a lifecycle primary event', () => {
  const graph = new PurchaseIdentityGraph();
  const applied = graph.applyEvent(event({
    id: 'processing-review',
    eventType: 'order_updated',
    authority: 'review',
  }));

  assert.equal(applied.decision.kind, 'REVIEW');
  assert.equal(applied.mutated, false);
  assert.equal(applied.snapshot.purchases.length, 0);
});

test('hard identity link wins for an existing Purchase even when the later event has no creation authority', () => {
  const graph = new PurchaseIdentityGraph();
  const root = graph.applyEvent(event({
    id: 'existing-root',
    eventType: 'order_updated',
    authority: 'authorized',
  }));
  assert.equal(root.decision.kind, 'NEW_PURCHASE');

  const lifecycle = graph.applyEvent(event({
    id: 'later-shipment',
    eventType: 'shipment_created',
    authority: 'none',
    trackingId: 'DPD-1234567890',
  }));

  assert.equal(lifecycle.decision.kind, 'LINKED');
  assert.equal(lifecycle.mutated, true);
  assert.equal(lifecycle.snapshot.purchases.length, 1);
  assert.equal(lifecycle.snapshot.shipments.length, 1);
  assert.equal(lifecycle.snapshot.shipments[0]?.trackingId, 'DPD-1234567890');
});
