import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { compareCanonicalSnapshots } from '../pipeline/extraction-v2-shadow-comparison.js';
import { universalCarrierExtractor } from './carrier-extractor.js';
import { resolveCommerceEvent } from './field-resolvers.js';
import { universalMerchantExtractor } from './merchant-extractor.js';
import { universalMoneyExtractor } from './money-extractor.js';
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

test('transactional sender display name can resolve merchant while generic sender names stay weak', () => {
  const transactional = buildEmailDocumentV1(email({
    subject: 'Rendelés #AB-12345 visszaigazolása',
    snippet: 'Rendelésszám: AB-12345\nVégösszeg: 12 990 Ft',
    name: 'Sportvision',
  }));
  const claims = universalMerchantExtractor.extract(transactional).filter((item) => item.field === 'merchant');
  const sender = claims.find((item) => item.value === 'Sportvision');
  assert.ok(sender);
  assert.ok((sender?.confidence ?? 0) >= 0.80);
  assert.ok(sender?.qualifiers?.includes('sender_transactional_identity'));

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
