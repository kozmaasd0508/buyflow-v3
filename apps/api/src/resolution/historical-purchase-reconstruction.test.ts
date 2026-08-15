import assert from 'node:assert/strict';
import test from 'node:test';
import {
  historicalReconstructionGroupKey,
  resolveHistoricalPurchaseReconstructions,
  type HistoricalReconstructionEvidence,
  type HistoricalReconstructionExistingPurchase,
  type HistoricalReconstructionSearchProof,
} from './historical-purchase-reconstruction.js';

const userId = 'user-1';
const connectionId = 'connection-1';

function evidence(overrides: Partial<HistoricalReconstructionEvidence> = {}): HistoricalReconstructionEvidence {
  return {
    sourceEmailId: 'invoice-1',
    userId,
    emailConnectionId: connectionId,
    senderDomain: 'service.gymbeam.hu',
    isCarrierSender: false,
    processingStatus: 'review',
    validationStatus: 'validated',
    eventType: 'invoice_or_receipt',
    merchant: 'GymBeam',
    merchantLegalName: 'GymBeam Germany GmbH',
    orderNumber: '3010228912',
    trackingNumber: null,
    carrier: null,
    paymentStatus: 'paid',
    confidence: 0.67,
    receivedAt: '2026-07-16T17:46:26.000Z',
    ...overrides,
  };
}

function proof(orderNumber = '3010228912', overrides: Partial<HistoricalReconstructionSearchProof> = {}): HistoricalReconstructionSearchProof {
  const row = evidence({ orderNumber });
  const key = historicalReconstructionGroupKey(row);
  assert.ok(key);
  return {
    key,
    status: 'processed',
    windowDays: 90,
    checked: 3,
    purchaseWrites: 0,
    ...overrides,
  };
}

function proofFor(row: HistoricalReconstructionEvidence, overrides: Partial<HistoricalReconstructionSearchProof> = {}): HistoricalReconstructionSearchProof {
  const key = historicalReconstructionGroupKey(row);
  assert.ok(key);
  return {
    key,
    status: 'processed',
    windowDays: 90,
    checked: 5,
    purchaseWrites: 0,
    ...overrides,
  };
}

function purchase(overrides: Partial<HistoricalReconstructionExistingPurchase> = {}): HistoricalReconstructionExistingPurchase {
  return {
    userId,
    merchantDomain: 'service.gymbeam.hu',
    orderNumber: '3010228912',
    ...overrides,
  };
}

function gymbeam3010228912(): HistoricalReconstructionEvidence[] {
  return [
    evidence(),
    evidence({
      sourceEmailId: 'order-update-1',
      processingStatus: 'review',
      validationStatus: 'guardrailed',
      eventType: 'order_updated',
      confidence: 0.78,
      receivedAt: '2026-07-14T21:45:18.000Z',
    }),
    evidence({
      sourceEmailId: 'merchant-shipment-1',
      processingStatus: 'unlinked',
      eventType: 'shipment',
      trackingNumber: '605855685836000013605231',
      carrier: 'Express One',
      confidence: 0.86,
      receivedAt: '2026-07-15T06:55:18.000Z',
    }),
    evidence({
      sourceEmailId: 'carrier-shipment-1',
      senderDomain: 'expressone.hu',
      isCarrierSender: true,
      processingStatus: 'unlinked',
      validationStatus: 'guardrailed',
      eventType: 'shipment',
      merchant: null,
      merchantLegalName: null,
      orderNumber: null,
      trackingNumber: '605855685836000013605231',
      carrier: 'Express One',
      paymentStatus: null,
      confidence: 0.93,
      receivedAt: '2026-07-15T21:20:43.000Z',
    }),
  ];
}

