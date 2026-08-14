import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrackingBridgeCandidates } from './tracking-bridge-resolution.js';

const userId = 'user-1';

test('exact merchant tracking safely survives a multi-day carrier delay', () => {
  const tracking = '605855685055000013605231';
  const [candidate] = resolveTrackingBridgeCandidates(
    [{
      purchaseId: 'purchase-3010206178',
      userId,
      expectedCarrier: 'Express One',
      merchantName: 'GymBeam Germany GmbH',
      merchantLegalName: 'GymBeam Germany GmbH',
    }],
    [],
    [{
      sourceEmailId: 'merchant-shipment-5055',
      purchaseId: 'purchase-3010206178',
      userId,
      eventType: 'shipment',
      carrier: 'Express One',
      trackingNumber: tracking,
      confidence: 0.78,
      receivedAt: '2026-07-12T16:52:23.000Z',
    }],
    [
      {
        sourceEmailId: 'carrier-shipment-5055',
        userId,
        eventType: 'shipment',
        trackingNumber: tracking,
        carrier: 'Express One',
        consignor: null,
        confidence: 0.90,
        receivedAt: '2026-07-16T08:25:00.000Z',
      },
      {
        sourceEmailId: 'carrier-delivery-5055',
        userId,
        eventType: 'delivery',
        trackingNumber: tracking,
        carrier: 'Express One',
        consignor: null,
        confidence: 0.88,
        receivedAt: '2026-07-16T14:55:20.000Z',
      },
    ],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.equal(candidate.purchaseId, 'purchase-3010206178');
  assert.ok(candidate.reasons.includes('merchant_shipment_exact_tracking_match'));
  assert.ok(candidate.reasons.includes('exact_tracking_extended_bridge_window'));
});

test('untracked merchant anchors still cannot bridge beyond 36 hours', () => {
  const tracking = '605855685055000013605231';
  const [candidate] = resolveTrackingBridgeCandidates(
    [{
      purchaseId: 'purchase-1',
      userId,
      expectedCarrier: 'Express One',
      merchantName: 'GymBeam',
      merchantLegalName: null,
    }],
    [],
    [{
      sourceEmailId: 'merchant-shipment-untracked',
      purchaseId: 'purchase-1',
      userId,
      eventType: 'shipment',
      carrier: 'Express One',
      trackingNumber: null,
      confidence: 0.90,
      receivedAt: '2026-07-12T16:52:23.000Z',
    }],
    [{
      sourceEmailId: 'carrier-shipment-late',
      userId,
      eventType: 'shipment',
      trackingNumber: tracking,
      carrier: 'Express One',
      consignor: null,
      confidence: 0.90,
      receivedAt: '2026-07-16T08:25:00.000Z',
    }],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('extended window never permits a different tracked merchant identity', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [{
      purchaseId: 'purchase-1',
      userId,
      expectedCarrier: 'Express One',
      merchantName: 'GymBeam',
      merchantLegalName: null,
    }],
    [],
    [{
      sourceEmailId: 'merchant-shipment-other',
      purchaseId: 'purchase-1',
      userId,
      eventType: 'shipment',
      carrier: 'Express One',
      trackingNumber: '605855685836000013605231',
      confidence: 0.90,
      receivedAt: '2026-07-12T16:52:23.000Z',
    }],
    [{
      sourceEmailId: 'carrier-shipment-5055',
      userId,
      eventType: 'shipment',
      trackingNumber: '605855685055000013605231',
      carrier: 'Express One',
      consignor: null,
      confidence: 0.90,
      receivedAt: '2026-07-16T08:25:00.000Z',
    }],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});
