import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCorroboratedDocumentCandidates,
  type CorroboratedDocumentLink,
  type CorroboratedDocumentPurchase,
  type CorroboratedDocumentSource,
} from './corroborated-document-resolution.js';

const userId = 'user-1';
const purchaseId = 'purchase-1';

function source(overrides: Partial<CorroboratedDocumentSource> = {}): CorroboratedDocumentSource {
  return {
    sourceEmailId: 'invoice-source',
    userId,
    providerMessageId: 'gmail-message-1',
    receivedAt: '2026-07-16T17:46:26.000Z',
    validationStatus: 'validated',
    eventType: 'invoice_or_receipt',
    orderNumber: '3010228912',
    invoiceNumber: '4008874007',
    confidence: 0.67,
    ...overrides,
  };
}

function link(overrides: Partial<CorroboratedDocumentLink> = {}): CorroboratedDocumentLink {
  return {
    purchaseId,
    sourceEmailId: 'invoice-source',
    relationType: 'invoice_or_receipt',
    confidence: 0.67,
    ...overrides,
  };
}

function purchase(overrides: Partial<CorroboratedDocumentPurchase> = {}): CorroboratedDocumentPurchase {
  return {
    purchaseId,
    userId,
    orderNumber: '3010228912',
    ...overrides,
  };
}

test('0.67 validated GymBeam invoice becomes a corroborated document candidate after exact purchase linking', () => {
  const candidates = resolveCorroboratedDocumentCandidates([source()], [link()], [purchase()]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.documentNumber, '4008874007');
  assert.equal(candidates[0]?.documentType, 'invoice');
});

test('0.78 validated invoice also remains inside corroborated lane', () => {
  const candidates = resolveCorroboratedDocumentCandidates(
    [source({ orderNumber: '3010206178', invoiceNumber: '4008874475', confidence: 0.78 })],
    [link({ confidence: 0.78 })],
    [purchase({ orderNumber: '3010206178' })],
  );
  assert.equal(candidates.length, 1);
});

test('0.85 and above stays on the existing normal document gate', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source({ confidence: 0.9 })],
    [link({ confidence: 0.9 })],
    [purchase()],
  ), []);
});

test('confidence below 0.65 is rejected', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source({ confidence: 0.64 })],
    [link({ confidence: 0.64 })],
    [purchase()],
  ), []);
});

test('guardrailed invoice is rejected from lower-confidence document lane', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source({ validationStatus: 'guardrailed' })],
    [link()],
    [purchase()],
  ), []);
});

test('exact normalized order identity is mandatory', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source({ orderNumber: '#3010228912' })],
    [link()],
    [purchase({ orderNumber: '3010228912' })],
  ).length, 1);

  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source({ orderNumber: '3010206178' })],
    [link()],
    [purchase({ orderNumber: '3010228912' })],
  ), []);
});

test('short receipt-like identifiers and missing invoice number are rejected', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source({ orderNumber: '6383' })],
    [link()],
    [purchase({ orderNumber: '6383' })],
  ), []);
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source({ invoiceNumber: null })],
    [link()],
    [purchase()],
  ), []);
});

test('source must already be linked to the purchase with sufficient confidence', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source()],
    [link({ relationType: 'shipment' })],
    [purchase()],
  ), []);
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [source()],
    [link({ confidence: 0.4 })],
    [purchase()],
  ), []);
});

test('existing invoice by provider message or invoice number is idempotently skipped', () => {
  const base = [source()];
  const links = [link()];
  const purchases = [purchase()];
  assert.deepEqual(resolveCorroboratedDocumentCandidates(base, links, purchases, [{
    purchaseId,
    providerMessageId: 'gmail-message-1',
    type: 'invoice',
    documentNumber: 'other-number',
  }]), []);
  assert.deepEqual(resolveCorroboratedDocumentCandidates(base, links, purchases, [{
    purchaseId,
    providerMessageId: 'other-message',
    type: 'invoice',
    documentNumber: '4008874007',
  }]), []);
});
