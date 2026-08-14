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
    merchantName: null,
    merchantLegalName: null,
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
    consignor: null,
    confidence: 0.86,
    receivedAt: '2026-08-10T21:04:10.000Z',
    ...overrides,
  };
}

test('explicit merchant carrier plus close shipment anchor safely bridges FNP-style tracking', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()], [], [anchor()],
    [evidence(), evidence({ sourceEmailId: 'carrier-2', eventType: 'delivery', receivedAt: '2026-08-11T06:14:09.000Z' })],
  );
  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.equal(candidate.purchaseId, 'purchase-1');
  assert.deepEqual(candidate.shipmentProofSourceEmailIds, ['carrier-1']);
});

test('expected carrier plus merchant delivery corroboration bridges GLS-style chain', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase({ expectedCarrier: 'GLS' })], [],
    [
      anchor({ carrier: null, receivedAt: '2026-08-05T20:30:02.000Z' }),
      anchor({ sourceEmailId: 'merchant-delivery-1', eventType: 'delivery', carrier: null, receivedAt: '2026-08-06T08:29:45.000Z' }),
    ],
    [evidence({ trackingNumber: '3412842135', carrier: 'GLS', receivedAt: '2026-08-06T05:50:30.000Z' })],
  );
  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.ok(candidate.reasons.includes('merchant_delivery_corroborates_bridge'));
});

test('later carrier shipment proves a cluster even when carrier pre-advice arrived before merchant shipment', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase({ expectedCarrier: 'DPD', merchantName: 'sinsay.com', merchantLegalName: 'LPP Hungary Kft.' })], [],
    [anchor({ sourceEmailId: 'sinsay-shipped', carrier: 'DPD Futárszolgálat', confidence: 0.82, receivedAt: '2026-08-04T13:56:39.000Z' })],
    [
      evidence({ sourceEmailId: 'dpd-preadvice', trackingNumber: '16380143879559', carrier: 'DPD', confidence: 0.90, receivedAt: '2026-08-03T18:08:05.000Z' }),
      evidence({ sourceEmailId: 'dpd-shipped', trackingNumber: '16380143879559', carrier: 'DPD', consignor: 'LPP Hungary Kft./FC PDK', confidence: 0.93, receivedAt: '2026-08-05T16:05:32.000Z' }),
      evidence({ sourceEmailId: 'dpd-delivered', eventType: 'delivery', trackingNumber: '16380143879559', carrier: 'DPD', confidence: 0.97, receivedAt: '2026-08-06T07:04:14.000Z' }),
    ],
  );
  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.deepEqual(candidate.shipmentProofSourceEmailIds, ['dpd-shipped']);
  assert.ok(candidate.reasons.includes('carrier_consignor_matches_purchase_merchant'));
});

test('carrier consignor mismatch blocks a timing-coincident DPD cluster', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase({ expectedCarrier: 'DPD', merchantName: 'sinsay.com', merchantLegalName: 'LPP Hungary Kft.' })], [],
    [anchor({ carrier: 'DPD Futárszolgálat', confidence: 0.82, receivedAt: '2026-08-04T13:56:39.000Z' })],
    [
      evidence({ sourceEmailId: 'wrong-preadvice', trackingNumber: '16380124260518', carrier: 'DPD', confidence: 0.90, receivedAt: '2026-08-04T08:36:08.000Z' }),
      evidence({ sourceEmailId: 'wrong-shipped', trackingNumber: '16380124260518', carrier: 'DPD', consignor: 'MODELL&HOBBY Kft.', confidence: 0.86, receivedAt: '2026-08-04T16:50:01.000Z' }),
    ],
  );
  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
  assert.equal(candidate.purchaseId, null);
});

test('early pre-advice alone cannot prove a tracking bridge', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase({ expectedCarrier: 'DPD' })], [],
    [anchor({ carrier: 'DPD', confidence: 0.82, receivedAt: '2026-08-04T13:56:39.000Z' })],
    [evidence({ trackingNumber: '16380143879559', carrier: 'DPD', confidence: 0.93, receivedAt: '2026-08-03T18:08:05.000Z' })],
  );
  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('short carrier reference numbers are not treated as tracking identities', () => {
  assert.deepEqual(resolveTrackingBridgeCandidates([purchase()], [], [anchor()], [evidence({ trackingNumber: '767859' })]), []);
});

test('same expected carrier without a strong second bridge signal stays unmatched', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase({ expectedCarrier: 'GLS' })], [], [anchor({ carrier: null })],
    [evidence({ trackingNumber: '3412842135', carrier: 'GLS' })],
  );
  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('purchase with a different existing tracking on the same carrier cannot absorb a new cluster', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [{ purchaseId: 'purchase-1', userId, carrierSlug: 'express-one', trackingNumber: '605855688145000013605231' }],
    [anchor()], [evidence()],
  );
  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('multiple safe purchase candidates always go to review', () => {
  const purchases = [purchase(), purchase({ purchaseId: 'purchase-2' })];
  const anchors = [anchor(), anchor({ purchaseId: 'purchase-2', sourceEmailId: 'merchant-shipment-2' })];
  const [candidate] = resolveTrackingBridgeCandidates(purchases, [], anchors, [evidence()]);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'review');
  assert.equal(candidate.purchaseId, null);
});

test('low-confidence carrier cluster goes to review rather than linking', () => {
  const [candidate] = resolveTrackingBridgeCandidates([purchase()], [], [anchor()], [evidence({ confidence: 0.82 })]);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'review');
});
