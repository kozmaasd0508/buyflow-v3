import assert from 'node:assert/strict';
import test from 'node:test';
import {
  historicalReconstructionGroupKey,
  resolveHistoricalPurchaseReconstructions,
  type HistoricalReconstructionEvidence,
} from './historical-purchase-reconstruction.js';

const userId = 'user-1';
const emailConnectionId = 'connection-1';
const orderNumber = '3010228912';
const tracking = '605855685836000013605231';

function merchantEvidence(overrides: Partial<HistoricalReconstructionEvidence> = {}): HistoricalReconstructionEvidence {
  return {
    sourceEmailId: 'invoice',
    userId,
    emailConnectionId,
    senderDomain: 'service.gymbeam.hu',
    isCarrierSender: false,
    processingStatus: 'review',
    validationStatus: 'validated',
    eventType: 'invoice_or_receipt',
    merchant: 'GymBeam',
    merchantLegalName: 'GymBeam Germany GmbH',
    orderNumber,
    trackingNumber: null,
    carrier: null,
    paymentStatus: 'paid',
    confidence: 0.78,
    receivedAt: '2026-07-16T17:46:26.000Z',
    ...overrides,
  };
}

function rows(carrierStatus: string): HistoricalReconstructionEvidence[] {
  return [
    merchantEvidence(),
    merchantEvidence({
      sourceEmailId: 'merchant-update',
      eventType: 'order_updated',
      validationStatus: 'guardrailed',
      confidence: 0.78,
      receivedAt: '2026-07-14T21:45:18.000Z',
    }),
    merchantEvidence({
      sourceEmailId: 'merchant-shipment',
      eventType: 'shipment',
      trackingNumber: tracking,
      carrier: 'Express One',
      confidence: 0.86,
      receivedAt: '2026-07-15T06:55:18.000Z',
    }),
    merchantEvidence({
      sourceEmailId: 'carrier-proof',
      senderDomain: 'expressone.hu',
      isCarrierSender: true,
      processingStatus: carrierStatus,
      validationStatus: 'guardrailed',
      eventType: 'shipment',
      merchant: null,
      merchantLegalName: null,
      orderNumber: null,
      trackingNumber: tracking,
      carrier: 'Express One',
      paymentStatus: null,
      confidence: 0.93,
      receivedAt: '2026-07-15T21:20:43.000Z',
    }),
  ];
}

function proof() {
  const key = historicalReconstructionGroupKey(merchantEvidence());
  assert.ok(key);
  return [{ key, status: 'processed' as const, windowDays: 90 as const, checked: 3, purchaseWrites: 0 }];
}

test('unresolved carrier proof can support reconstruction', () => {
  assert.equal(resolveHistoricalPurchaseReconstructions(rows('review'), proof()).length, 1);
});

test('already processed carrier proof cannot be reused for reconstruction', () => {
  assert.deepEqual(resolveHistoricalPurchaseReconstructions(rows('processed'), proof()), []);
});
