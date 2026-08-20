import assert from 'node:assert/strict';
import test from 'node:test';
import { correlateLifecycleShadow, type CorrelationEvidence } from './lifecycle-correlation-shadow.js';

function row(overrides: Partial<CorrelationEvidence>): CorrelationEvidence {
  return {
    sourceEmailId: overrides.sourceEmailId ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'user-1',
    eventType: overrides.eventType ?? 'other',
    senderDomain: overrides.senderDomain ?? 'example.com',
    merchant: overrides.merchant ?? null,
    orderNumber: overrides.orderNumber ?? null,
    trackingNumber: overrides.trackingNumber ?? null,
    invoiceNumber: overrides.invoiceNumber ?? null,
    receivedAt: overrides.receivedAt ?? '2026-08-20T10:00:00.000Z',
  };
}

test('links cross-provider lifecycle events by exact order number', () => {
  const result = correlateLifecycleShadow([
    row({ sourceEmailId: 'order', eventType: 'order_created', senderDomain: 'shop.hu', merchant: 'Shop', orderNumber: '12345' }),
    row({ sourceEmailId: 'payment', eventType: 'payment_completed', senderDomain: 'barion.com', merchant: 'Shop', orderNumber: '12345' }),
    row({ sourceEmailId: 'invoice', eventType: 'invoice_or_receipt', senderDomain: 'billingo.hu', merchant: 'Shop', orderNumber: '12345', invoiceNumber: 'INV-1' }),
  ]);

  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0]?.sourceEmailIds.sort(), ['invoice', 'order', 'payment']);
  assert.equal(result.assignments.find((a) => a.sourceEmailId === 'payment')?.reason, 'exact_order_number');
  assert.equal(result.assignments.find((a) => a.sourceEmailId === 'invoice')?.reason, 'invoice_order_number');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
});

test('links carrier events by exact tracking after a safe order-number bridge', () => {
  const result = correlateLifecycleShadow([
    row({ sourceEmailId: 'order', eventType: 'order_created', senderDomain: 'shop.hu', merchant: 'Shop', orderNumber: '12345' }),
    row({ sourceEmailId: 'merchant-shipment', eventType: 'shipment', senderDomain: 'shop.hu', merchant: 'Shop', orderNumber: '12345', trackingNumber: 'GLS-9988' }),
    row({ sourceEmailId: 'carrier-delivery', eventType: 'delivery', senderDomain: 'gls-hungary.com', trackingNumber: 'GLS9988' }),
  ]);

  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0]?.sourceEmailIds.sort(), ['carrier-delivery', 'merchant-shipment', 'order']);
  assert.equal(result.assignments.find((a) => a.sourceEmailId === 'carrier-delivery')?.reason, 'exact_tracking_number');
});

test('canonicalizes cosmetic merchant domain suffixes without relaxing order identity', () => {
  const result = correlateLifecycleShadow([
    row({ sourceEmailId: 'a', eventType: 'order_created', merchant: 'gyerekjatekbolt.com', senderDomain: 'gyerekjatekbolt.com', orderNumber: '535574' }),
    row({ sourceEmailId: 'b', eventType: 'order_created', merchant: 'gyerekjatekbolt', senderDomain: 'gyerekjatekbolt.com', orderNumber: '535574' }),
  ]);

  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0]?.sourceEmailIds.sort(), ['a', 'b']);
});

test('canonicalizes known same-storefront aliases only when the exact order number matches', () => {
  const result = correlateLifecycleShadow([
    row({ sourceEmailId: 'forpro', eventType: 'order_created', merchant: 'Forproshop', senderDomain: 'sport8.hu', orderNumber: '21690' }),
    row({ sourceEmailId: 'sport8', eventType: 'order_created', merchant: 'Sport8', senderDomain: 'sport8.hu', orderNumber: '21690' }),
    row({ sourceEmailId: 'different-order', eventType: 'order_created', merchant: 'Sport8', senderDomain: 'sport8.hu', orderNumber: '21691' }),
  ]);

  assert.equal(result.groups.length, 2);
  assert.equal(result.assignments.find((a) => a.sourceEmailId === 'sport8')?.purchaseKey, result.assignments.find((a) => a.sourceEmailId === 'forpro')?.purchaseKey);
  assert.notEqual(result.assignments.find((a) => a.sourceEmailId === 'different-order')?.purchaseKey, result.assignments.find((a) => a.sourceEmailId === 'forpro')?.purchaseKey);
});

test('never auto-merges ambiguous order numbers', () => {
  const result = correlateLifecycleShadow([
    row({ sourceEmailId: 'a', eventType: 'order_created', senderDomain: 'shop-a.hu', merchant: 'A', orderNumber: '12345' }),
    row({ sourceEmailId: 'b', eventType: 'order_created', senderDomain: 'shop-b.hu', merchant: 'B', orderNumber: '12345' }),
    row({ sourceEmailId: 'payment', eventType: 'payment_completed', senderDomain: 'payment.example', orderNumber: '12345' }),
  ]);

  const payment = result.assignments.find((a) => a.sourceEmailId === 'payment');
  assert.equal(payment?.decision, 'review');
  assert.equal(payment?.reason, 'ambiguous_order_number');
});

test('lifecycle-only email without a safe anchor stays review', () => {
  const result = correlateLifecycleShadow([
    row({ sourceEmailId: 'carrier', eventType: 'shipment', senderDomain: 'gls-hungary.com', trackingNumber: 'TRACK-1' }),
  ]);

  assert.equal(result.groups.length, 0);
  assert.equal(result.assignments[0]?.decision, 'review');
  assert.equal(result.assignments[0]?.reason, 'no_safe_anchor');
});
