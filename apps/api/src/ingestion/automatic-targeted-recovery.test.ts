import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAutomaticTargetedRecoveryPlan } from './automatic-targeted-recovery.js';

function source(overrides: Record<string, unknown> = {}) {
  return {
    from_address: 'orders@example-shop.hu',
    received_at: '2026-08-12T10:00:00.000Z',
    processing_status: 'unlinked',
    validation_status: 'validated',
    validated_result: {
      event_type: 'shipment',
      order_number: 'ORDER-123',
      confidence: 0.92,
      validation_status: 'validated',
    },
    ...overrides,
  };
}

test('plans a targeted recovery for trusted merchant lifecycle evidence', () => {
  const plan = buildAutomaticTargetedRecoveryPlan(source());
  assert.ok(plan);
  assert.equal(plan.searchTerm, 'ORDER-123');
  assert.equal(plan.windowDays, 30);
  assert.equal(plan.dedupeKey.length, 64);
});

test('does not plan recovery for known carrier senders', () => {
  const plan = buildAutomaticTargetedRecoveryPlan(source({
    from_address: 'notice@expressone.hu',
  }));
  assert.equal(plan, null);
});

test('does not plan recovery for weak or untrusted evidence', () => {
  const weak = buildAutomaticTargetedRecoveryPlan(source({
    validated_result: {
      event_type: 'shipment',
      order_number: 'ORDER-123',
      confidence: 0.7,
      validation_status: 'validated',
    },
  }));
  assert.equal(weak, null);

  const review = buildAutomaticTargetedRecoveryPlan(source({
    validation_status: 'review',
    validated_result: {
      event_type: 'shipment',
      order_number: 'ORDER-123',
      confidence: 0.95,
      validation_status: 'review',
    },
  }));
  assert.equal(review, null);
});

test('does not recursively recover order-created evidence', () => {
  const plan = buildAutomaticTargetedRecoveryPlan(source({
    validated_result: {
      event_type: 'order_created',
      order_number: 'ORDER-123',
      confidence: 0.95,
      validation_status: 'validated',
    },
  }));
  assert.equal(plan, null);
});

test('dedupe key is stable within the same merchant order and month', () => {
  const first = buildAutomaticTargetedRecoveryPlan(source());
  const second = buildAutomaticTargetedRecoveryPlan(source({
    received_at: '2026-08-28T20:00:00.000Z',
  }));
  const nextMonth = buildAutomaticTargetedRecoveryPlan(source({
    received_at: '2026-09-01T00:00:00.000Z',
  }));

  assert.ok(first && second && nextMonth);
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.notEqual(first.dedupeKey, nextMonth.dedupeKey);
});
