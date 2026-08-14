import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveExistingPurchase,
  type ExistingPurchaseEvidence,
  type ExistingPurchaseIdentity,
} from './existing-purchase-resolution.js';

function purchase(overrides: Partial<ExistingPurchaseIdentity> = {}): ExistingPurchaseIdentity {
  return {
    purchaseId: 'purchase-1',
    userId: 'user-1',
    merchantDomain: 'shop.example.com',
    merchantName: 'Example Shop',
    orderNumber: 'ORDER-123456',
    totalAmount: 9560,
    currency: 'HUF',
    orderedAt: '2026-08-06T10:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<ExistingPurchaseEvidence> = {}): ExistingPurchaseEvidence {
  return {
    sourceEmailId: 'email-1',
    userId: 'user-1',
    senderDomain: 'carrier.example.com',
    providerThreadId: null,
    eventType: 'shipment',
    merchant: null,
    orderNumber: 'ORDER-123456',
    trackingNumber: null,
    total: null,
    currency: null,
    confidence: 0.9,
    receivedAt: '2026-08-08T10:00:00.000Z',
    ...overrides,
  };
}

test('long exact order number safely links across sender domains', () => {
  const result = resolveExistingPurchase(evidence(), [purchase()]);
  assert.equal(result.decision, 'linkable');
  assert.equal(result.purchaseId, 'purchase-1');
  assert.ok(result.reasons.includes('exact_order_number_match'));
});

test('short FNP-style order number needs secondary evidence and can then link', () => {
  const result = resolveExistingPurchase(
    evidence({
      senderDomain: 'gmail.com',
      merchant: 'FNP Products',
      orderNumber: '46789',
      total: 9560,
      currency: 'HUF',
      confidence: 0.86,
    }),
    [purchase({
      merchantDomain: 'fnp.hu',
      merchantName: 'FNP Products',
      orderNumber: '46789',
    })],
  );
  assert.equal(result.decision, 'linkable');
  assert.ok(result.score >= 110);
  assert.ok(result.reasons.includes('amount_currency_match'));
});

test('tracking number linked to an existing shipment is a strong anchor', () => {
  const result = resolveExistingPurchase(
    evidence({ orderNumber: null, trackingNumber: 'GLS-123-456' }),
    [purchase()],
    [{ purchaseId: 'purchase-1', userId: 'user-1', trackingNumber: 'GLS123456' }],
  );
  assert.equal(result.decision, 'linkable');
  assert.ok(result.reasons.includes('exact_tracking_match'));
});

test('already linked email thread is a strong anchor', () => {
  const result = resolveExistingPurchase(
    evidence({ orderNumber: null, providerThreadId: 'thread-1' }),
    [purchase()],
    [],
    [{ purchaseId: 'purchase-1', userId: 'user-1', providerThreadId: 'thread-1' }],
  );
  assert.equal(result.decision, 'linkable');
  assert.ok(result.reasons.includes('linked_email_thread_match'));
});

test('two close strong candidates stay in review instead of auto-linking', () => {
  const purchases = [
    purchase({ purchaseId: 'purchase-1', merchantName: 'Same Shop' }),
    purchase({ purchaseId: 'purchase-2', merchantName: 'Same Shop' }),
  ];
  const result = resolveExistingPurchase(
    evidence({ merchant: 'Same Shop' }),
    purchases,
  );
  assert.equal(result.decision, 'review');
  assert.ok(result.reasons.includes('top_candidates_too_close'));
});

test('low extraction confidence requires review even with strong identity', () => {
  const result = resolveExistingPurchase(
    evidence({ confidence: 0.79 }),
    [purchase()],
  );
  assert.equal(result.decision, 'review');
  assert.ok(result.reasons.includes('source_confidence_below_auto_link_threshold'));
});

test('weak domain and timing signals alone never auto-link', () => {
  const result = resolveExistingPurchase(
    evidence({
      senderDomain: 'shop.example.com',
      orderNumber: null,
      merchant: null,
      receivedAt: '2026-08-06T12:00:00.000Z',
    }),
    [purchase()],
  );
  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
});

test('purchase matching is isolated per user', () => {
  const result = resolveExistingPurchase(
    evidence({ userId: 'user-2' }),
    [purchase({ userId: 'user-1' })],
  );
  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
});
