import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { compareCanonicalSnapshots } from '../pipeline/extraction-v2-shadow-comparison.js';
import { universalCarrierExtractor } from './carrier-extractor.js';
import { universalEventTypeExtractor } from './event-type-extractor.js';
import { resolveCommerceEvent } from './field-resolvers.js';
import { universalMerchantExtractor } from './merchant-extractor.js';
import { universalMoneyExtractor } from './money-extractor.js';
import { universalOrderNumberExtractor } from './order-number-extractor.js';
import { universalPaymentStatusExtractor } from './payment-status-extractor.js';
import { universalProductExtractor } from './product-extractor.js';
import type { EvidenceBundle, EvidenceClaim } from './types.js';

function email(input: { subject?: string; snippet: string; name?: string }): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `hardening-${Math.random()}`,
    subject: input.subject ?? 'Értesítés',
    from: [{ email: 'orders@example-shop.hu', name: input.name ?? 'Example Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T22:00:00.000Z',
    snippet: input.snippet,
    folders: ['inbox'],
    attachments: [],
  };
}

function claim<T>(input: {
  field: EvidenceClaim<T>['field'];
  value: T;
  confidence?: number;
  qualifier?: string;
}): EvidenceClaim<T> {
  return {
    field: input.field,
    value: input.value,
    confidence: input.confidence ?? 0.99,
    source: 'body',
    extractorId: 'test',
    extractorVersion: 'test-v1',
    ...(input.qualifier ? { qualifiers: [input.qualifier] } : {}),
  };
}

function bundle(...claims: EvidenceClaim[]): EvidenceBundle {
  return { claims };
}

test('product extractor rejects quantity-prefixed rows whose product name is only a money value', () => {
  const document = buildEmailDocumentV1(email({ snippet: '1 x 1 830,00 Ft\n1 x 1 855,00 Ft' }));
  const products = universalProductExtractor.extract(document).filter((item) => item.field === 'product');
  assert.equal(products.length, 0);
});

test('carrier extractor ignores bare courier brand mentions without transport context', () => {
  const document = buildEmailDocumentV1(email({
    snippet: 'Partnereink között megtalálható a UPS, a DPD és a GLS is. Tekintsd meg ajánlatainkat!',
  }));
  const carriers = universalCarrierExtractor.extract(document).filter((item) => item.field === 'carrier');
  assert.equal(carriers.length, 0);
});

test('carrier extractor keeps courier evidence when the brand appears in shipment context', () => {
  const document = buildEmailDocumentV1(email({
    snippet: 'A csomagod kiszállítását az Express One futárszolgálat végzi.',
  }));
  const carriers = universalCarrierExtractor.extract(document).filter((item) => item.field === 'carrier');
  assert.ok(carriers.some((item) => item.value === 'Express One'));
});

test('incidental carrier context stays evidence-only and does not finalize a carrier on marketing mail', () => {
  const document = buildEmailDocumentV1(email({
    subject: '100 db prémium fénykép akció',
    snippet: 'Rendeld meg ma. Foxpost szállítás is választható az akcióban.',
  }));
  const evidence = universalCarrierExtractor.extract(document);
  assert.ok(evidence.some((item) => item.value === 'Foxpost'));
  const result = resolveCommerceEvent({ claims: evidence });
  assert.equal(result.carrier.status, 'missing');
});

test('structured shipping method can resolve an explicitly selected carrier', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Megrendelés visszaigazolása #130354',
    snippet: 'Szállítási mód: GLS futárszolgálat',
  }));
  const evidence = universalCarrierExtractor.extract(document);
  assert.ok(evidence.some((item) => item.value === 'GLS' && item.confidence >= 0.95));
  const result = resolveCommerceEvent({ claims: evidence });
  assert.equal(result.carrier.value, 'GLS');
});

test('commercial sender display name can resolve merchant while generic sender names stay weak', () => {
  const transactional = buildEmailDocumentV1(email({
    subject: 'Rendelés #AB-12345 visszaigazolása',
    snippet: 'Rendelésszám: AB-12345\nVégösszeg: 12 990 Ft',
    name: 'Sportvision',
  }));
  const claims = universalMerchantExtractor.extract(transactional).filter((item) => item.field === 'merchant');
  const sender = claims.find((item) => item.value === 'Sportvision');
  assert.ok(sender);
  assert.ok((sender?.confidence ?? 0) >= 0.80);
  assert.ok(sender?.qualifiers?.includes('sender_commercial_identity'));

  const generic = buildEmailDocumentV1(email({
    subject: 'Heti hírek',
    snippet: 'Újdonságok és ajánlatok.',
    name: 'Example Shop',
  }));
  const genericSender = universalMerchantExtractor.extract(generic).find((item) => item.value === 'Example Shop');
  assert.ok((genericSender?.confidence ?? 0) < 0.80);
});

