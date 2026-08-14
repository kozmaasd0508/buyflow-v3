import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTrackingBridgeCandidates,
  type TrackingBridgeEvidence,
  type TrackingBridgeMerchantAnchor,
  type TrackingBridgePurchase,
} from './tracking-bridge-resolution.js';

const userId = 'user-1';

function purchase(overrides: Partial<TrackingBridgePurchase> = {}): TrackingBridgePurchase {
  return {
    purchaseId: 'purchase-1',
    userId,
    expectedCarrier: 'Express One',
    ...overrides,
  };
}

function anchor(overrides: Partial<TrackingBridgeMerchantAnchor> = {}): TrackingBridgeMerchantAnchor {
  return {
    sourceEmailId: 'merchant-shipment-1',
    purchaseId: 'purchase-1',
    userId,
    eventType: 'shipment',
    carrier: 'Express One',
    confidence: 0.86,
    receivedAt: '2026-08-10T11:17:35.000Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<TrackingBridgeEvidence> = {}): TrackingBridgeEvidence {
  return {
    sourceEmailId: 'carrier-1',
    userId,
    eventType: 'shipment',
    trackingNumber: '650925031807000013605231',
    carrier: 'Express One',
    confidence: 0.86,
    receivedAt: '2026-08-10T21:04:10.000Z',
    ...overrides,
  };
}

test('explicit merchant carrier plus close shipment anchor safely bridges FNP-style tracking', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [],
    [anchor()],
    [
      evidence(),
      evidence({
        sourceEmailId: 'carrier-2',
        eventType: 'delivery',
        receivedAt: '2026-08-11T06:14:09.000Z',
      }),
    ],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.equal(candidate.purchaseId, 'purchase-1');
  assert.equal(candidate.trackingNumber, '650925031807000013605231');
  assert.ok(candidate.reasons.includes('merchant_shipment_names_same_carrier'));
});

test('expected carrier plus merchant delivery corroboration bridges GLS-style chain', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase({ expectedCarrier: 'GLS' })],
    [],
    [
      anchor({
        carrier: null,
        receivedAt: '2026-08-05T20:30:02.000Z',
      }),
      anchor({
        sourceEmailId: 'merchant-delivery-1',
        eventType: 'delivery',
        carrier: null,
        receivedAt: '2026-08-06T08:29:45.000Z',
      }),
    ],
    [evidence({
      trackingNumber: '3412842135',
      carrier: 'GLS',
      receivedAt: '2026-08-06T05:50:30.000Z',
    })],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.equal(candidate.purchaseId, 'purchase-1');
  assert.ok(candidate.reasons.includes('merchant_delivery_corroborates_bridge'));
});

test('short carrier reference numbers are not treated as tracking identities', () => {
  const candidates = resolveTrackingBridgeCandidates(
    [purchase()],
    [],
    [anchor()],
    [evidence({ trackingNumber: '767859' })],
  );

  assert.deepEqual(candidates, []);
});

test('same expected carrier without a strong second bridge signal stays unmatched', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase({ expectedCarrier: 'GLS' })],
    [],
    [anchor({ carrier: null })],
    [evidence({ trackingNumber: '3412842135', carrier: 'GLS' })],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('purchase with a different existing tracking on the same carrier cannot absorb a new cluster', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [{
      purchaseId: 'purchase-1',
      userId,
      carrierSlug: 'express-one',
      trackingNumber: '605855688145000013605231',
    }],
    [anchor()],
    [evidence()],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('multiple safe purchase candidates always go to review', () => {
  const purchases = [
    purchase(),
    purchase({ purchaseId: 'purchase-2' }),
  ];
  const anchors = [
    anchor(),
    anchor({ purchaseId: 'purchase-2', sourceEmailId: 'merchant-shipment-2' }),
  ];
  const [candidate] = resolveTrackingBridgeCandidates(purchases, [], anchors, [evidence()]);

  assert.ok(candidate);
  assert.equal(candidate.decision, 'review');
  assert.equal(candidate.purchaseId, null);
});

test('low-confidence carrier cluster goes to review rather than linking', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [],
    [anchor()],
    [evidence({ confidence: 0.82 })],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'review');
});
