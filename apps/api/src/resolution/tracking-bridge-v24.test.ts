import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTrackingBridgeCandidates,
  type TrackingBridgeEvidence,
  type TrackingBridgeMerchantAnchor,
  type TrackingBridgePurchase,
} from './tracking-bridge-resolution.js';

const userId = 'user-1';
const tracking = '16380124260518';

function purchase(overrides: Partial<TrackingBridgePurchase> = {}): TrackingBridgePurchase {
  return {
    purchaseId: 'jatekbolt-purchase',
    userId,
    expectedCarrier: 'DPD',
    merchantName: 'JatekBolt.hu',
    merchantLegalName: 'Model & Hobby Kft.',
    ...overrides,
  };
}

function anchor(overrides: Partial<TrackingBridgeMerchantAnchor> = {}): TrackingBridgeMerchantAnchor {
  return {
    sourceEmailId: 'jatekbolt-shipment',
    purchaseId: 'jatekbolt-purchase',
    userId,
    eventType: 'shipment',
    carrier: 'DPD',
    trackingNumber: tracking,
    confidence: 0.78,
    receivedAt: '2026-08-04T08:49:02.000Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<TrackingBridgeEvidence> = {}): TrackingBridgeEvidence {
  return {
    sourceEmailId: 'dpd-shipped',
    userId,
    eventType: 'shipment',
    trackingNumber: tracking,
    carrier: 'DPD',
    consignor: 'MODELL&HOBBY Kft.',
    confidence: 0.86,
    receivedAt: '2026-08-04T16:50:01.000Z',
    ...overrides,
  };
}

test('JatekBolt exact tracking plus one-character legal-name variation safely bridges DPD cluster', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [],
    [anchor()],
    [
      evidence(),
      evidence({
        sourceEmailId: 'dpd-delivered',
        eventType: 'delivery',
        consignor: 'MODELL&HOBBY Kft.',
        confidence: 0.92,
        receivedAt: '2026-08-05T06:59:29.000Z',
      }),
    ],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.equal(candidate.purchaseId, 'jatekbolt-purchase');
  assert.ok(candidate.reasons.includes('merchant_shipment_exact_tracking_match'));
  assert.ok(candidate.reasons.includes('carrier_consignor_matches_purchase_merchant'));
});

test('0.78 merchant anchor without exact tracking remains below the general safety threshold', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [],
    [anchor({ trackingNumber: null })],
    [evidence()],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('exact tracking cannot override a genuinely different carrier consignor', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [],
    [anchor()],
    [evidence({ consignor: 'LPP Hungary Kft.' })],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
  assert.equal(candidate.purchaseId, null);
});

test('legal-name tolerance allows at most one approximate substantive token', () => {
  const [candidate] = resolveTrackingBridgeCandidates(
    [purchase()],
    [],
    [anchor()],
    [evidence({ consignor: 'MOBELL HOBBYX Kft.' })],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});
