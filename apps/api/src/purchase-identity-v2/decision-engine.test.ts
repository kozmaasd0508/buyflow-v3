import assert from 'node:assert/strict';
import test from 'node:test';
import { decideCorrelation } from './decision-engine.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';

function event(overrides: Partial<CanonicalEvent>): CanonicalEvent {
  return {
    eventId: overrides.eventId ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'user-1',
    eventType: overrides.eventType ?? 'other',
    sourceProvider: overrides.sourceProvider ?? 'test',
    sourceMessageId: overrides.sourceMessageId ?? crypto.randomUUID(),
    senderDomain: overrides.senderDomain ?? 'example.com',
    receivedAt: overrides.receivedAt ?? '2026-08-20T10:00:00.000Z',
    occurredAt: overrides.occurredAt ?? null,
    merchantRaw: overrides.merchantRaw ?? null,
    merchantId: overrides.merchantId ?? null,
    merchantNamespace: overrides.merchantNamespace ?? null,
    purchaseCreationAuthority: overrides.purchaseCreationAuthority ?? 'none',
    purchaseCreationReasons: overrides.purchaseCreationReasons ?? [],
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
    sourceRole: overrides.sourceRole,
    carrierId: overrides.carrierId ?? null,
    paymentProviderId: overrides.paymentProviderId ?? null,
    invoiceIssuerId: overrides.invoiceIssuerId ?? null,
    platformMerchantId: overrides.platformMerchantId ?? null,
    sellerMerchantId: overrides.sellerMerchantId ?? null,
    conflicts: overrides.conflicts ?? [],
  };
}

