import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAlzaInternalFulfillmentCandidates,
  type AlzaRecoveryEvidence,
  type AlzaRecoveryProof,
} from './alza-internal-fulfillment-recovery-v1.js';

function evidence(overrides: Partial<AlzaRecoveryEvidence> = {}): AlzaRecoveryEvidence {
  return {
    sourceEmailId: 'processing',
    userId: 'user-1',
    emailConnectionId: 'connection-1',
    senderDomain: 'alza.hu',
    receivedAt: '2026-06-24T15:46:47.000Z',
    processingStatus: 'unlinked',
    validationStatus: 'validated',
    eventType: 'order_updated',
    lifecycleEvent: 'order_processing',
    parserVersion: 'alza-order-processing-v2',
    orderNumber: '987654321',
    total: 3350,
    currency: 'HUF',
    paymentStatus: 'pending',
    paymentMethod: 'Kártya átvételkor vagy online',
    shippingMethod: 'AlzaBox',
    invoiceNumber: 'AHUW261234567',
    shipmentPhase: null,
    confidence: 0.995,
    ...overrides,
  };
}

function proof(overrides: Partial<AlzaRecoveryProof> = {}): AlzaRecoveryProof {
  return {
    userId: 'user-1',
    emailConnectionId: 'connection-1',
    orderNumber: '987654321',
    windowDays: 90,
    status: 'processed',
    checked: 4,
    purchaseWrites: 0,
    ...overrides,
  };
}

function chain(): AlzaRecoveryEvidence[] {
  return [
    evidence(),
    evidence({
      sourceEmailId: 'delay',
      receivedAt: '2026-06-25T09:27:20.000Z',
      parserVersion: 'deterministic-lifecycle-v1',
      lifecycleEvent: 'delayed',
      total: null,
      currency: null,
      paymentStatus: null,
      paymentMethod: null,
      shippingMethod: null,
      invoiceNumber: null,
      confidence: 0.99,
    }),
    evidence({
      sourceEmailId: 'pickup',
      receivedAt: '2026-06-26T10:10:28.000Z',
      eventType: 'shipment',
      lifecycleEvent: null,
      parserVersion: 'alza-commerce-v1',
      total: null,
      currency: null,
      paymentStatus: null,
      paymentMethod: null,
      shippingMethod: 'AlzaBox',
      invoiceNumber: null,
      shipmentPhase: 'ready_for_pickup',
      confidence: 0.99,
    }),
  ];
}

test('reconstructs internal AlzaBox purchase only after exact 90-day no-purchase proof', () => {
  const [candidate] = resolveAlzaInternalFulfillmentCandidates(chain(), [proof()]);
  assert.ok(candidate);
  assert.equal(candidate.orderNumber, '987654321');
  assert.equal(candidate.total, 3350);
  assert.equal(candidate.shippingMethod, 'AlzaBox');
  assert.equal(candidate.invoiceNumber, 'AHUW261234567');
  assert.deepEqual(new Set(candidate.sourceEmailIds), new Set(['processing', 'delay', 'pickup']));
  assert.ok(candidate.reasons.includes('internal_fulfillment_requires_no_carrier_tracking'));
});

test('does not reconstruct without a 90-day proof', () => {
  assert.equal(resolveAlzaInternalFulfillmentCandidates(chain(), []).length, 0);
});

test('does not reconstruct when proof observed a purchase write', () => {
  assert.equal(resolveAlzaInternalFulfillmentCandidates(chain(), [proof({ purchaseWrites: 1 })]).length, 0);
});

test('does not reconstruct without separate ready-for-pickup evidence', () => {
  assert.equal(resolveAlzaInternalFulfillmentCandidates(chain().filter((row) => row.sourceEmailId !== 'pickup'), [proof()]).length, 0);
});

test('does not reconstruct without separate delayed lifecycle corroboration', () => {
  assert.equal(resolveAlzaInternalFulfillmentCandidates(chain().filter((row) => row.sourceEmailId !== 'delay'), [proof()]).length, 0);
});

test('does not reconstruct when a trusted order_created source exists', () => {
  const rows = [...chain(), evidence({ sourceEmailId: 'order-created', eventType: 'order_created', parserVersion: 'some-order-parser' })];
  assert.equal(resolveAlzaInternalFulfillmentCandidates(rows, [proof()]).length, 0);
});

test('does not reconstruct when an exact Alza purchase already exists', () => {
  const candidates = resolveAlzaInternalFulfillmentCandidates(chain(), [proof()], [{
    userId: 'user-1', merchantDomain: 'alza.hu', orderNumber: '987654321',
  }]);
  assert.equal(candidates.length, 0);
});

test('does not mix evidence between email connections', () => {
  const rows = chain().map((row) => row.sourceEmailId === 'pickup' ? { ...row, emailConnectionId: 'connection-2' } : row);
  assert.equal(resolveAlzaInternalFulfillmentCandidates(rows, [proof()]).length, 0);
});
