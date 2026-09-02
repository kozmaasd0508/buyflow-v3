import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePurchasePulse } from './purchase-pulse.js';

const base = {
  currentState: 'ordered',
  orderedAt: '2026-09-01T10:00:00Z',
  paidAt: null,
  shippedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  createdAt: '2026-09-01T09:59:00Z',
  shipments: [],
};

test('review wins over optimistic payment, shipping and delivery timestamps', () => {
  const pulse = derivePurchasePulse({
    ...base,
    currentState: 'review',
    paidAt: '2026-09-01T10:01:00Z',
    shippedAt: '2026-09-01T11:00:00Z',
    deliveredAt: '2026-09-02T12:00:00Z',
    shipments: [{ status: 'delivered', deliveredAt: '2026-09-02T12:00:00Z' }],
  });
  assert.equal(pulse.status, 'review');
  assert.equal(pulse.reviewRequired, true);
  assert.equal(pulse.delivered, false);
  assert.equal(pulse.movement, false);
});

test('pending wins over physical shipment hints', () => {
  const pulse = derivePurchasePulse({
    ...base,
    currentState: 'pending',
    shipments: [{ status: 'out_for_delivery', lastEventAt: '2026-09-02T08:00:00Z' }],
  });
  assert.equal(pulse.status, 'pending');
  assert.equal(pulse.reviewRequired, true);
  assert.equal(pulse.movement, false);
});

test('deliveredAt alone never presents whole purchase as delivered', () => {
  const pulse = derivePurchasePulse({
    ...base,
    currentState: 'processing',
    deliveredAt: '2026-09-02T12:00:00Z',
  });
  assert.equal(pulse.status, 'processing');
  assert.equal(pulse.delivered, false);
});

test('whole purchase delivered state fails closed when any linked parcel is not delivered', () => {
  const pulse = derivePurchasePulse({
    ...base,
    currentState: 'delivered',
    deliveredAt: '2026-09-02T12:00:00Z',
    shipments: [
      { status: 'delivered', deliveredAt: '2026-09-02T11:00:00Z' },
      { status: 'in_transit', lastEventAt: '2026-09-02T12:00:00Z' },
    ],
  });
  assert.equal(pulse.status, 'review');
  assert.equal(pulse.reviewRequired, true);
  assert.equal(pulse.delivered, false);
});

test('whole purchase is delivered only when aggregate state and linked parcels agree', () => {
  const pulse = derivePurchasePulse({
    ...base,
    currentState: 'delivered',
    deliveredAt: '2026-09-02T12:00:00Z',
    shipments: [
      { status: 'delivered', deliveredAt: '2026-09-02T11:00:00Z' },
      { status: 'delivered', deliveredAt: '2026-09-02T13:00:00Z' },
    ],
  });
  assert.equal(pulse.status, 'delivered');
  assert.equal(pulse.delivered, true);
  assert.equal(pulse.lastConfirmedAt, '2026-09-02T13:00:00Z');
});

test('all child parcels delivered without aggregate delivery remains fail closed', () => {
  const pulse = derivePurchasePulse({
    ...base,
    currentState: 'in_transit',
    shipments: [
      { status: 'delivered', deliveredAt: '2026-09-02T11:00:00Z' },
      { status: 'delivered', deliveredAt: '2026-09-02T13:00:00Z' },
    ],
  });
  assert.equal(pulse.status, 'review');
  assert.equal(pulse.delivered, false);
  assert.equal(pulse.reviewRequired, true);
});

test('ready for pickup and out for delivery are explicit physical progress states', () => {
  const pickup = derivePurchasePulse({
    ...base,
    currentState: 'in_transit',
    shipments: [{ status: 'ready_for_pickup', lastEventAt: '2026-09-02T10:00:00Z' }],
  });
  assert.equal(pickup.status, 'ready_for_pickup');
  assert.equal(pickup.label, 'Átvehető');
  assert.equal(pickup.movement, true);

  const delivery = derivePurchasePulse({
    ...base,
    currentState: 'in_transit',
    shipments: [{ status: 'out_for_delivery', lastEventAt: '2026-09-02T11:00:00Z' }],
  });
  assert.equal(delivery.status, 'out_for_delivery');
  assert.equal(delivery.label, 'Kézbesítés alatt');
  assert.equal(delivery.movement, true);
});

test('ordered and processing are not counted as packages in movement', () => {
  assert.equal(derivePurchasePulse(base).movement, false);
  assert.equal(derivePurchasePulse({ ...base, currentState: 'processing' }).movement, false);
});

test('payment timestamp cannot promote a purchase whose aggregate state is only ordered', () => {
  const pulse = derivePurchasePulse({ ...base, paidAt: '2026-09-01T10:02:00Z' });
  assert.equal(pulse.status, 'ordered');
  assert.notEqual(pulse.title, 'Fizetés rendben');
});

test('unknown states fail closed instead of inventing a next step', () => {
  const pulse = derivePurchasePulse({ ...base, currentState: 'mystery_state' });
  assert.equal(pulse.reviewRequired, true);
  assert.equal(pulse.tone, 'warning');
});

test('Pulse output contains no email, source or Purchase identity authority fields', () => {
  const pulse = derivePurchasePulse(base) as Record<string, unknown>;
  for (const forbidden of ['sourceEmailId', 'providerMessageId', 'orderNumber', 'purchaseId', 'merchantDomain', 'rawRef']) {
    assert.equal(Object.hasOwn(pulse, forbidden), false);
  }
});
