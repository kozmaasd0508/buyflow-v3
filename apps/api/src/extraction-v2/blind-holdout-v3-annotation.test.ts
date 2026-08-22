import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT,
  BLIND_HOLDOUT_V3_SELECTION_CUTOFF,
  blindHoldoutV3CaseId,
  freezeBlindHoldoutV3Truth,
} from './blind-holdout-v3-annotation.js';
import type { BlindHoldoutV3TruthCase } from './blind-holdout-v3.js';

function truthCase(caseId: string, eventType = 'order_created'): BlindHoldoutV3TruthCase {
  return {
    caseId,
    isCommerceEvent: true,
    fields: {
      eventType: { state: 'known', value: eventType },
      merchant: { state: 'known', value: 'Example Shop' },
      orderNumber: { state: 'known', value: 'ORD-12345' },
      total: { state: 'known', value: 14960 },
      currency: { state: 'known', value: 'HUF' },
      carrier: { state: 'unknown' },
      trackingNumber: { state: 'not_applicable' },
      paymentStatus: { state: 'unknown' },
      invoiceNumber: { state: 'not_applicable' },
      paymentReference: { state: 'not_applicable' },
      products: { state: 'unknown' },
    },
  };
}

test('case ids are deterministic opaque hashes and bind user plus provider message', () => {
  const first = blindHoldoutV3CaseId('user-1', 'message-1');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, blindHoldoutV3CaseId('user-1', 'message-1'));
  assert.notEqual(first, blindHoldoutV3CaseId('user-1', 'message-2'));
  assert.notEqual(first, blindHoldoutV3CaseId('user-2', 'message-1'));
  assert.ok(!first.includes('message-1'));
});

test('freeze output is deterministic regardless of input case ordering', () => {
  const a = truthCase('a'.repeat(64));
  const b = truthCase('b'.repeat(64), 'shipment');
  const first = freezeBlindHoldoutV3Truth([b, a]);
  const second = freezeBlindHoldoutV3Truth([a, b]);
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.equal(first.truthSha256, second.truthSha256);
  assert.equal(first.bundle.candidateFreezeCommit, BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT);
  assert.equal(first.bundle.selectionCutoff, BLIND_HOLDOUT_V3_SELECTION_CUTOFF);
  assert.deepEqual(first.bundle.truth.map((item) => item.caseId), [a.caseId, b.caseId]);
});

test('freeze strips surrounding whitespace from known string values', () => {
  const item = truthCase('c'.repeat(64));
  item.fields.merchant = { state: 'known', value: '  Example Shop  ' };
  const frozen = freezeBlindHoldoutV3Truth([item]);
  assert.deepEqual(frozen.bundle.truth[0]?.fields.merchant, { state: 'known', value: 'Example Shop' });
});

test('freeze rejects duplicate, malformed, or incomplete truth cases', () => {
  const item = truthCase('d'.repeat(64));
  assert.throws(() => freezeBlindHoldoutV3Truth([item, item]), /duplicate_truth_case_id/);
  assert.throws(() => freezeBlindHoldoutV3Truth([{ ...item, caseId: 'raw-message-id' }]), /invalid_case_id/);
  const invalid = structuredClone(item) as any;
  delete invalid.fields.trackingNumber;
  assert.throws(() => freezeBlindHoldoutV3Truth([invalid]), /invalid_expectation:trackingNumber/);
});

test('freeze rejects unsupported known lifecycle values instead of silently accepting them', () => {
  const item = truthCase('e'.repeat(64));
  item.fields.eventType = { state: 'known', value: 'processing' };
  assert.throws(() => freezeBlindHoldoutV3Truth([item]), /invalid_known_value:eventType/);
});