function allInPackagingChain(): HistoricalReconstructionEvidence[] {
  return [
    evidence({
      sourceEmailId: 'allin-invoice',
      senderDomain: 'allinpackaging.com',
      merchant: 'All In Packaging',
      merchantLegalName: null,
      orderNumber: '148810',
      paymentStatus: null,
      confidence: 0.9,
      receivedAt: '2026-08-03T09:24:42.000Z',
    }),
    evidence({
      sourceEmailId: 'allin-dispatch',
      senderDomain: 'allinpackaging.com',
      processingStatus: 'unlinked',
      eventType: 'shipment',
      merchant: 'All In Packaging',
      merchantLegalName: null,
      orderNumber: '148810',
      trackingNumber: null,
      carrier: null,
      paymentStatus: null,
      confidence: 0.92,
      receivedAt: '2026-07-31T11:22:50.000Z',
      shipmentPhase: 'shipped',
    }),
    evidence({
      sourceEmailId: 'gls-pre-advice',
      senderDomain: 'gls-hungary.com',
      isCarrierSender: true,
      processingStatus: 'unlinked',
      validationStatus: 'guardrailed',
      eventType: 'shipment',
      merchant: null,
      merchantLegalName: null,
      orderNumber: null,
      trackingNumber: '3219379224',
      carrier: 'GLS',
      paymentStatus: null,
      confidence: 0.995,
      receivedAt: '2026-08-03T09:20:35.000Z',
      parcelSender: 'Nordtek Imexco Kft. (Allinpackaging)',
      codAmount: 16670,
      codCurrency: 'HUF',
      shipmentPhase: 'shipment_created',
    }),
    evidence({
      sourceEmailId: 'gls-out-for-delivery',
      senderDomain: 'gls-hungary.com',
      isCarrierSender: true,
      processingStatus: 'unlinked',
      validationStatus: 'guardrailed',
      eventType: 'shipment',
      merchant: null,
      merchantLegalName: null,
      orderNumber: null,
      trackingNumber: '3219379224',
      carrier: 'GLS',
      paymentStatus: null,
      confidence: 0.995,
      receivedAt: '2026-08-04T05:52:38.000Z',
      parcelSender: 'Nordtek Imexco Kft. (Allinpackaging)',
      codAmount: 16670,
      codCurrency: 'HUF',
      shipmentPhase: 'out_for_delivery',
    }),
    evidence({
      sourceEmailId: 'gls-dynamic',
      senderDomain: 'gls-hungary.com',
      isCarrierSender: true,
      processingStatus: 'unlinked',
      validationStatus: 'guardrailed',
      eventType: 'shipment',
      merchant: null,
      merchantLegalName: null,
      orderNumber: null,
      trackingNumber: '3219379224',
      carrier: 'GLS',
      paymentStatus: null,
      confidence: 0.99,
      receivedAt: '2026-08-04T07:03:17.000Z',
      shipmentPhase: 'in_transit',
    }),
  ];
}

test('reconstructs GymBeam 3010228912 only after negative 90-day anchor search plus exact carrier tracking', () => {
  const candidates = resolveHistoricalPurchaseReconstructions(gymbeam3010228912(), [proof()]);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.orderNumber, '3010228912');
  assert.equal(candidate.expectedCarrier, 'Express One');
  assert.equal(candidate.trackingNumber, '605855685836000013605231');
  assert.equal(candidate.sourceLinks.length, 3);
  assert.deepEqual(candidate.carrierProofSourceEmailIds, ['carrier-shipment-1']);
  assert.ok(candidate.reasons.includes('ninety_day_exact_order_search_completed_without_purchase'));
});

test('reconstructs GymBeam 3010206178 with invoice shipment delivery and exact carrier tracking', () => {
  const rows: HistoricalReconstructionEvidence[] = [
    evidence({ orderNumber: '3010206178', confidence: 0.78 }),
    evidence({
      sourceEmailId: 'merchant-shipment-2',
      orderNumber: '3010206178',
      eventType: 'shipment',
      trackingNumber: '605855685055000013605231',
      carrier: 'Express One',
      confidence: 0.78,
      receivedAt: '2026-07-12T16:52:23.000Z',
    }),
    evidence({
      sourceEmailId: 'merchant-delivery-2',
      orderNumber: '3010206178',
      eventType: 'delivery',
      confidence: 0.78,
      receivedAt: '2026-07-16T05:12:18.000Z',
    }),
    evidence({
      sourceEmailId: 'carrier-delivery-2',
      senderDomain: 'expressone.hu',
      isCarrierSender: true,
      orderNumber: null,
      merchant: null,
      merchantLegalName: null,
      eventType: 'delivery',
      trackingNumber: '605855685055000013605231',
      carrier: 'Express One',
      validationStatus: 'guardrailed',
      confidence: 0.88,
      receivedAt: '2026-07-16T05:35:49.000Z',
    }),
  ];

  const candidates = resolveHistoricalPurchaseReconstructions(rows, [proof('3010206178', { checked: 6 })]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.confidence, 0.9);
  assert.ok(candidates[0]?.reasons.includes('merchant_delivery_corroborates_reconstruction'));
});

test('reconstructs missing merchant tracking only from one strict multi-event COD carrier cluster', () => {
  const rows = allInPackagingChain();
  const invoice = rows[0]!;
  const candidates = resolveHistoricalPurchaseReconstructions(rows, [proofFor(invoice)]);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.orderNumber, '148810');
  assert.equal(candidate.expectedCarrier, 'GLS');
  assert.equal(candidate.trackingNumber, '3219379224');
  assert.equal(candidate.orderedAt, null);
  assert.deepEqual(new Set(candidate.carrierProofSourceEmailIds), new Set([
    'gls-pre-advice',
    'gls-out-for-delivery',
    'gls-dynamic',
  ]));
  assert.ok(candidate.reasons.includes('merchant_shipment_missing_tracking_replaced_by_unique_carrier_cluster'));
});

