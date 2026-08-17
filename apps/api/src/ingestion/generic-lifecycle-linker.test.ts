import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGenericLifecycleLinkCandidate } from './generic-lifecycle-linker.js';

const purchases = [
  { purchaseId: 'p1', userId: 'u1', merchantDomain: 'orders.demo.hu', orderNumber: 'ORD-1001' },
  { purchaseId: 'p2', userId: 'u1', merchantDomain: 'orders.other.hu', orderNumber: 'ORD-2002' },
];

test('links by exact order number plus exact merchant domain', () => {
  const result = resolveGenericLifecycleLinkCandidate({
    userId: 'u1',
    senderDomain: 'orders.demo.hu',
    orderNumber: 'ord-1001',
    purchases,
    shipments: [],
  });
  assert.deepEqual(result, {
    decision: 'linked_order_domain',
    purchaseId: 'p1',
    reason: 'exact_order_number_and_merchant_domain',
  });
});

test('does not use order number alone when sender domain disagrees', () => {
  const result = resolveGenericLifecycleLinkCandidate({
    userId: 'u1',
    senderDomain: 'lookalike.example',
    orderNumber: 'ORD-1001',
    purchases,
    shipments: [],
  });
  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
});

test('links by unique exact existing tracking number', () => {
  const result = resolveGenericLifecycleLinkCandidate({
    userId: 'u1',
    senderDomain: 'mail.demo.hu',
    trackingNumber: 'GLS123456789',
    purchases,
    shipments: [{ purchaseId: 'p2', trackingNumber: 'gls123456789' }],
  });
  assert.equal(result.decision, 'linked_tracking');
  assert.equal(result.purchaseId, 'p2');
});

test('returns ambiguous when one hard anchor matches multiple purchases', () => {
  const result = resolveGenericLifecycleLinkCandidate({
    userId: 'u1',
    senderDomain: 'orders.demo.hu',
    orderNumber: 'ORD-1001',
    purchases: [
      ...purchases,
      { purchaseId: 'p3', userId: 'u1', merchantDomain: 'orders.demo.hu', orderNumber: 'ORD-1001' },
    ],
    shipments: [],
  });
  assert.equal(result.decision, 'ambiguous');
  assert.equal(result.purchaseId, null);
});

test('returns ambiguous when tracking identity belongs to multiple purchases', () => {
  const result = resolveGenericLifecycleLinkCandidate({
    userId: 'u1',
    senderDomain: 'orders.demo.hu',
    trackingNumber: 'TRACK-991188',
    purchases,
    shipments: [
      { purchaseId: 'p1', trackingNumber: 'TRACK-991188' },
      { purchaseId: 'p2', trackingNumber: 'TRACK-991188' },
    ],
  });
  assert.equal(result.decision, 'ambiguous');
});

test('returns conflict when order anchor and tracking anchor disagree', () => {
  const result = resolveGenericLifecycleLinkCandidate({
    userId: 'u1',
    senderDomain: 'orders.demo.hu',
    orderNumber: 'ORD-1001',
    trackingNumber: 'TRACK-2002',
    purchases,
    shipments: [{ purchaseId: 'p2', trackingNumber: 'TRACK-2002' }],
  });
  assert.equal(result.decision, 'conflict');
  assert.equal(result.purchaseId, null);
});

test('refuses domain plus time style fallback without a hard identity', () => {
  const result = resolveGenericLifecycleLinkCandidate({
    userId: 'u1',
    senderDomain: 'orders.demo.hu',
    purchases,
    shipments: [],
  });
  assert.deepEqual(result, {
    decision: 'unmatched',
    purchaseId: null,
    reason: 'hard_anchor_required',
  });
});
