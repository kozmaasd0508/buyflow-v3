import assert from 'node:assert/strict';
import test from 'node:test';
import {
  monotonicControlledShipmentStatus,
  purchaseStateMatchesShipmentSummary,
} from './journeygraph-controlled-verification.js';

test('controlled shipment replay never downgrades delivered or ready-for-pickup', () => {
  assert.equal(monotonicControlledShipmentStatus('delivered', 'in_transit'), 'delivered');
  assert.equal(monotonicControlledShipmentStatus('ready_for_pickup', 'in_transit'), 'ready_for_pickup');
  assert.equal(monotonicControlledShipmentStatus('in_transit', 'delivered'), 'delivered');
});

test('controlled Purchase verification follows the aggregate of all linked Shipments', () => {
  assert.equal(purchaseStateMatchesShipmentSummary('in_transit', {
    status: 'in_transit',
    latestEventAt: '2026-09-02T10:00:00.000Z',
    allDelivered: false,
    completedAt: null,
  }), true);
  assert.equal(purchaseStateMatchesShipmentSummary('delivered', {
    status: 'in_transit',
    latestEventAt: '2026-09-02T10:00:00.000Z',
    allDelivered: false,
    completedAt: null,
  }), false);
});

test('unknown outstanding Shipment state can never validate false whole-Purchase completion', () => {
  const summary = { status: null, latestEventAt: null, allDelivered: false, completedAt: null } as const;
  assert.equal(purchaseStateMatchesShipmentSummary('processing', summary), true);
  assert.equal(purchaseStateMatchesShipmentSummary('in_transit', summary), true);
  assert.equal(purchaseStateMatchesShipmentSummary('ready_for_pickup', summary), false);
  assert.equal(purchaseStateMatchesShipmentSummary('delivered', summary), false);
});
