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

test('never reconstructs without a completed 90-day exact-order search proof', () => {
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(gymbeam3010228912(), []), []);
});

test('search that already wrote a purchase blocks reconstruction', () => {
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(
    gymbeam3010228912(),
    [proof('3010228912', { purchaseWrites: 1 })],
  ), []);
});

test('exact carrier-side tracking proof is mandatory', () => {
  const rows = gymbeam3010228912().filter((row) => !row.isCarrierSender);
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proof()]), []);
});

test('carrier tracking from another user cannot corroborate reconstruction', () => {
  const rows = gymbeam3010228912().map((row) =>
    row.isCarrierSender ? { ...row, userId: 'user-2' } : row,
  );
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proof()]), []);
});

test('invoice plus shipment without an additional merchant lifecycle event is insufficient', () => {
  const rows = gymbeam3010228912().filter((row) => row.eventType !== 'order_updated');
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows, [proof()]), []);
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
