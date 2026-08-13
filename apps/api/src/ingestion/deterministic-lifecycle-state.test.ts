import assert from 'node:assert/strict';
import test from 'node:test';
import { decideLifecyclePurchasePatch } from './deterministic-lifecycle-state.js';

const base = {
  sourceReceivedAt: '2026-08-10T10:00:00.000Z',
  currentState: 'processing',
  currentPaymentStatus: null,
  currentCancelledAt: null,
  hasShipment: false,
  latestShipmentStatus: null,
  latestShipmentEventAt: null,
};

test('failed payment sets failed payment and current state', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'payment_failed' }), {
    payment_status: 'failed',
    current_state: 'payment_failed',
  });
});

test('successful later payment recovers a failed current state', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'payment_failed',
    currentState: 'payment_failed',
    currentPaymentStatus: 'paid',
  }), { current_state: 'paid' });
});

test('cancellation is not auto-applied after shipment exists', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'cancelled',
    hasShipment: true,
  }), {});
});

test('delay is recovered by a newer shipment event', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'delayed',
    currentState: 'delayed',
    hasShipment: true,
    latestShipmentStatus: 'in_transit',
    latestShipmentEventAt: '2026-08-11T10:00:00.000Z',
  }), { current_state: 'in_transit' });
});

test('order packing moves a non-terminal order only to processing', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'order_packing',
    currentState: 'paid',
  }), { current_state: 'processing' });

  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'order_processing',
    currentState: 'unknown',
  }), { current_state: 'processing' });

  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'ready_to_ship',
    currentState: 'processing',
  }), {});
});

test('order progress never overwrites payment failure or physical/terminal progress', () => {
  for (const currentState of ['payment_failed', 'shipped', 'in_transit', 'delivered', 'cancelled', 'refunded', 'returned']) {
    assert.deepEqual(decideLifecyclePurchasePatch({
      ...base,
      lifecycleEvent: 'order_packing',
      currentState,
      currentPaymentStatus: currentState === 'payment_failed' ? 'failed' : null,
      hasShipment: currentState === 'shipped' || currentState === 'in_transit' || currentState === 'delivered',
    }), {}, currentState);
  }

  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'order_packing',
    currentState: 'processing',
    currentPaymentStatus: 'failed',
  }), {});
});

test('newer shipment evidence wins over older order packing', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'order_packing',
    currentState: 'processing',
    hasShipment: true,
    latestShipmentStatus: 'in_transit',
    latestShipmentEventAt: '2026-08-11T10:00:00.000Z',
  }), { current_state: 'in_transit' });
});
