import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCommerceEvent, resolveProducts } from './field-resolvers.js';
import type { EvidenceBundle, EvidenceClaim, EvidenceProduct } from './types.js';

function claim<T>(input: {
  field: EvidenceClaim<T>['field'];
  value: T;
  confidence?: number;
  source?: EvidenceClaim<T>['source'];
  qualifier?: string;
}): EvidenceClaim<T> {
  return {
    field: input.field,
    value: input.value,
    confidence: input.confidence ?? 0.99,
    source: input.source ?? 'body',
    extractorId: 'test-extractor',
    extractorVersion: 'test-v1',
    ...(input.qualifier ? { qualifiers: [input.qualifier] } : {}),
  };
}

function bundle(...claims: EvidenceClaim[]): EvidenceBundle {
  return { claims };
}

test('explicit field evidence resolves into a single commerce event', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'order_number', value: 'AB-12345', qualifier: 'explicit_order_label' }),
    claim({ field: 'tracking_number', value: '123456789012', qualifier: 'explicit_tracking_label' }),
    claim({ field: 'total', value: 12990, qualifier: 'explicit_final_total' }),
    claim({ field: 'currency', value: 'HUF', qualifier: 'explicit_final_total' }),
    claim({ field: 'merchant', value: 'Example Store Kft.', qualifier: 'explicit_merchant_label' }),
    claim({ field: 'payment_status', value: 'paid', qualifier: 'explicit_paid_evidence' }),
    claim({ field: 'invoice_number', value: 'INV-2026-1234', qualifier: 'explicit_invoice_label' }),
    claim({ field: 'payment_reference', value: 'TX-998877', qualifier: 'explicit_payment_reference_label' }),
  ));

  assert.equal(result.orderNumber.value, 'AB-12345');
  assert.equal(result.trackingNumber.value, '123456789012');
  assert.equal(result.total.value, 12990);
  assert.equal(result.currency.value, 'HUF');
  assert.equal(result.merchant.value, 'Example Store Kft.');
  assert.equal(result.paymentStatus.value, 'paid');
  assert.equal(result.invoiceNumber.value, 'INV-2026-1234');
  assert.equal(result.paymentReference.value, 'TX-998877');
  assert.equal(result.reviewRequired, false);
  assert.deepEqual(result.conflictFields, []);
});

test('identifier case differences are equivalent and do not create conflict', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'order_number', value: 'ab-12345', qualifier: 'explicit_order_label' }),
    claim({ field: 'order_number', value: 'AB-12345', confidence: 0.98, source: 'subject', qualifier: 'explicit_order_label' }),
  ));

  assert.equal(result.orderNumber.status, 'resolved');
  assert.equal(result.reviewRequired, false);
});

test('two different equally strong explicit order numbers become REVIEW', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'order_number', value: 'AB-12345', qualifier: 'explicit_order_label' }),
    claim({ field: 'order_number', value: 'AB-99999', confidence: 0.98, source: 'subject', qualifier: 'explicit_order_label' }),
  ));

  assert.equal(result.orderNumber.status, 'conflict');
  assert.equal(result.orderNumber.value, null);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.conflictFields, ['order_number']);
});

test('explicit total outranks payment amount and weak document money', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'total', value: 14960, confidence: 0.99, qualifier: 'explicit_final_total' }),
    claim({ field: 'total', value: 14000, confidence: 0.97, qualifier: 'explicit_payment_amount' }),
    claim({ field: 'total', value: 990, confidence: 0.70, source: 'document_structure', qualifier: 'single_unambiguous_money_candidate' }),
  ));

  assert.equal(result.total.status, 'resolved');
  assert.equal(result.total.value, 14960);
  assert.equal(result.reviewRequired, false);
});

test('weak unlabeled money remains evidence but does not finalize total/currency', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'total', value: 7990, confidence: 0.70, source: 'document_structure', qualifier: 'single_unambiguous_money_candidate' }),
    claim({ field: 'currency', value: 'HUF', confidence: 0.70, source: 'document_structure', qualifier: 'single_unambiguous_money_candidate' }),
  ));

  assert.equal(result.total.status, 'missing');
  assert.equal(result.currency.status, 'missing');
  assert.equal(result.reviewRequired, false);
});

