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

function invoiceSource(overrides: Partial<CorroboratedDocumentSource> = {}): CorroboratedDocumentSource {
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

function lifecycleSource(overrides: Partial<CorroboratedDocumentSource> = {}): CorroboratedDocumentSource {
  return {
    sourceEmailId: 'shipment-source',
    userId,
    providerMessageId: 'gmail-shipment-1',
    receivedAt: '2026-07-15T06:55:18.000Z',
    validationStatus: 'validated',
    eventType: 'shipment',
    orderNumber: '3010228912',
    invoiceNumber: null,
    confidence: 0.86,
    ...overrides,
  };
}

function invoiceLink(overrides: Partial<CorroboratedDocumentLink> = {}): CorroboratedDocumentLink {
  return {
    purchaseId,
    sourceEmailId: 'invoice-source',
    relationType: 'invoice_or_receipt',
    confidence: 0.67,
    ...overrides,
  };
}

function lifecycleLink(overrides: Partial<CorroboratedDocumentLink> = {}): CorroboratedDocumentLink {
  return {
    purchaseId,
    sourceEmailId: 'shipment-source',
    relationType: 'shipment',
    confidence: 0.86,
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

function standardSources(invoiceOverrides: Partial<CorroboratedDocumentSource> = {}) {
  return [invoiceSource(invoiceOverrides), lifecycleSource({ orderNumber: invoiceOverrides.orderNumber ?? '3010228912' })];
}

function standardLinks(invoiceOverrides: Partial<CorroboratedDocumentLink> = {}) {
  return [invoiceLink(invoiceOverrides), lifecycleLink()];
}

test('0.67 validated GymBeam invoice becomes a corroborated document candidate after exact purchase and lifecycle linking', () => {
  const candidates = resolveCorroboratedDocumentCandidates(standardSources(), standardLinks(), [purchase()]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.documentNumber, '4008874007');
  assert.equal(candidates[0]?.documentType, 'invoice');
});

test('0.78 validated invoice also remains inside corroborated lane', () => {
  const candidates = resolveCorroboratedDocumentCandidates(
    [
      invoiceSource({ orderNumber: '3010206178', invoiceNumber: '4008874475', confidence: 0.78 }),
      lifecycleSource({ orderNumber: '3010206178', confidence: 0.78 }),
    ],
    [invoiceLink({ confidence: 0.78 }), lifecycleLink({ confidence: 0.78 })],
    [purchase({ orderNumber: '3010206178' })],
  );
  assert.equal(candidates.length, 1);
});

test('invoice link without independent purchase lifecycle support is rejected', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [invoiceSource()],
    [invoiceLink()],
    [purchase()],
  ), []);
});

test('weak or mismatched lifecycle support is rejected', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    standardSources(),
    [invoiceLink(), lifecycleLink({ confidence: 0.69 })],
    [purchase()],
  ), []);
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [invoiceSource(), lifecycleSource({ eventType: 'delivery' })],
    standardLinks(),
    [purchase()],
  ), []);
});

test('0.85 and above stays on the existing normal document gate', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    standardSources({ confidence: 0.9 }),
    standardLinks({ confidence: 0.9 }),
    [purchase()],
  ), []);
});

test('confidence below 0.65 is rejected', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    standardSources({ confidence: 0.64 }),
    standardLinks({ confidence: 0.64 }),
    [purchase()],
  ), []);
});

test('guardrailed invoice is rejected from lower-confidence document lane', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    standardSources({ validationStatus: 'guardrailed' }),
    standardLinks(),
    [purchase()],
  ), []);
});

test('guardrailed independent shipment support is allowed', () => {
  const candidates = resolveCorroboratedDocumentCandidates(
    [invoiceSource(), lifecycleSource({ validationStatus: 'guardrailed' })],
    standardLinks(),
    [purchase()],
  );
  assert.equal(candidates.length, 1);
});

test('exact normalized order identity is mandatory', () => {
  assert.equal(resolveCorroboratedDocumentCandidates(
    [invoiceSource({ orderNumber: '#3010228912' }), lifecycleSource()],
    standardLinks(),
    [purchase({ orderNumber: '3010228912' })],
  ).length, 1);

  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [invoiceSource({ orderNumber: '3010206178' }), lifecycleSource()],
    standardLinks(),
    [purchase({ orderNumber: '3010228912' })],
  ), []);
});

test('short receipt-like identifiers and missing invoice number are rejected', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    [invoiceSource({ orderNumber: '6383' }), lifecycleSource({ orderNumber: '6383' })],
    standardLinks(),
    [purchase({ orderNumber: '6383' })],
  ), []);
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    standardSources({ invoiceNumber: null }),
    standardLinks(),
    [purchase()],
  ), []);
});

test('invoice source must already be linked to the purchase with sufficient confidence', () => {
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    standardSources(),
    [invoiceLink({ relationType: 'shipment' }), lifecycleLink()],
    [purchase()],
  ), []);
  assert.deepEqual(resolveCorroboratedDocumentCandidates(
    standardSources(),
    [invoiceLink({ confidence: 0.4 }), lifecycleLink()],
    [purchase()],
  ), []);
});

test('existing invoice by provider message or invoice number is idempotently skipped', () => {
  const sources = standardSources();
  const links = standardLinks();
  const purchases = [purchase()];
  assert.deepEqual(resolveCorroboratedDocumentCandidates(sources, links, purchases, [{
    purchaseId,
    providerMessageId: 'gmail-message-1',
    type: 'invoice',
    documentNumber: 'other-number',
  }]), []);
  assert.deepEqual(resolveCorroboratedDocumentCandidates(sources, links, purchases, [{
    purchaseId,
    providerMessageId: 'other-message',
    type: 'invoice',
    documentNumber: '4008874007',
  }]), []);
});
