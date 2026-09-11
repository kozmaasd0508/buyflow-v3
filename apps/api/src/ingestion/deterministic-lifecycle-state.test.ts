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
  for (const currentState of ['payment_failed', 'shipped', 'in_transit', 'delivered', 'cancelled', 'refunded', 'returned']) {
    assert.deepEqual(decideLifecyclePurchasePatch({
      ...base,
      lifecycleEvent: 'order_packing',
      currentState,
      currentPaymentStatus: currentState === 'payment_failed' ? 'failed' : null,
      hasShipment: ['shipped', 'in_transit', 'delivered'].includes(currentState),
    }), {}, currentState);
  }
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'order_packing', currentState: 'processing', currentPaymentStatus: 'failed' }), {});
});

test('newer shipment evidence wins over older order packing', () => {
  assert.deepEqual(decideLifecyclePurchasePatch({ ...base, lifecycleEvent: 'order_packing', currentState: 'processing', hasShipment: true, latestShipmentStatus: 'in_transit', latestShipmentEventAt: '2026-08-11T10:00:00.000Z' }), { current_state: 'in_transit' });
});

// Exercise the production evidence loader, including pages beyond the former cap.
test('lifecycle loading reaches newer evidence beyond 200 rows and orders timestamp ties by id', async () => {
  const { loadLifecycleSources } = await import('./deterministic-lifecycle-state.js');
  const rows = Array.from({ length: 405 }, (_, index) => ({ id: String(index).padStart(4, '0'), received_at: '2026-09-11T10:00:00Z' }));
  const ranges: number[][] = [];
  const orders: string[] = [];
  const db = { from() {
    const query: any = {
      select() { return query; }, eq() { return query; }, in() { return query; },
      order(column: string) { orders.push(column); return query; },
      async range(start: number, end: number) { ranges.push([start, end]); return { data: rows.slice(start, end + 1), error: null }; },
    };
    return query;
  } };
  const loaded = await loadLifecycleSources(db, 'user-1');
  assert.deepEqual(loaded, rows);
  assert.deepEqual(ranges, [[0, 199], [200, 399], [400, 599]]);
  assert.deepEqual(orders, ['received_at', 'id', 'received_at', 'id', 'received_at', 'id']);
});

test('lifecycle loading propagates a later page failure instead of reporting partial success', async () => {
  const { loadLifecycleSources } = await import('./deterministic-lifecycle-state.js');
  const db = { from() {
    const query: any = {
      select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; },
      async range(start: number) { return start === 0
        ? { data: Array.from({ length: 200 }, (_, id) => ({ id })), error: null }
        : { data: null, error: { message: 'synthetic page failure' } }; },
    };
    return query;
  } };
  await assert.rejects(loadLifecycleSources(db, 'user-1'), /synthetic page failure/);
});