test('weak sender display name does not finalize merchant identity', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'merchant', value: 'DPD', confidence: 0.68, source: 'sender', qualifier: 'sender_display_name_fallback' }),
  ));

  assert.equal(result.merchant.status, 'missing');
  assert.equal(result.merchant.value, null);
});

test('explicit merchant outranks sender display fallback', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'merchant', value: 'Courier Robot', confidence: 0.68, source: 'sender', qualifier: 'sender_display_name_fallback' }),
    claim({ field: 'merchant', value: 'MODELL&HOBBY Kft.', confidence: 0.99, qualifier: 'explicit_merchant_label' }),
  ));

  assert.equal(result.merchant.value, 'MODELL&HOBBY Kft.');
});

test('conflicting explicit payment states become REVIEW instead of silent overwrite', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'payment_status', value: 'failed', confidence: 0.995, qualifier: 'explicit_payment_failure' }),
    claim({ field: 'payment_status', value: 'paid', confidence: 0.99, qualifier: 'explicit_paid_evidence' }),
  ));

  assert.equal(result.paymentStatus.status, 'conflict');
  assert.equal(result.reviewRequired, true);
  assert.ok(result.conflictFields.includes('payment_status'));
});

test('multiple distinct products resolve as one product list', () => {
  const first: EvidenceProduct = {
    name: 'Kollagén italpor Mango',
    quantity: 1,
    unitPrice: 9560,
    totalPrice: 9560,
    currency: 'HUF',
  };
  const second: EvidenceProduct = {
    name: 'Shaker 700 ml',
    quantity: 2,
    unitPrice: null,
    totalPrice: null,
    currency: null,
  };

  const result = resolveProducts(bundle(
    claim({ field: 'product', value: first, confidence: 0.98, source: 'document_structure', qualifier: 'document_product_candidate' }),
    claim({ field: 'product', value: second, confidence: 0.97, qualifier: 'explicit_product_block' }),
  ));

  assert.equal(result.status, 'resolved');
  assert.equal(result.value?.length, 2);
  assert.ok(result.value?.some((product) => product.name === 'Kollagén italpor Mango'));
  assert.ok(result.value?.some((product) => product.name === 'Shaker 700 ml'));
});

test('same product can merge complementary equal-rank evidence when non-null fields do not disagree', () => {
  const result = resolveProducts(bundle(
    claim({
      field: 'product',
      value: { name: 'Example Product', quantity: 1, unitPrice: null, totalPrice: null, currency: null },
      confidence: 0.98,
      source: 'document_structure',
      qualifier: 'document_product_candidate',
    }),
    claim({
      field: 'product',
      value: { name: 'example product', quantity: 1, unitPrice: 4990, totalPrice: 4990, currency: 'HUF' },
      confidence: 0.97,
      source: 'document_structure',
      qualifier: 'document_product_candidate',
    }),
  ));

  assert.equal(result.status, 'resolved');
  assert.equal(result.value?.[0]?.quantity, 1);
  assert.equal(result.value?.[0]?.unitPrice, 4990);
  assert.equal(result.value?.[0]?.currency, 'HUF');
});

test('same product with conflicting equally strong quantities becomes REVIEW', () => {
  const result = resolveCommerceEvent(bundle(
    claim({
      field: 'product',
      value: { name: 'Example Product', quantity: 1, unitPrice: null, totalPrice: null, currency: null } as EvidenceProduct,
      confidence: 0.98,
      source: 'document_structure',
      qualifier: 'document_product_candidate',
    }),
    claim({
      field: 'product',
      value: { name: 'example product', quantity: 2, unitPrice: null, totalPrice: null, currency: null } as EvidenceProduct,
      confidence: 0.98,
      source: 'document_structure',
      qualifier: 'document_product_candidate',
    }),
  ));

  assert.equal(result.products.status, 'conflict');
  assert.equal(result.reviewRequired, true);
  assert.ok(result.conflictFields.includes('product'));
});

test('missing event type and carrier are not conflicts while their extractors are not yet present', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'order_number', value: 'AB-12345', qualifier: 'explicit_order_label' }),
  ));

  assert.equal(result.eventType.status, 'missing');
  assert.equal(result.carrier.status, 'missing');
  assert.equal(result.reviewRequired, false);
});
