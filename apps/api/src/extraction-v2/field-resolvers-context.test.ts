import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCommerceEvent } from './field-resolvers.js';
import type { EvidenceBundle, EvidenceClaim } from './types.js';

function claim<T>(input: {
  field: EvidenceClaim<T>['field'];
  value: T;
  confidence?: number;
  source?: EvidenceClaim<T>['source'];
  qualifier?: string;
}): EvidenceClaim<T> {
  return {
    field: input.field,
    value: input.value,
    confidence: input.confidence ?? 0.99,
    source: input.source ?? 'body',
    extractorId: 'test-extractor',
    extractorVersion: 'test-v1',
    ...(input.qualifier ? { qualifiers: [input.qualifier] } : {}),
  };
}

function bundle(...claims: EvidenceClaim[]): EvidenceBundle {
  return { claims };
}

test('payment amount evidence does not become order total without a payment/refund event', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'total', value: 14705, confidence: 0.97, qualifier: 'explicit_payment_amount' }),
    claim({ field: 'currency', value: 'HUF', confidence: 0.97, qualifier: 'explicit_payment_amount' }),
  ));

  assert.equal(result.total.status, 'missing');
  assert.equal(result.currency.status, 'missing');
});

test('payment amount evidence becomes total/currency for a resolved payment_completed event', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'event_type', value: 'payment_completed', source: 'provider_adapter', confidence: 0.99 }),
    claim({ field: 'total', value: 14705, confidence: 0.97, qualifier: 'explicit_payment_amount' }),
    claim({ field: 'currency', value: 'HUF', confidence: 0.97, qualifier: 'explicit_payment_amount' }),
  ));

  assert.equal(result.eventType.value, 'payment_completed');
  assert.equal(result.total.value, 14705);
  assert.equal(result.currency.value, 'HUF');
});

test('payment amount evidence also becomes eligible for refund events', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'event_type', value: 'refund', source: 'provider_adapter', confidence: 0.99 }),
    claim({ field: 'total', value: 4990, confidence: 0.97, qualifier: 'explicit_payment_amount' }),
    claim({ field: 'currency', value: 'HUF', confidence: 0.97, qualifier: 'explicit_payment_amount' }),
  ));

  assert.equal(result.total.value, 4990);
  assert.equal(result.currency.value, 'HUF');
});
