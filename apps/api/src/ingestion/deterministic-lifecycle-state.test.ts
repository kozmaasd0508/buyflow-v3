import assert from 'node:assert/strict';
import test from 'node:test';
import { decideLifecyclePurchasePatch, summarizeShipmentProgress } from './deterministic-lifecycle-state.js';

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
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'payment_failed' }), { payment_status: 'failed', current_state: 'payment_failed' });
});

test('successful later payment recovers a failed current state', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'payment_failed', currentState: 'payment_failed', currentPaymentStatus: 'paid' }), { current_state: 'paid' });
});

test('cancellation is not auto-applied after shipment exists', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'cancelled', hasShipment: true }), {});
});

test('delay is recovered by a newer shipment event', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'delayed', currentState: 'delayed', hasShipment: true, latestShipmentStatus: 'in_transit', latestShipmentEventAt: '2026-08-11T10:00:00.000Z' }), { current_state: 'in_transit' });
});

test('order progress moves only to processing', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'order_packing', currentState: 'paid' }), { current_state: 'processing' });
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'order_processing', currentState: 'unknown' }), { current_state: 'processing' });
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'ready_to_ship', currentState: 'processing' }), {});
});

test('order progress never overwrites payment failure or physical and terminal progress', () => {
  for (const currentState of ['payment_failed', 'shipped', 'in_transit', 'ready_for_pickup', 'delivered', 'cancelled', 'refunded', 'returned']) {
    assert.deepEqual(decideLifecyclePurchasePatch({
      ...base,
      lifecycleEvent: 'order_packing',
      currentState,
      currentPaymentStatus: currentState === 'payment_failed' ? 'failed' : null,
      hasShipment: ['shipped', 'in_transit', 'ready_for_pickup', 'delivered'].includes(currentState),
    }), {}, currentState);
  }
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'order_packing', currentState: 'processing', currentPaymentStatus: 'failed' }), {});
});

test('delay never downgrades ready-for-pickup progress', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({
    ...base,
    lifecycleEvent: 'delayed',
    currentState: 'ready_for_pickup',
    hasShipment: true,
    latestShipmentStatus: 'ready_for_pickup',
    latestShipmentEventAt: '2026-08-11T10:00:00.000Z',
  }), {});
});

test('newer shipment evidence wins over older order packing', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'order_packing', currentState: 'processing', hasShipment: true, latestShipmentStatus: 'in_transit', latestShipmentEventAt: '2026-08-11T10:00:00.000Z' }), { current_state: 'in_transit' });
});

test('multi-shipment purchase is not delivered while another parcel is in transit', () => {
  assert.deepEqual(summarizeShipmentProgress([
    { status: 'delivered', delivered_at: '2026-08-11T09:00:00.000Z', last_event_at: '2026-08-11T09:00:00.000Z' },
    { status: 'in_transit', shipped_at: '2026-08-10T11:00:00.000Z', last_event_at: '2026-08-12T09:00:00.000Z' },
  ]), {
    status: 'in_transit',
    latestEventAt: '2026-08-12T09:00:00.000Z',
    allDelivered: false,
    completedAt: null,
  });
});

test('multi-shipment purchase stays ready for pickup while one parcel is still waiting', () => {
  assert.deepEqual(summarizeShipmentProgress([
    { status: 'delivered', delivered_at: '2026-08-11T09:00:00.000Z' },
    { status: 'ready_for_pickup', last_event_at: '2026-08-12T10:00:00.000Z' },
  ]), {
    status: 'ready_for_pickup',
    latestEventAt: '2026-08-12T10:00:00.000Z',
    allDelivered: false,
    completedAt: null,
  });
});

test('multi-shipment purchase becomes delivered only after every parcel is delivered', () => {
  assert.deepEqual(summarizeShipmentProgress([
    { status: 'delivered', delivered_at: '2026-08-11T09:00:00.000Z' },
    { status: 'delivered', delivered_at: '2026-08-13T14:30:00.000Z' },
  ]), {
    status: 'delivered',
    latestEventAt: '2026-08-13T14:30:00.000Z',
    allDelivered: true,
    completedAt: '2026-08-13T14:30:00.000Z',
  });
});

test('unknown shipment status never falsely completes the whole purchase', () => {
  assert.deepEqual(summarizeShipmentProgress([
    { status: 'delivered', delivered_at: '2026-08-11T09:00:00.000Z' },
    { status: null, last_event_at: '2026-08-12T09:00:00.000Z' },
  ]), {
    status: null,
    latestEventAt: '2026-08-12T09:00:00.000Z',
    allDelivered: false,
    completedAt: null,
  });
});
