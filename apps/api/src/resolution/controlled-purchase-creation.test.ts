import assert from 'node:assert/strict';
import test from 'node:test';
import { selectControlledPurchaseCandidate } from './controlled-purchase-creation.js';
import type { PurchaseResolutionCandidate } from './purchase-resolution.js';

function candidate(
  overrides: Partial<PurchaseResolutionCandidate> = {},
): PurchaseResolutionCandidate {
  return {
    key: 'user-1::shop.example.com::order-1',
    userId: 'user-1',
    senderDomain: 'shop.example.com',
    merchant: 'Example Shop',
    orderNumber: 'ORDER-1',
    decision: 'create_corroborated',
    confidence: 0.94,
    evidenceCount: 3,
    orderCreatedEvidenceCount: 1,
    corroboratingEvidenceCount: 2,
    reasons: ['order_created_corroborated_by_independent_lifecycle_evidence'],
    sourceEmailIds: ['email-1', 'email-2', 'email-3'],
    ...overrides,
  };
}

test('accepts exactly one strongly corroborated create candidate', () => {
  const selected = selectControlledPurchaseCandidate([candidate()]);
  assert.equal(selected.orderNumber, 'ORDER-1');
});

test('rejects multiple create candidates', () => {
  assert.throws(
    () =>
      selectControlledPurchaseCandidate([
        candidate(),
        candidate({ key: 'user-1::shop.example.com::order-2', orderNumber: 'ORDER-2' }),
      ]),
    /exactly one create candidate/,
  );
});

test('rejects a direct candidate for the first controlled write', () => {
  assert.throws(
    () => selectControlledPurchaseCandidate([candidate({ decision: 'create_direct' })]),
    /must be corroborated/,
  );
});

test('rejects insufficient corroboration', () => {
  assert.throws(
    () =>
      selectControlledPurchaseCandidate([
        candidate({ evidenceCount: 2, corroboratingEvidenceCount: 1 }),
      ]),
    /lacks required corroboration/,
  );
});
