import assert from 'node:assert/strict';
import test from 'node:test';
import {
  carrierBridgeShippedAt,
  resolveCarrierParcelSenderBridges,
  type CarrierBridgeEvidence,
  type CarrierBridgePurchase,
} from './carrier-parcel-sender-bridge.js';

function purchase(overrides: Partial<CarrierBridgePurchase> = {}): CarrierBridgePurchase {
  return {
    purchaseId: 'purchase-1',
    userId: 'user-1',
    merchantName: 'gate.shop',
    merchantDomain: 'gate.shop',
    orderNumber: '20336215',
    totalAmount: null,
    currency: null,
    orderedAt: null,
    confidence: null,
    ...overrides,
  };
}

function merchantShipment(overrides: Partial<CarrierBridgeEvidence> = {}): CarrierBridgeEvidence {
  return {
    sourceEmailId: 'merchant-email',
    userId: 'user-1',
    senderDomain: 'gate.shop',
    receivedAt: '2026-07-29T13:02:30.000Z',
    eventType: 'shipment',
    orderNumber: '20336215',
    trackingNumber: null,
    carrier: 'FoxPost / Packeta',
    parcelSender: null,
    shipmentPhase: null,
    codAmount: null,
    codCurrency: null,
    confidence: 0.78,
    ...overrides,
  };
}

function carrier(overrides: Partial<CarrierBridgeEvidence> = {}): CarrierBridgeEvidence {
  return {
    sourceEmailId: 'carrier-email',
    userId: 'user-1',
    senderDomain: 'foxpost.hu',
    receivedAt: '2026-07-29T19:52:57.000Z',
    eventType: 'shipment',
    orderNumber: null,
    trackingNumber: 'CLFOX178524111362058',
    carrier: 'FOXPOST',
    parcelSender: 'GATE.SHOP HU',
    shipmentPhase: 'in_transit',
    codAmount: null,
    codCurrency: null,
    confidence: 0.9,
    ...overrides,
  };
}

function scitecPurchase(overrides: Partial<CarrierBridgePurchase> = {}): CarrierBridgePurchase {
  return purchase({
    purchaseId: 'scitec-purchase',
    merchantName: 'Scitec',
    merchantDomain: 'scitec.hu',
    orderNumber: '1783-975-87-395',
    totalAmount: 16780,
    currency: 'HUF',
    orderedAt: '2026-07-13T20:51:17.000Z',
    confidence: 0.95,
    ...overrides,
  });
}

function scitecCarrierChain(): CarrierBridgeEvidence[] {
  return [
    carrier({
      sourceEmailId: 'fox-pre-advice',
      receivedAt: '2026-07-14T08:48:29.000Z',
      trackingNumber: 'CLFOX178401889449819',
      parcelSender: null,
      shipmentPhase: null,
      codAmount: null,
      codCurrency: null,
      confidence: 0.96,
    }),
    carrier({
      sourceEmailId: 'fox-warehouse-review-shape',
      receivedAt: '2026-07-14T17:33:28.000Z',
      trackingNumber: null,
      parcelSender: null,
      shipmentPhase: null,
      codAmount: null,
      codCurrency: null,
      confidence: 0.99,
    }),
    carrier({
      sourceEmailId: 'fox-pickup',
      receivedAt: '2026-07-15T09:55:07.000Z',
      trackingNumber: 'CLFOX178401889449819',
      parcelSender: 'BioTechUSA Kft.',
      shipmentPhase: 'ready_for_pickup',
      codAmount: 16780,
      codCurrency: 'HUF',
      confidence: 0.99,
    }),
  ];
}

test('shipment_created merchant anchor never defines physical shipped_at', () => {
  const packing = merchantShipment({
    receivedAt: '2026-07-22T20:02:25.000Z',
    shipmentPhase: 'shipment_created',
    carrier: 'MPL',
  });
  const mplAccepted = carrier({
    senderDomain: 'posta.hu',
    receivedAt: '2026-07-23T14:44:56.000Z',
    carrier: 'Magyar Posta Logisztika (MPL)',
    trackingNumber: 'PB9S650307180',
    parcelSender: 'Szidibox Karton Kft.',
    shipmentPhase: 'shipped',
  });
  assert.equal(carrierBridgeShippedAt(packing, [mplAccepted]), '2026-07-23T14:44:56.000Z');
});

