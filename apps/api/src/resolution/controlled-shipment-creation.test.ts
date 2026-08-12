import assert from 'node:assert/strict';
import test from 'node:test';
import { selectControlledShipmentCandidate } from './controlled-shipment-creation.js';
import type { ShipmentResolutionCandidate } from './shipment-resolution.js';

function candidate(overrides: Partial<ShipmentResolutionCandidate> = {}): ShipmentResolutionCandidate {
  return {
    key: 'user::tracking',
    userId: 'user-1',
    trackingNumber: 'TRACK123',
    carrierSlug: 'express-one',
    purchaseId: 'purchase-1',
    decision: 'linkable',
    recommendedStatus: 'delivered',
    confidence: 0.94,
    evidenceCount: 3,
    merchantAnchorCount: 1,
    carrierEvidenceCount: 2,
    reasons: [],
    sourceEmailIds: ['email-1', 'email-2', 'email-3'],
    ...overrides,
  };
}

test('accepts exactly one strongly corroborated linkable shipment', () => {
  const selected = selectControlledShipmentCandidate([candidate()]);
  assert.equal(selected.purchaseId, 'purchase-1');
  assert.equal(selected.trackingNumber, 'TRACK123');
});

test('rejects multiple linkable shipment candidates', () => {
  assert.throws(
    () => selectControlledShipmentCandidate([candidate(), candidate({ key: 'user::other' })]),
    /exactly one linkable shipment candidate/,
  );
});

test('rejects shipment without enough carrier corroboration', () => {
  assert.throws(
    () => selectControlledShipmentCandidate([candidate({ carrierEvidenceCount: 1 })]),
    /insufficient carrier corroboration/,
  );
});

test('rejects shipment without trusted merchant anchor', () => {
  assert.throws(
    () => selectControlledShipmentCandidate([candidate({ merchantAnchorCount: 0 })]),
    /no trusted merchant anchor/,
  );
});

test('rejects ambiguous carrier', () => {
  assert.throws(
    () => selectControlledShipmentCandidate([candidate({ carrierSlug: null })]),
    /no unambiguous carrier/,
  );
});