function snapshot(): PurchaseIdentitySnapshot {
  return {
    purchases: [
      { purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'shop', primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p2', userId: 'user-1', canonicalMerchantId: 'other', primaryOrderIdentityId: 'o2', state: 'open' },
    ],
    orders: [
      { orderIdentityId: 'o1', purchaseId: 'p1', merchantId: 'shop', orderId: 'ABC-123', relation: 'primary', parentOrderIdentityId: null },
      { orderIdentityId: 'o2', purchaseId: 'p2', merchantId: 'other', orderId: 'XYZ-999', relation: 'primary', parentOrderIdentityId: null },
    ],
    shipments: [
      { shipmentId: 's1', purchaseId: 'p1', carrierId: 'gls', trackingId: 'GLS-77', status: 'in_transit' },
    ],
    payments: [
      { paymentId: 'pay1', purchaseId: 'p1', providerId: 'barion', paymentReference: 'PAY-555', amount: 1000, currency: 'HUF' },
    ],
    invoices: [
      { invoiceIdentityId: 'i1', purchaseId: 'p1', issuerId: 'billingo', invoiceId: 'INV-42', orderId: 'ABC-123' },
    ],
  };
}

test('links by exact normalized order identity inside merchant namespace', () => {
  const result = decideCorrelation(event({ eventType: 'shipment_created', merchantId: 'shop', orderIdRaw: 'abc 123' }), snapshot());
  assert.equal(result.kind, 'LINKED');
  if (result.kind === 'LINKED') assert.equal(result.purchaseId, 'p1');
});

test('links by exact tracking identity inside carrier namespace', () => {
  const result = decideCorrelation(event({ eventType: 'delivered', carrierId: 'gls', trackingIdRaw: 'GLS77' }), snapshot());
  assert.equal(result.kind, 'LINKED');
  if (result.kind === 'LINKED') assert.equal(result.purchaseId, 'p1');
});

test('tracking id without carrier namespace is review-only', () => {
  const result = decideCorrelation(event({ eventType: 'delivered', trackingIdRaw: 'GLS77' }), snapshot());
  assert.equal(result.kind, 'REVIEW');
  if (result.kind === 'REVIEW') assert.deepEqual(result.candidatePurchaseIds, ['p1']);
});

test('links by exact payment identity inside provider namespace', () => {
  const result = decideCorrelation(event({
    eventType: 'payment_completed',
    paymentProviderId: 'barion',
    paymentReference: 'pay 555',
  }), snapshot());
  assert.equal(result.kind, 'LINKED');
  if (result.kind === 'LINKED') assert.equal(result.purchaseId, 'p1');
});

test('payment reference without provider namespace is review-only', () => {
  const result = decideCorrelation(event({ eventType: 'payment_completed', paymentReference: 'pay 555' }), snapshot());
  assert.equal(result.kind, 'REVIEW');
  if (result.kind === 'REVIEW') assert.deepEqual(result.candidatePurchaseIds, ['p1']);
});

test('links by exact invoice identity inside issuer namespace', () => {
  const result = decideCorrelation(event({
    eventType: 'invoice_created',
    invoiceIssuerId: 'billingo',
    invoiceIdRaw: 'inv 42',
  }), snapshot());
  assert.equal(result.kind, 'LINKED');
  if (result.kind === 'LINKED') assert.equal(result.purchaseId, 'p1');
});

test('creates a new purchase only from an explicitly authorized safe root anchor', () => {
  const result = decideCorrelation(event({
    eventType: 'order_created',
    merchantId: 'new-shop',
    orderIdRaw: 'NEW-1',
    purchaseCreationAuthority: 'authorized',
  }), snapshot());
  assert.equal(result.kind, 'NEW_PURCHASE');
});

test('known merchant plus order id is not enough without independent creation authority', () => {
  const result = decideCorrelation(event({
    eventType: 'order_created',
    merchantId: 'new-shop',
    orderIdRaw: 'NEW-1',
    purchaseCreationAuthority: 'none',
  }), snapshot());
  assert.equal(result.kind, 'UNLINKED');
});

test('authorized lifecycle primary event can create only through the separate root authority channel', () => {
  const result = decideCorrelation(event({
    eventType: 'order_updated',
    merchantId: 'new-shop',
    orderIdRaw: 'NEW-2',
    purchaseCreationAuthority: 'authorized',
  }), snapshot());
  assert.equal(result.kind, 'NEW_PURCHASE');
});

test('lifecycle-only event without a hard identifier stays unlinked', () => {
  const result = decideCorrelation(event({ eventType: 'shipment_created', merchantId: 'shop' }), snapshot());
  assert.equal(result.kind, 'UNLINKED');
});

test('ambiguous unscoped order id becomes review instead of merge', () => {
  const ambiguous = snapshot();
  ambiguous.orders.push({ orderIdentityId: 'o3', purchaseId: 'p2', merchantId: 'other', orderId: 'ABC-123', relation: 'primary', parentOrderIdentityId: null });
  const result = decideCorrelation(event({ eventType: 'payment_completed', orderIdRaw: 'ABC123' }), ambiguous);
  assert.equal(result.kind, 'REVIEW');
  if (result.kind === 'REVIEW') assert.deepEqual(result.candidatePurchaseIds, ['p1', 'p2']);
});

test('same tracking id under different carriers links only the matching carrier namespace', () => {
  const ambiguous = snapshot();
  ambiguous.shipments.push({ shipmentId: 's2', purchaseId: 'p2', carrierId: 'dpd', trackingId: 'GLS-77', status: 'in_transit' });

  const result = decideCorrelation(event({
    eventType: 'delivered',
    carrierId: 'gls',
    trackingIdRaw: 'GLS77',
  }), ambiguous);

  assert.equal(result.kind, 'LINKED');
  if (result.kind === 'LINKED') assert.equal(result.purchaseId, 'p1');
});

test('same tracking id under different carriers without carrier namespace stays review-only', () => {
  const ambiguous = snapshot();
  ambiguous.shipments.push({ shipmentId: 's2', purchaseId: 'p2', carrierId: 'dpd', trackingId: 'GLS-77', status: 'in_transit' });

  const result = decideCorrelation(event({ eventType: 'delivered', trackingIdRaw: 'GLS77' }), ambiguous);

  assert.equal(result.kind, 'REVIEW');
  if (result.kind === 'REVIEW') assert.deepEqual(result.candidatePurchaseIds, ['p1', 'p2']);
});

test('hard source conflict becomes pending even with an otherwise exact identity', () => {
  const result = decideCorrelation(event({
    eventType: 'shipment_created',
    merchantId: 'shop',
    orderIdRaw: 'ABC123',
    conflicts: [{
      field: 'order_number',
      values: ['ABC123', 'XYZ999'],
      evidence: [],
      severity: 'hard',
      explanation: 'two strong current-message order identifiers disagree',
    }],
  }), snapshot());

  assert.equal(result.kind, 'PENDING');
  if (result.kind === 'PENDING') {
    assert.deepEqual(result.candidatePurchaseIds, ['p1']);
    assert.equal(result.conflicts.length, 1);
  }
});

test('different exact order ids never merge', () => {
  const result = decideCorrelation(event({ eventType: 'shipment_created', merchantId: 'other', orderIdRaw: 'XYZ999' }), snapshot());
  assert.equal(result.kind, 'LINKED');
  if (result.kind === 'LINKED') assert.equal(result.purchaseId, 'p2');
});
