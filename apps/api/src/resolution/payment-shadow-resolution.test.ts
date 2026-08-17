import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePaymentShadow,
  type PaymentShadowEvidence,
  type PaymentShadowPurchaseIdentity,
} from './payment-shadow-resolution.js';

function evidence(overrides: Partial<PaymentShadowEvidence> = {}): PaymentShadowEvidence {
  return {
    sourceEmailId: 'source-payment-1',
    userId: 'user-1',
    provider: 'simplepay',
    paymentReference: 'PAYMENT-PROVIDER-ONLY-999',
    merchantDomainHint: 'www.pcx.hu',
    merchantNameHint: 'PCX',
    merchantReference: null,
    amount: 5798,
    currency: 'HUF',
    receivedAt: '2026-01-31T14:21:53Z',
    confidence: 1,
    context: 'unknown',
    ...overrides,
  };
}

function purchase(overrides: Partial<PaymentShadowPurchaseIdentity> = {}): PaymentShadowPurchaseIdentity {
  return {
    purchaseId: 'purchase-1',
    userId: 'user-1',
    merchantDomain: 'pcx.hu',
    merchantName: 'PCX',
    orderNumber: '12345678',
    totalAmount: 5798,
    currency: 'HUF',
    orderedAt: '2026-01-31T13:50:00Z',
    ...overrides,
  };
}

test('exact merchant domain plus exact amount/currency and close time is shadow-linkable only', () => {
  const result = resolvePaymentShadow(evidence(), [purchase()]);

  assert.equal(result.decision, 'shadow_linkable');
  assert.equal(result.purchaseId, 'purchase-1');
  assert.equal(result.wouldWrite, false);
  assert.ok(result.reasons.includes('exact_merchant_domain_match'));
  assert.ok(result.reasons.includes('exact_amount_currency_match'));
  assert.ok(result.reasons.includes('within_2_days'));
  assert.ok(result.reasons.includes('shadow_only_no_write_authority'));
});

test('amount and timing alone never link a payment to a purchase', () => {
  const result = resolvePaymentShadow(
    evidence({ merchantDomainHint: null, merchantNameHint: null }),
    [purchase()],
  );

  assert.notEqual(result.decision, 'shadow_linkable');
  assert.equal(result.wouldWrite, false);
});

test('merchant identity without exact amount and currency cannot become shadow-linkable', () => {
  const result = resolvePaymentShadow(
    evidence({ amount: 6000 }),
    [purchase()],
  );

  assert.equal(result.decision, 'review');
  assert.equal(result.purchaseId, 'purchase-1');
  assert.equal(result.wouldWrite, false);
});

test('currency mismatch blocks strict payment linking', () => {
  const result = resolvePaymentShadow(
    evidence({ currency: 'EUR' }),
    [purchase()],
  );

  assert.equal(result.decision, 'review');
  assert.equal(result.wouldWrite, false);
  assert.ok(!result.reasons.includes('exact_amount_currency_match'));
});

test('payment far outside the purchase window cannot become shadow-linkable', () => {
  const result = resolvePaymentShadow(
    evidence({ receivedAt: '2026-03-01T12:00:00Z' }),
    [purchase()],
  );

  assert.equal(result.decision, 'review');
  assert.equal(result.wouldWrite, false);
  assert.ok(!result.reasons.includes('within_2_days'));
});

test('two equally strict purchase candidates stay in review instead of guessing', () => {
  const result = resolvePaymentShadow(evidence(), [
    purchase({ purchaseId: 'purchase-a' }),
    purchase({ purchaseId: 'purchase-b', orderedAt: '2026-01-31T14:00:00Z' }),
  ]);

  assert.equal(result.decision, 'review');
  assert.ok(result.reasons.includes('multiple_strict_payment_purchase_candidates'));
  assert.equal(result.wouldWrite, false);
});

test('provider payment reference never establishes purchase identity', () => {
  const result = resolvePaymentShadow(
    evidence({
      merchantDomainHint: null,
      merchantNameHint: null,
      amount: null,
      currency: null,
      paymentReference: '12345678',
    }),
    [purchase({ orderNumber: '12345678' })],
  );

  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
  assert.equal(result.score, 0);
  assert.equal(result.wouldWrite, false);
});

test('merchant-owned reference is corroborating only and cannot replace merchant plus financial evidence', () => {
  const result = resolvePaymentShadow(
    evidence({
      merchantDomainHint: null,
      merchantNameHint: null,
      merchantReference: '12345678',
      amount: null,
      currency: null,
    }),
    [purchase({ orderNumber: '12345678' })],
  );

  assert.equal(result.decision, 'unmatched');
  assert.equal(result.wouldWrite, false);
  assert.ok(result.reasons.includes('merchant_reference_matches_existing_order'));
});

test('explicit recurring or subscription payment context is never linked to a purchase', () => {
  const result = resolvePaymentShadow(
    evidence({ context: 'recurring_or_subscription' }),
    [purchase()],
  );

  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
  assert.deepEqual(result.reasons, ['explicit_non_purchase_payment_context']);
  assert.equal(result.wouldWrite, false);
});

test('explicit service or billing payment context is never linked to a purchase', () => {
  const result = resolvePaymentShadow(
    evidence({ context: 'service_or_billing' }),
    [purchase()],
  );

  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
  assert.equal(result.wouldWrite, false);
});

test('payment resolution is isolated by user', () => {
  const result = resolvePaymentShadow(evidence(), [
    purchase({ userId: 'user-2' }),
  ]);

  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
  assert.equal(result.wouldWrite, false);
});

test('low-confidence payment evidence stays review even when all strict anchors agree', () => {
  const result = resolvePaymentShadow(
    evidence({ confidence: 0.9 }),
    [purchase()],
  );

  assert.equal(result.decision, 'review');
  assert.ok(result.reasons.includes('payment_evidence_confidence_below_shadow_link_threshold'));
  assert.equal(result.wouldWrite, false);
});

test('HUF normalization accepts Ft as the same currency but keeps one-forint tolerance only', () => {
  const accepted = resolvePaymentShadow(
    evidence({ currency: 'Ft', amount: 5799 }),
    [purchase()],
  );
  const rejected = resolvePaymentShadow(
    evidence({ currency: 'Ft', amount: 5800 }),
    [purchase()],
  );

  assert.equal(accepted.decision, 'shadow_linkable');
  assert.notEqual(rejected.decision, 'shadow_linkable');
});