test('money extractor binds total to the amount after the total label on a mixed line', () => {
  const document = buildEmailDocumentV1(email({
    snippet: 'Szállítás: 990 Ft · Végösszeg: 14 758 Ft',
  }));
  const totals = universalMoneyExtractor.extract(document).filter((item) => item.field === 'total');
  assert.ok(totals.some((item) => item.value === 14758 && item.qualifiers?.includes('explicit_final_total')));
  assert.ok(!totals.some((item) => item.value === 990 && item.qualifiers?.includes('explicit_final_total')));
});

test('final total outranks product subtotal instead of becoming a conflict', () => {
  const document = buildEmailDocumentV1(email({
    snippet: 'Termékek összesen: 13 258 Ft\nVégösszeg: 14 758 Ft',
  }));
  const evidence = universalMoneyExtractor.extract(document);
  assert.ok(evidence.some((item) => item.field === 'total' && item.value === 13258 && item.qualifiers?.includes('explicit_intermediate_total')));
  assert.ok(evidence.some((item) => item.field === 'total' && item.value === 14758 && item.qualifiers?.includes('explicit_final_total')));
  const result = resolveCommerceEvent({ claims: evidence });
  assert.equal(result.total.status, 'resolved');
  assert.equal(result.total.value, 14758);
  assert.equal(result.reviewRequired, false);
});

test('bare generic total remains usable when no stronger final-total label exists', () => {
  const document = buildEmailDocumentV1(email({ snippet: 'Összesen: 7 170 Ft' }));
  const evidence = universalMoneyExtractor.extract(document);
  const result = resolveCommerceEvent({ claims: evidence });
  assert.equal(result.total.value, 7170);
  assert.equal(result.currency.value, 'HUF');
});

test('order extractor recognizes Hungarian adjectival order-number labels', () => {
  const document = buildEmailDocumentV1(email({
    snippet: 'Rendelési szám: 130354\nMegrendelési azonosító: AB-9918274',
  }));
  const orders = universalOrderNumberExtractor.extract(document).filter((item) => item.field === 'order_number');
  assert.ok(orders.some((item) => item.value === '130354' && item.qualifiers?.includes('explicit_order_label')));
  assert.ok(orders.some((item) => item.value === 'AB-9918274' && item.qualifiers?.includes('explicit_order_label')));
});

test('order extractor recognizes confirmation subjects with a trailing hash id', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Megrendelés visszaigazolása #130354',
    snippet: 'Köszönjük a megrendelést.',
  }));
  const orders = universalOrderNumberExtractor.extract(document).filter((item) => item.field === 'order_number');
  assert.ok(orders.some((item) => item.value === '130354'));
});

test('payment extractor resolves COD when payment method label and value are split across lines', () => {
  const document = buildEmailDocumentV1(email({
    snippet: 'Fizetési mód:\nUtánvét',
  }));
  const payments = universalPaymentStatusExtractor.extract(document).filter((item) => item.field === 'payment_status');
  assert.ok(payments.some((item) => item.value === 'cash_on_delivery' && item.confidence >= 0.95));
  const result = resolveCommerceEvent({ claims: payments });
  assert.equal(result.paymentStatus.value, 'cash_on_delivery');
});

test('refund-request feedback survey is not proof that a refund completed', () => {
  const document = buildEmailDocumentV1(email({
    subject: '[Refund request] Share your feedback with us',
    snippet: 'We would love to hear how we did on your recent request. How would you rate our support?',
  }));
  const events = universalEventTypeExtractor.extract(document).filter((item) => item.field === 'event_type');
  assert.ok(!events.some((item) => item.value === 'refund'));
});

test('carrier-only conflict remains diagnostic but does not create REVIEW without a transactional anchor', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'carrier', value: 'DPD', confidence: 0.99, qualifier: 'explicit_carrier_label' }),
    claim({ field: 'carrier', value: 'GLS', confidence: 0.99, qualifier: 'explicit_carrier_label' }),
  ));
  assert.equal(result.carrier.status, 'conflict');
  assert.ok(result.conflictFields.includes('carrier'));
  assert.equal(result.reviewRequired, false);
});

test('carrier conflict creates REVIEW when a transactional identity anchor exists', () => {
  const result = resolveCommerceEvent(bundle(
    claim({ field: 'tracking_number', value: '123456789012', qualifier: 'explicit_tracking_label' }),
    claim({ field: 'carrier', value: 'DPD', confidence: 0.99, qualifier: 'explicit_carrier_label' }),
    claim({ field: 'carrier', value: 'GLS', confidence: 0.99, qualifier: 'explicit_carrier_label' }),
  ));
  assert.equal(result.reviewRequired, true);
});

test('shadow comparison treats empty legacy product arrays as missing', () => {
  const base = {
    eventType: null,
    merchant: null,
    orderNumber: null,
    total: null,
    currency: null,
    carrier: null,
    trackingNumber: null,
    paymentStatus: null,
    invoiceNumber: null,
    paymentReference: null,
    products: [],
  };
  const fields = compareCanonicalSnapshots({
    legacy: base,
    v2: { ...base, products: null },
  });
  assert.equal(fields.find((field) => field.field === 'products')?.status, 'both_missing');
});