test('shipment_created merchant anchor without physical carrier evidence has no shipped_at', () => {
  const packing = merchantShipment({ shipmentPhase: 'shipment_created' });
  const preAdvice = carrier({ shipmentPhase: 'shipment_created' });
  assert.equal(carrierBridgeShippedAt(packing, [preAdvice]), null);
});

test('legacy physical merchant shipment can still define an earlier shipped_at', () => {
  const physicalMerchant = merchantShipment({ receivedAt: '2026-07-29T13:02:30.000Z', shipmentPhase: null });
  const laterCarrier = carrier({ receivedAt: '2026-07-29T19:52:57.000Z', shipmentPhase: 'in_transit' });
  assert.equal(carrierBridgeShippedAt(physicalMerchant, [laterCarrier]), '2026-07-29T13:02:30.000Z');
});

test('bridges carrier tracking to one purchase using parcel sender plus merchant shipment anchor', () => {
  const [decision] = resolveCarrierParcelSenderBridges([purchase()], [merchantShipment(), carrier()]);
  assert.ok(decision);
  assert.equal(decision.decision, 'linkable');
  assert.equal(decision.purchaseId, 'purchase-1');
  assert.equal(decision.trackingNumber, 'CLFOX178524111362058');
  assert.equal(decision.carrierSlug, 'foxpost');
  assert.equal(decision.shipmentStatus, 'in_transit');
  assert.equal(decision.merchantAnchorSourceId, 'merchant-email');
  assert.equal(decision.primarySourceId, 'merchant-email');
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

test('verified Scitec legal-entity alias bridges exact COD using two independently observed tracking events', () => {
  const [decision] = resolveCarrierParcelSenderBridges([scitecPurchase()], scitecCarrierChain());
  assert.ok(decision);
  assert.equal(decision.decision, 'linkable');
  assert.equal(decision.purchaseId, 'scitec-purchase');
  assert.equal(decision.trackingNumber, 'CLFOX178401889449819');
  assert.equal(decision.shipmentStatus, 'ready_for_pickup');
  assert.equal(decision.merchantAnchorSourceId, null);
  assert.equal(decision.primarySourceId, 'fox-pickup');
  assert.deepEqual(new Set(decision.sourceEmailIds), new Set(['fox-pre-advice', 'fox-pickup']));
  assert.ok(decision.reasons.includes('verified_brand_legal_entity_alias'));
  assert.ok(decision.reasons.includes('exact_cod_matches_purchase_total'));
  assert.ok(decision.reasons.includes('multi_event_carrier_chain'));
});

test('verified brand fallback rejects a wrong COD amount', () => {
  const rows = scitecCarrierChain().map((row) => ({ ...row, codAmount: row.codAmount === null ? null : 16779 }));
  const [decision] = resolveCarrierParcelSenderBridges([scitecPurchase()], rows);
  assert.equal(decision?.decision, 'unmatched');
});

test('verified brand fallback rejects a single carrier event even with exact COD', () => {
  const [decision] = resolveCarrierParcelSenderBridges([scitecPurchase()], [scitecCarrierChain()[2]!]);
  assert.equal(decision?.decision, 'unmatched');
});

test('same amount and parcel sender cannot bridge an unverified merchant domain', () => {
  const [decision] = resolveCarrierParcelSenderBridges(
    [scitecPurchase({ merchantDomain: 'unrelated-shop.hu', merchantName: 'Unrelated Shop' })],
    scitecCarrierChain(),
  );
  assert.equal(decision?.decision, 'unmatched');
});

test('verified brand fallback rejects low-confidence purchase identity', () => {
  const [decision] = resolveCarrierParcelSenderBridges(
    [scitecPurchase({ confidence: 0.94 })],
    scitecCarrierChain(),
  );
  assert.equal(decision?.decision, 'unmatched');
});

test('multiple verified brand COD candidates go to review', () => {
  const [decision] = resolveCarrierParcelSenderBridges(
    [
      scitecPurchase(),
      scitecPurchase({ purchaseId: 'scitec-purchase-2', orderNumber: '1783-975-87-396' }),
    ],
    scitecCarrierChain(),
  );
  assert.equal(decision?.decision, 'review');
  assert.equal(decision?.purchaseId, null);
  assert.ok(decision?.reasons.includes('multiple_verified_brand_cod_purchase_candidates'));
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
