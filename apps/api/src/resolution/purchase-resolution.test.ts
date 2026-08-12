import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePurchaseCandidates,
  type ResolutionEvidence,
} from './purchase-resolution.js';

function evidence(
  overrides: Partial<ResolutionEvidence> = {},
): ResolutionEvidence {
  return {
    sourceEmailId: 'email-1',
    userId: 'user-1',
    senderDomain: 'shop.example.com',
    eventType: 'order_created',
    merchant: 'Example Shop',
    orderNumber: 'ORDER-1',
    confidence: 0.9,
    receivedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

test('high-confidence merchant order can create directly', () => {
  const [candidate] = resolvePurchaseCandidates([evidence()]);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'create_direct');
  assert.equal(candidate.confidence, 0.9);
  assert.equal(candidate.userId, 'user-1');
});

test('medium-confidence merchant order becomes create candidate when corroborated', () => {
  const rows: ResolutionEvidence[] = [
    evidence({ confidence: 0.86 }),
    evidence({
      sourceEmailId: 'email-2',
      eventType: 'invoice_or_receipt',
      confidence: 0.91,
      receivedAt: '2026-08-02T10:00:00.000Z',
    }),
    evidence({
      sourceEmailId: 'email-3',
      eventType: 'shipment',
      confidence: 0.84,
      receivedAt: '2026-08-03T10:00:00.000Z',
    }),
  ];

  const [candidate] = resolvePurchaseCandidates(rows);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'create_corroborated');
  assert.equal(candidate.evidenceCount, 3);
  assert.equal(candidate.corroboratingEvidenceCount, 2);
  assert.ok(candidate.confidence > 0.9);
});

test('lifecycle-only email never creates a purchase', () => {
  const [candidate] = resolvePurchaseCandidates([
    evidence({ eventType: 'shipment', confidence: 0.95 }),
  ]);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'lifecycle_only');
});

test('carrier order_created evidence never creates a purchase', () => {
  const [candidate] = resolvePurchaseCandidates([
    evidence({
      senderDomain: 'expressone.hu',
      merchant: 'Express One',
      confidence: 0.99,
    }),
  ]);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'lifecycle_only');
});

test('medium-confidence order without corroboration stays in review', () => {
  const [candidate] = resolvePurchaseCandidates([
    evidence({ confidence: 0.86 }),
  ]);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'review');
});

test('same merchant order number is isolated between users', () => {
  const candidates = resolvePurchaseCandidates([
    evidence({ userId: 'user-1', sourceEmailId: 'email-1' }),
    evidence({ userId: 'user-2', sourceEmailId: 'email-2' }),
  ]);

  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((candidate) => candidate.userId).sort(),
    ['user-1', 'user-2'],
  );
});