test('a second same-merchant tracking cluster without COD does not create ambiguity', () => {
  const rows = allInPackagingChain();
  rows.push(
    evidence({
      sourceEmailId: 'gls-other-1',
      senderDomain: 'gls-hungary.com',
      isCarrierSender: true,
      processingStatus: 'unlinked',
      validationStatus: 'guardrailed',
      eventType: 'shipment',
      merchant: null,
      merchantLegalName: null,
      orderNumber: null,
      trackingNumber: '3219379250',
      carrier: 'GLS',
      paymentStatus: null,
      confidence: 0.995,
      receivedAt: '2026-08-04T12:10:28.000Z',
      parcelSender: 'Nordtek Imexco Kft. (Allinpackaging)',
      codAmount: null,
      codCurrency: null,
      shipmentPhase: 'shipment_created',
    }),
    evidence({
      sourceEmailId: 'gls-other-2',
      senderDomain: 'gls-hungary.com',
      isCarrierSender: true,
      processingStatus: 'unlinked',
      validationStatus: 'guardrailed',
      eventType: 'shipment',
      merchant: null,
      merchantLegalName: null,
      orderNumber: null,
      trackingNumber: '3219379250',
      carrier: 'GLS',
      paymentStatus: null,
      confidence: 0.995,
      receivedAt: '2026-08-05T05:55:48.000Z',
      parcelSender: 'Nordtek Imexco Kft. (Allinpackaging)',
      codAmount: null,
      codCurrency: null,
      shipmentPhase: 'out_for_delivery',
    }),
  );
  const candidates = resolveHistoricalPurchaseReconstructions(rows, [proofFor(rows[0]!)]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.trackingNumber, '3219379224');
});

test('never reconstructs without a completed 90-day exact-order search proof', () => {
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(gymbeam3010228912(), []), []);
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(allInPackagingChain(), []), []);
});

test('search that already wrote a purchase blocks reconstruction', () => {
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(
    gymbeam3010228912(),
    [proof('3010228912', { purchaseWrites: 1 })],
  ), []);
});

test('exact carrier-side tracking proof is mandatory for the legacy reconstruction lane', () => {
  const rows = gymbeam3010228912().filter((row) => !row.isCarrierSender);
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proof()]), []);
});

test('carrier tracking from another user cannot corroborate reconstruction', () => {
  const rows = gymbeam3010228912().map((row) =>
    row.isCarrierSender ? { ...row, userId: 'user-2' } : row,
  );
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proof()]), []);
});

test('invoice plus shipment without an additional merchant lifecycle event is insufficient without the strict carrier-cluster proof', () => {
  const rows = gymbeam3010228912().filter((row) => row.eventType !== 'order_updated');
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proof()]), []);
});

test('carrier cluster fallback requires explicit COD', () => {
  const rows = allInPackagingChain().map((row) => row.isCarrierSender ? { ...row, codAmount: null, codCurrency: null } : row);
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proofFor(rows[0]!)]), []);
});

test('carrier cluster fallback requires at least two carrier source emails', () => {
  const rows = allInPackagingChain().filter((row) => !row.isCarrierSender || row.sourceEmailId === 'gls-out-for-delivery');
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proofFor(rows[0]!)]), []);
});

test('carrier cluster fallback requires parcel sender to match the merchant identity', () => {
  const rows = allInPackagingChain().map((row) => row.isCarrierSender ? { ...row, parcelSender: 'Different Merchant Kft.' } : row);
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proofFor(rows[0]!)]), []);
});

test('carrier cluster fallback requires physical progress beyond pre-advice', () => {
  const rows = allInPackagingChain().map((row) => row.isCarrierSender ? { ...row, shipmentPhase: 'shipment_created' } : row);
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proofFor(rows[0]!)]), []);
});

test('two eligible COD tracking clusters remain ambiguous and block reconstruction', () => {
  const rows = allInPackagingChain();
  const duplicateCluster = rows.filter((row) => row.isCarrierSender).map((row, index) => ({
    ...row,
    sourceEmailId: `other-cod-${index}`,
    trackingNumber: '9999999999',
  }));
  rows.push(...duplicateCluster);
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proofFor(rows[0]!)]), []);
});

test('any order-created source leaves ownership to Review Resolver and blocks historical reconstruction', () => {
  const rows = [
    ...gymbeam3010228912(),
    evidence({
      sourceEmailId: 'weak-order-anchor',
      eventType: 'order_created',
      validationStatus: 'review',
      confidence: 0.5,
      receivedAt: '2026-07-14T20:00:00.000Z',
    }),
  ];
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proof()]), []);
});

test('existing exact purchase identity blocks reconstruction', () => {
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(
    gymbeam3010228912(),
    [proof()],
    [purchase()],
  ), []);
});

test('short receipt-like order numbers are never historical reconstruction identities', () => {
  const rows = gymbeam3010228912().map((row) => ({
    ...row,
    orderNumber: row.isCarrierSender ? null : '6383',
  }));
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, []), []);
});
