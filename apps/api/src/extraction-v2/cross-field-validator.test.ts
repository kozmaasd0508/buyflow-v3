import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResolvedCommerceEvent } from './cross-field-validator.js';
import type { EvidenceField, EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from './types.js';

function missing<T>(): ResolvedField<T> {
  return { value: null, confidence: null, status: 'missing', provenance: [] };
}

function resolved<T>(value: T): ResolvedField<T> {
  return { value, confidence: 0.99, status: 'resolved', provenance: [] };
}

function event(overrides: Partial<ResolvedCommerceEvent> = {}): ResolvedCommerceEvent {
  return {
    eventType: missing<string>(),
    merchant: missing<string>(),
    orderNumber: missing<string>(),
    total: missing<number>(),
    currency: missing<string>(),
    carrier: missing<string>(),
    trackingNumber: missing<string>(),
    paymentStatus: missing<string>(),
    invoiceNumber: missing<string>(),
    paymentReference: missing<string>(),
    products: missing<EvidenceProduct[]>(),
    reviewRequired: false,
    conflictFields: [] as EvidenceField[],
    ...overrides,
  };
}

test('payment_completed with COD is REVIEW', () => {
  const validation = validateResolvedCommerceEvent(event({
    eventType: resolved('payment_completed'),
    paymentStatus: resolved('cash_on_delivery'),
    total: resolved(14990),
    currency: resolved('HUF'),
  }));
  assert.equal(validation.reviewRequired, true);
  assert.ok(validation.issues.some((issue) => issue.code === 'payment_completed_status_contradiction'));
});

test('refund with paid status is REVIEW', () => {
  const validation = validateResolvedCommerceEvent(event({
    eventType: resolved('refund'),
    paymentStatus: resolved('paid'),
    total: resolved(4990),
    currency: resolved('HUF'),
  }));
  assert.equal(validation.reviewRequired, true);
  assert.ok(validation.issues.some((issue) => issue.code === 'refund_status_contradiction'));
});

test('missing currency beside a resolved total is warning only', () => {
  const validation = validateResolvedCommerceEvent(event({ total: resolved(12990) }));
  assert.equal(validation.reviewRequired, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'money_pair_incomplete' && issue.severity === 'warning'));
});

test('shipment without tracking is warning only', () => {
  const validation = validateResolvedCommerceEvent(event({ eventType: resolved('shipment') }));
  assert.equal(validation.reviewRequired, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'lifecycle_tracking_missing'));
});

test('product currency mismatch is warning, not an invented hard conflict', () => {
  const validation = validateResolvedCommerceEvent(event({
    currency: resolved('HUF'),
    products: resolved([{
      name: 'Example Product',
      quantity: 1,
      unitPrice: 10,
      totalPrice: 10,
      currency: 'EUR',
    }]),
  }));
  assert.equal(validation.reviewRequired, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'product_currency_mismatch'));
});
