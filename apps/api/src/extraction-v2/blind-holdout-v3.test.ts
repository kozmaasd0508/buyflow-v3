import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBlindHoldoutV3, type BlindHoldoutV3Fields, type BlindHoldoutV3TruthCase } from './blind-holdout-v3.js';
import type { ResolvedCommerceEvent, ResolvedField } from './types.js';

const K = <T>(value: T) => ({ state: 'known', value } as const);
const NA = { state: 'not_applicable' } as const;
const U = { state: 'unknown' } as const;

function field<T>(value: T | null, status: ResolvedField<T>['status'] = value === null ? 'missing' : 'resolved'): ResolvedField<T> {
  return { value, confidence: value === null ? null : 0.99, status, provenance: [] };
}

function resolved(overrides: Partial<ResolvedCommerceEvent> = {}): ResolvedCommerceEvent {
  return {
    eventType: field<string>(null), merchant: field<string>(null), orderNumber: field<string>(null), total: field<number>(null),
    currency: field<string>(null), carrier: field<string>(null), trackingNumber: field<string>(null), paymentStatus: field<string>(null),
    invoiceNumber: field<string>(null), paymentReference: field<string>(null), products: field<any[]>(null), reviewRequired: false, conflictFields: [],
    ...overrides,
  };
}

function truthFields(overrides: Partial<BlindHoldoutV3Fields> = {}): BlindHoldoutV3Fields {
  return {
    eventType: U, merchant: U, orderNumber: U, total: U, currency: U, carrier: U, trackingNumber: U,
    paymentStatus: U, invoiceNumber: U, paymentReference: U, products: U, ...overrides,
  };
}

test('scores detection and exact field matches', () => {
  const truth: BlindHoldoutV3TruthCase[] = [{
    caseId: 'commerce-1', isCommerceEvent: true,
    fields: truthFields({ eventType: K('shipment'), trackingNumber: K('ABC123'), total: NA }),
  }, {
    caseId: 'noise-1', isCommerceEvent: false,
    fields: truthFields({ eventType: NA, trackingNumber: NA }),
  }];
  const report = evaluateBlindHoldoutV3({ truth, predictions: [
    { caseId: 'commerce-1', resolved: resolved({ eventType: field('shipment'), trackingNumber: field('abc123') }) },
    { caseId: 'noise-1', resolved: resolved() },
  ] });
  assert.deepEqual(report.detection, { tp: 1, fp: 0, fn: 0, tn: 1, precision: 1, recall: 1 });
  assert.equal(report.fields.trackingNumber.exactMatchRate, 1);
  assert.equal(report.criticalMismatchCount, 0);
});

test('mismatch counts as both field false positive and false negative', () => {
  const report = evaluateBlindHoldoutV3({
    truth: [{ caseId: 'x', isCommerceEvent: true, fields: truthFields({ eventType: K('refund'), total: K(25.4) }) }],
    predictions: [{ caseId: 'x', resolved: resolved({ eventType: field('refund'), total: field(20) }) }],
  });
  assert.equal(report.fields.total.mismatches, 1);
  assert.equal(report.fields.total.falsePositives, 1);
  assert.equal(report.fields.total.falseNegatives, 1);
  assert.equal(report.criticalMismatchCount, 1);
});

test('not_applicable prediction is a field false positive and unknown is excluded', () => {
  const report = evaluateBlindHoldoutV3({
    truth: [{ caseId: 'noise', isCommerceEvent: false, fields: truthFields({ eventType: NA, merchant: NA, total: U }) }],
    predictions: [{ caseId: 'noise', resolved: resolved({ merchant: field('Marketing Sender'), total: field(70000) }) }],
  });
  assert.equal(report.fields.merchant.falsePositives, 1);
  assert.equal(report.fields.total.unknown, 1);
  assert.equal(report.fields.total.falsePositives, 0);
});

test('conflict on a known critical field is a false negative and critical mismatch', () => {
  const report = evaluateBlindHoldoutV3({
    truth: [{ caseId: 'multi', isCommerceEvent: true, fields: truthFields({ eventType: K('payment_completed'), invoiceNumber: K('INV-1') }) }],
    predictions: [{ caseId: 'multi', resolved: resolved({ eventType: field('payment_completed'), invoiceNumber: field<string>(null, 'conflict'), reviewRequired: true, conflictFields: ['invoice_number'] }) }],
  });
  assert.equal(report.fields.invoiceNumber.conflicts, 1);
  assert.equal(report.fields.invoiceNumber.falseNegatives, 1);
  assert.equal(report.reviewRequiredCount, 1);
  assert.equal(report.criticalMismatchCount, 1);
});

test('duplicate or missing case ids are rejected', () => {
  const t = { caseId: 'a', isCommerceEvent: false, fields: truthFields() };
  assert.throws(() => evaluateBlindHoldoutV3({ truth: [t, t], predictions: [] }), /duplicate_truth/);
  assert.throws(() => evaluateBlindHoldoutV3({ truth: [t], predictions: [] }), /missing_prediction/);
});
