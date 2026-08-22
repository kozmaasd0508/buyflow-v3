import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentMoneyCandidate, EmailDocumentV1 } from '../ingestion/email-document.js';
import { universalMoneyExtractor } from './money-extractor.js';
import { universalOrderNumberExtractor } from './order-number-extractor.js';
import { universalTrackingNumberExtractor } from './tracking-number-extractor.js';
import { collectUniversalCoreEvidence } from './universal-core.js';

function document(input: {
  subject?: string;
  text?: string;
  orderNumbers?: string[];
  trackingNumbers?: string[];
  amounts?: EmailDocumentMoneyCandidate[];
}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas',
    providerMessageId: 'test-message',
    receivedAt: '2026-08-22T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'shop@example.hu', name: 'Example Shop' }],
      domains: ['example.hu'],
      primaryEmail: 'shop@example.hu',
      primaryDomain: 'example.hu',
      primaryName: 'Example Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: input.subject ?? null,
    text: input.text ?? '',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: input.orderNumbers ?? [],
      amounts: input.amounts ?? [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: input.trackingNumbers ?? [],
    },
  };
}

test('order extractor recognizes explicit Hungarian order labels and numbered-order phrases', () => {
  const labeled = universalOrderNumberExtractor.extract(document({ subject: 'Rendelésszám: SO-2024-30411' }));
  assert.equal(labeled.find((claim) => claim.field === 'order_number')?.value, 'SO-2024-30411');

  const phrase = universalOrderNumberExtractor.extract(document({ text: 'A 3010410391 számú rendelésed már készül.' }));
  assert.equal(phrase.find((claim) => claim.field === 'order_number')?.value, '3010410391');
});

test('order extractor recognizes generic English labels without relying on a merchant', () => {
  const claims = universalOrderNumberExtractor.extract(document({ text: 'Order number: AB-9918274' }));
  const claim = claims.find((item) => item.field === 'order_number');
  assert.equal(claim?.value, 'AB-9918274');
  assert.ok((claim?.confidence ?? 0) >= 0.98);
});

test('order extractor does not invent an order number from promotional language', () => {
  const claims = universalOrderNumberExtractor.extract(document({ subject: 'Rendelés most 20% kedvezménnyel!' }));
  assert.equal(claims.length, 0);
});

test('tracking extractor recognizes labeled and contextual shipment identifiers', () => {
  const labeled = universalTrackingNumberExtractor.extract(document({ text: 'Küldeményazonosító: PB9S650295555' }));
  assert.equal(labeled.find((claim) => claim.field === 'tracking_number')?.value, 'PB9S650295555');

  const contextual = universalTrackingNumberExtractor.extract(document({ subject: 'Értesítés a 3408405568 számú csomag automatába helyezéséről' }));
  assert.equal(contextual.find((claim) => claim.field === 'tracking_number')?.value, '3408405568');
});

test('money extractor emits strong total and currency claims from explicit final-total labels', () => {
  const claims = universalMoneyExtractor.extract(document({ text: 'Bruttó összeg: 7 170Ft' }));
  const total = claims.find((claim) => claim.field === 'total');
  const currency = claims.find((claim) => claim.field === 'currency');
  assert.equal(total?.value, 7170);
  assert.equal(currency?.value, 'HUF');
  assert.ok((total?.confidence ?? 0) >= 0.99);
  assert.ok(total?.qualifiers?.includes('explicit_final_total'));
});

test('money extractor handles payment amount labels and symbol-prefixed EUR values', () => {
  const payment = universalMoneyExtractor.extract(document({ text: 'Tranzakció összege: 14 960 Ft' }));
  assert.equal(payment.find((claim) => claim.field === 'total')?.value, 14960);
  assert.ok(payment.find((claim) => claim.field === 'total')?.qualifiers?.includes('explicit_payment_amount'));

  const euro = universalMoneyExtractor.extract(document({ text: 'Order total: €170.00' }));
  assert.equal(euro.find((claim) => claim.field === 'total')?.value, 170);
  assert.equal(euro.find((claim) => claim.field === 'currency')?.value, 'EUR');
});

test('money extractor only uses unlabeled document money as weak evidence when exactly one candidate exists', () => {
  const single = universalMoneyExtractor.extract(document({
    amounts: [{ amount: 9560, currency: 'HUF', raw: '9 560 Ft' }],
  }));
  const weak = single.find((claim) => claim.field === 'total');
  assert.equal(weak?.value, 9560);
  assert.equal(weak?.confidence, 0.70);
  assert.ok(weak?.qualifiers?.includes('single_unambiguous_money_candidate'));

  const multiple = universalMoneyExtractor.extract(document({
    amounts: [
      { amount: 1190, currency: 'HUF', raw: '1 190 Ft' },
      { amount: 7170, currency: 'HUF', raw: '7 170 Ft' },
    ],
  }));
  assert.equal(multiple.length, 0);
});

test('universal core runs all extractors and accumulates independent field evidence', () => {
  const result = collectUniversalCoreEvidence(document({
    subject: 'Rendelésszám: SO-2024-30411',
    text: [
      'Küldeményazonosító: PB9S650295555',
      'Végösszeg: 9 560 Ft',
    ].join('\n'),
  }));

  assert.deepEqual(result.ranExtractors.map((item) => item.id), [
    'universal-order-number',
    'universal-tracking-number',
    'universal-money',
  ]);
  assert.equal(result.bundle.claims.find((claim) => claim.field === 'order_number')?.value, 'SO-2024-30411');
  assert.equal(result.bundle.claims.find((claim) => claim.field === 'tracking_number')?.value, 'PB9S650295555');
  assert.equal(result.bundle.claims.find((claim) => claim.field === 'total')?.value, 9560);
  assert.equal(result.bundle.claims.find((claim) => claim.field === 'currency')?.value, 'HUF');
});
