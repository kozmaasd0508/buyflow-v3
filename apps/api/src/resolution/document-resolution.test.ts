import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveDocumentCandidates,
  type DocumentPurchaseIdentity,
  type DocumentResolutionEvidence,
} from './document-resolution.js';

const purchase: DocumentPurchaseIdentity = {
  purchaseId: 'purchase-1',
  userId: 'user-1',
  merchantDomain: 'service.gymbeam.hu',
  orderNumber: '3010354660',
};

function evidence(overrides: Partial<DocumentResolutionEvidence> = {}): DocumentResolutionEvidence {
  return {
    sourceEmailId: 'email-1',
    userId: 'user-1',
    senderDomain: 'service.gymbeam.hu',
    eventType: 'invoice_or_receipt',
    orderNumber: '3010354660',
    invoiceNumber: '4008987362',
    confidence: 0.9,
    receivedAt: '2026-08-10T09:20:48Z',
    ...overrides,
  };
}

test('links an invoice only on exact user, merchant domain and order identity', () => {
  const [candidate] = resolveDocumentCandidates([purchase], [evidence()]);
  assert.equal(candidate?.decision, 'linkable');
  assert.equal(candidate?.purchaseId, 'purchase-1');
  assert.equal(candidate?.documentType, 'invoice');
});

test('does not attach a receipt to an unrelated purchase', () => {
  const [candidate] = resolveDocumentCandidates(
    [purchase],
    [evidence({ senderDomain: 'google.com', orderNumber: 'SOP.123', invoiceNumber: null })],
  );
  assert.equal(candidate?.decision, 'unmatched');
  assert.equal(candidate?.purchaseId, null);
});

test('document without order number never guesses a purchase', () => {
  const [candidate] = resolveDocumentCandidates(
    [purchase],
    [evidence({ orderNumber: null, invoiceNumber: 'RX-1', senderDomain: 'stripe.com' })],
  );
  assert.equal(candidate?.decision, 'unmatched');
  assert.deepEqual(candidate?.reasons, ['missing_order_number']);
});

test('document resolution is isolated between users', () => {
  const [candidate] = resolveDocumentCandidates(
    [purchase],
    [evidence({ userId: 'user-2' })],
  );
  assert.equal(candidate?.decision, 'unmatched');
});

test('low-confidence identity match is held for review', () => {
  const [candidate] = resolveDocumentCandidates(
    [purchase],
    [evidence({ confidence: 0.8 })],
  );
  assert.equal(candidate?.decision, 'review');
  assert.equal(candidate?.purchaseId, 'purchase-1');
});

test('ambiguous duplicate purchase identity is held for review', () => {
  const duplicate = { ...purchase, purchaseId: 'purchase-2' };
  const [candidate] = resolveDocumentCandidates([purchase, duplicate], [evidence()]);
  assert.equal(candidate?.decision, 'review');
  assert.equal(candidate?.purchaseId, null);
});
