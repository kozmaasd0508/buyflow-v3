import assert from 'node:assert/strict';
import test from 'node:test';
import { UnresolvedEventPool, exactIdentityKeys } from './unresolved-event-pool.js';
import type { CanonicalEvent, CorrelationDecision } from './types.js';

function event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: 'event-1',
    userId: 'user-1',
    eventType: 'shipment_created',
    sourceProvider: 'test',
    sourceMessageId: 'message-1',
    senderDomain: 'carrier.example',
    receivedAt: '2026-08-27T20:00:00Z',
    occurredAt: null,
    merchantRaw: null,
    merchantId: null,
    merchantNamespace: null,
    orderIdRaw: null,
    orderIdNormalized: null,
    trackingIdRaw: 'ABC123456',
    trackingIdNormalized: 'ABC123456',
    invoiceIdRaw: null,
    invoiceIdNormalized: null,
    paymentReference: null,
    amount: null,
    currency: null,
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: [],
    sourceRole: 'carrier',
    carrierId: 'express-one',
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
    ...overrides,
  };
}

const unlinked: CorrelationDecision = { kind: 'UNLINKED', reasons: [] };

test('stores actionable unlinked lifecycle event idempotently', () => {
  const pool = new UnresolvedEventPool();
  const current = event();

  assert.equal(pool.remember(current, unlinked), true);
  assert.equal(pool.remember(current, unlinked), false);
  assert.equal(pool.unresolved().length, 1);
  assert.equal(pool.unresolved()[0]?.reason, 'NO_PROVABLE_PARENT');
  assert.equal(pool.unresolved()[0]?.identityKeys[0]?.kind, 'tracking');
});

test('does not store order roots, terminal noise, review or pending decisions', () => {
  const pool = new UnresolvedEventPool();
  assert.equal(pool.remember(event({ eventType: 'order_created' }), unlinked), false);
  assert.equal(pool.remember(event({ eventId: 'other', eventType: 'other' }), unlinked), false);
  assert.equal(pool.remember(event({ eventId: 'review' }), {
    kind: 'REVIEW', candidatePurchaseIds: [], reasons: [],
  }), false);
  assert.equal(pool.remember(event({ eventId: 'pending' }), {
    kind: 'PENDING', candidatePurchaseIds: [], reasons: [], conflicts: [],
  }), false);
  assert.equal(pool.unresolved().length, 0);
});

test('plans targeted recovery only for the same user and exact namespaced tracking identity', () => {
  const pool = new UnresolvedEventPool();
  pool.remember(event(), unlinked);

  const same = pool.planRecovery(event({
    eventId: 'merchant-shipment',
    sourceRole: 'merchant',
    senderDomain: 'shop.example',
    merchantNamespace: 'sender-domain:shop.example',
  }));
  assert.deepEqual(same.unresolvedEventIds, ['event-1']);
  assert.equal(same.sharedIdentityKeys.length, 1);

  const wrongCarrier = pool.planRecovery(event({ eventId: 'wrong-carrier', carrierId: 'gls' }));
  assert.deepEqual(wrongCarrier.unresolvedEventIds, []);

  const wrongUser = pool.planRecovery(event({ eventId: 'wrong-user', userId: 'user-2' }));
  assert.deepEqual(wrongUser.unresolvedEventIds, []);
});

test('namespaced order identity can target an unresolved lifecycle event without cross-merchant matching', () => {
  const pool = new UnresolvedEventPool();
  pool.remember(event({
    eventId: 'invoice-event',
    eventType: 'invoice_created',
    sourceRole: 'merchant',
    senderDomain: 'shop.example',
    merchantNamespace: 'sender-domain:shop.example',
    orderIdRaw: '#9876',
    orderIdNormalized: '9876',
    trackingIdRaw: null,
    trackingIdNormalized: null,
    carrierId: null,
  }), unlinked);

  const sameMerchant = pool.planRecovery(event({
    eventId: 'order-proof',
    eventType: 'order_created',
    sourceRole: 'merchant',
    senderDomain: 'shop.example',
    merchantNamespace: 'sender-domain:shop.example',
    orderIdRaw: '9876',
    orderIdNormalized: '9876',
    trackingIdRaw: null,
    trackingIdNormalized: null,
    carrierId: null,
  }));
  assert.deepEqual(sameMerchant.unresolvedEventIds, ['invoice-event']);

  const otherMerchant = pool.planRecovery(event({
    eventId: 'other-shop',
    eventType: 'order_created',
    sourceRole: 'merchant',
    senderDomain: 'other.example',
    merchantNamespace: 'sender-domain:other.example',
    orderIdRaw: '9876',
    orderIdNormalized: '9876',
    trackingIdRaw: null,
    trackingIdNormalized: null,
    carrierId: null,
  }));
  assert.deepEqual(otherMerchant.unresolvedEventIds, []);
});

test('snapshot round-trip preserves unresolved evidence and resolution state', () => {
  const pool = new UnresolvedEventPool();
  pool.remember(event(), unlinked);
  assert.equal(pool.recordAttempt('event-1', '2026-08-27T21:00:00Z'), true);

  const restored = new UnresolvedEventPool(pool.snapshot());
  assert.equal(restored.unresolved()[0]?.attemptCount, 1);
  assert.equal(restored.markResolved('event-1', 'purchase-1'), true);
  assert.equal(restored.unresolved().length, 0);
  assert.equal(restored.snapshot().records[0]?.resolvedPurchaseId, 'purchase-1');
});

test('exact identity keys require namespaces and never promote an unscoped identifier', () => {
  assert.deepEqual(exactIdentityKeys(event({ carrierId: null })), []);
  const keys = exactIdentityKeys(event());
  assert.equal(keys.length, 1);
  assert.match(keys[0]!.key, /\|tracking\|express-one\|ABC123456$/);
});
