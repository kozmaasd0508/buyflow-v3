import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInvoiceAttachmentPurchase } from './invoice-attachment-resolution.js';

const purchase = {
  purchaseId: 'purchase-1',
  userId: 'user-1',
  merchantDomain: 'jatekbolt.hu',
  orderNumber: '12247833',
};

test('links only exact user merchant and normalized order identity', () => {
  const result = resolveInvoiceAttachmentPurchase({
    userId: 'user-1',
    senderDomain: 'jatekbolt.hu',
    orderNumber: '12247833',
    purchases: [purchase],
  });

  assert.equal(result.decision, 'linkable');
  assert.equal(result.purchaseId, 'purchase-1');
});

test('does not link the same order number from another sender domain', () => {
  const result = resolveInvoiceAttachmentPurchase({
    userId: 'user-1',
    senderDomain: 'attacker.example',
    orderNumber: '12247833',
    purchases: [purchase],
  });

  assert.equal(result.decision, 'unmatched');
  assert.equal(result.purchaseId, null);
});

test('does not mix users', () => {
  const result = resolveInvoiceAttachmentPurchase({
    userId: 'user-2',
    senderDomain: 'jatekbolt.hu',
    orderNumber: '12247833',
    purchases: [purchase],
  });

  assert.equal(result.decision, 'unmatched');
});

test('multiple exact purchase identities stay in review instead of guessing', () => {
  const result = resolveInvoiceAttachmentPurchase({
    userId: 'user-1',
    senderDomain: 'jatekbolt.hu',
    orderNumber: '12247833',
    purchases: [purchase, { ...purchase, purchaseId: 'purchase-2' }],
  });

  assert.equal(result.decision, 'review');
  assert.equal(result.purchaseId, null);
});
