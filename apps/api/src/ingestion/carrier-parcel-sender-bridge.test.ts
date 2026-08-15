import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCarrierParcelSenderBridges,
  type CarrierBridgeEvidence,
  type CarrierBridgePurchase,
} from './carrier-parcel-sender-bridge.js';

function purchase(overrides: Partial<CarrierBridgePurchase> = {}): CarrierBridgePurchase {
  return {
    purchaseId: 'purchase-1', userId: 'user-1', merchantName: 'gate.shop', merchantDomain: 'gate.shop', orderNumber: '20336215', ...overrides,
  };
}

function merchantShipment(overrides: Partial<CarrierBridgeEvidence> = {}): CarrierBridgeEvidence {
  return {
    sourceEmailId: 'merchant-email', userId: 'user-1', senderDomain: 'gate.shop', receivedAt: '2026-07-29T13:02:30.000Z',
    eventType: 'shipment', orderNumber: '20336215', trackingNumber: null, carrier: 'FoxPost / Packeta', parcelSender: null, shipmentPhase: null, confidence: 0.78, ...overrides,
  };
}

function carrier(overrides: Partial<CarrierBridgeEvidence> = {}): CarrierBridgeEvidence {
  return {
    sourceEmailId: 'carrier-email', userId: 'user-1', senderDomain: 'foxpost.hu', receivedAt: '2026-07-29T19:52:57.000Z',
    eventType: 'shipment', orderNumber: null, trackingNumber: 'CLFOX178524111362058', carrier: 'FOXPOST', parcelSender: 'GATE.SHOP HU', shipmentPhase: 'in_transit', confidence: 0.9, ...overrides,
  };
}

test('bridges carrier tracking to one purchase using parcel sender plus merchant shipment anchor', () => {
  const [decision] = resolveCarrierParcelSenderBridges([purchase()], [merchantShipment(), carrier()]);
  assert.ok(decision);
  assert.equal(decision.decision, 'linkable');
  assert.equal(decision.purchaseId, 'purchase-1');
  assert.equal(decision.trackingNumber, 'CLFOX178524111362058');
  assert.equal(decision.carrierSlug, 'foxpost');
  assert.equal(decision.shipmentStatus, 'in_transit');
  assert.equal(decision.merchantAnchorSourceId, 'merchant-email');
  assert.deepEqual(new Set(decision.sourceEmailIds), new Set(['merchant-email', 'carrier-email']));
  assert.ok(decision.reasons.includes('carrier_parcel_sender_matches_merchant'));
});

test('ready-for-pickup evidence advances the bridge status without treating it as delivered', () => {
  const [decision] = resolveCarrierParcelSenderBridges(
    [purchase()],
    [
      merchantShipment(),
      carrier(),
      carrier({ sourceEmailId: 'pickup-email', receivedAt: '2026-08-03T10:12:38.000Z', shipmentPhase: 'ready_for_pickup' }),
    ],
  );
  assert.ok(decision);
  assert.equal(decision.shipmentStatus, 'ready_for_pickup');
  assert.ok(decision.reasons.includes('explicit_ready_for_pickup_evidence'));
});

test('legal suffixes do not block a strong merchant match', () => {
  const [decision] = resolveCarrierParcelSenderBridges(
    [purchase({ merchantName: 'BioTechUSA', merchantDomain: 'biotechusa.hu', orderNumber: 'B-123' })],
    [merchantShipment({ senderDomain: 'biotechusa.hu', orderNumber: 'B-123', carrier: 'Foxpost' }), carrier({ parcelSender: 'BioTechUSA Kft.', trackingNumber: 'CLFOX123456789000' })],
  );
  assert.equal(decision?.decision, 'linkable');
});

test('carrier-only tracking never guesses a purchase', () => {
  const [decision] = resolveCarrierParcelSenderBridges([purchase()], [carrier()]);
  assert.ok(decision);
  assert.equal(decision.decision, 'unmatched');
  assert.equal(decision.purchaseId, null);
});

test('merchant shipment outside the seven-day window does not bridge', () => {
  const [decision] = resolveCarrierParcelSenderBridges([purchase()], [merchantShipment({ receivedAt: '2026-07-01T10:00:00.000Z' }), carrier()]);
  assert.equal(decision?.decision, 'unmatched');
});

test('multiple purchase candidates go to review', () => {
  const purchases = [
    purchase(),
    purchase({ purchaseId: 'purchase-2', merchantName: 'Gate Shop', merchantDomain: 'gate.shop', orderNumber: '20336216' }),
  ];
  const rows = [
    merchantShipment(),
    merchantShipment({ sourceEmailId: 'merchant-email-2', orderNumber: '20336216', receivedAt: '2026-07-29T14:00:00.000Z' }),
    carrier(),
  ];
  const [decision] = resolveCarrierParcelSenderBridges(purchases, rows);
  assert.equal(decision?.decision, 'review');
  assert.equal(decision?.purchaseId, null);
});
