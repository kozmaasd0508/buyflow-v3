import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveShipmentCandidates,
  type ShipmentPurchaseIdentity,
  type ShipmentResolutionEvidence,
} from './shipment-resolution.js';

function purchase(
  overrides: Partial<ShipmentPurchaseIdentity> = {},
): ShipmentPurchaseIdentity {
  return {
    purchaseId: 'purchase-1',
    userId: 'user-1',
    merchantDomain: 'service.shop.example',
    orderNumber: 'ORDER-1',
    ...overrides,
  };
}

function evidence(
  overrides: Partial<ShipmentResolutionEvidence> = {},
): ShipmentResolutionEvidence {
  return {
    sourceEmailId: 'email-1',
    userId: 'user-1',
    senderDomain: 'service.shop.example',
    eventType: 'shipment',
    merchant: 'Example Shop',
    orderNumber: 'ORDER-1',
    trackingNumber: 'TRACK-123',
    carrier: 'Express One',
    confidence: 0.86,
    receivedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

test('merchant order anchor links carrier lifecycle evidence by the same tracking number', () => {
  const rows: ShipmentResolutionEvidence[] = [
    evidence(),
    evidence({
      sourceEmailId: 'email-2',
      senderDomain: 'ertesites@expressone.hu'.split('@')[1]!,
      merchant: null,
      orderNumber: null,
      confidence: 0.9,
      receivedAt: '2026-08-02T10:00:00.000Z',
    }),
    evidence({
      sourceEmailId: 'email-3',
      senderDomain: 'expressone.hu',
      eventType: 'delivery',
      merchant: null,
      orderNumber: null,
      confidence: 0.92,
      receivedAt: '2026-08-03T10:00:00.000Z',
    }),
  ];

  const [candidate] = resolveShipmentCandidates([purchase()], rows);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'linkable');
  assert.equal(candidate.purchaseId, 'purchase-1');
  assert.equal(candidate.evidenceCount, 3);
  assert.equal(candidate.carrierEvidenceCount, 2);
  assert.equal(candidate.recommendedStatus, 'delivered');
});

test('tracking-only carrier evidence never guesses a purchase', () => {
  const [candidate] = resolveShipmentCandidates(
    [purchase()],
    [
      evidence({
        senderDomain: 'dpd.hu',
        merchant: null,
        orderNumber: null,
        carrier: 'DPD',
      }),
    ],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
  assert.equal(candidate.purchaseId, null);
});

test('order-like identifiers in carrier email cannot anchor a purchase', () => {
  const [candidate] = resolveShipmentCandidates(
    [purchase({ merchantDomain: 'expressone.hu', orderNumber: '769927' })],
    [
      evidence({
        senderDomain: 'expressone.hu',
        merchant: null,
        orderNumber: '769927',
        trackingNumber: '769927',
      }),
    ],
  );

  assert.ok(candidate);
  assert.equal(candidate.decision, 'unmatched');
});

test('shipment matching is isolated between users', () => {
  const candidates = resolveShipmentCandidates(
    [
      purchase(),
      purchase({
        purchaseId: 'purchase-2',
        userId: 'user-2',
      }),
    ],
    [
      evidence(),
      evidence({
        sourceEmailId: 'email-user-2',
        userId: 'user-2',
      }),
    ],
  );

  assert.equal(candidates.length, 2);
  assert.equal(
    candidates.find((row) => row.userId === 'user-1')?.purchaseId,
    'purchase-1',
  );
  assert.equal(
    candidates.find((row) => row.userId === 'user-2')?.purchaseId,
    'purchase-2',
  );
});

test('same tracking anchored to multiple purchases is sent to review', () => {
  const candidates = resolveShipmentCandidates(
    [
      purchase(),
      purchase({
        purchaseId: 'purchase-2',
        merchantDomain: 'other.shop.example',
        orderNumber: 'ORDER-2',
      }),
    ],
    [
      evidence(),
      evidence({
        sourceEmailId: 'email-2',
        senderDomain: 'other.shop.example',
        merchant: 'Other Shop',
        orderNumber: 'ORDER-2',
      }),
    ],
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.decision, 'review');
  assert.equal(candidates[0]?.purchaseId, null);
});
