import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectShopifyTechnicalEvidenceV1 } from './technical-evidence-shopify-v1.js';

function fixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'opaque-shopify-test',
    receivedAt: '2026-08-23T21:50:00.000Z',
    sender: {
      addresses: [{ email: 'store@example.test' }],
      domains: ['example.test'],
      primaryEmail: 'store@example.test',
      primaryDomain: 'example.test',
      primaryName: 'Example',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Neutral',
    text: '',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [], amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
    ...overrides,
  };
}

const SHOPIFY_HTML_A = `
  <a href="https://merchant-a.example/orders/status">View order</a>
  <img src="https://cdn.shopify.com/s/files/1/product.png" class="order-list__product-image">
  <td class="order-list__product-description-cell">Product</td>
`;

const SHOPIFY_HEADERS_A = [
  { name: 'Received', value: 'from o12.mailer.shopify.com' },
  { name: 'Message-ID', value: '<opaque@shopify.com>' },
  { name: 'Feedback-ID', value: 's_123:shopify' },
];

const SHOPIFY_HEADERS_B = [
  { name: 'Received', value: 'from o19.mailer.shopify.com' },
  { name: 'DKIM-Signature', value: 'v=1; d=t.shopifyemail.com; s=s1' },
  { name: 'Return-Path', value: '<bounce@mailer.t.shopifyemail.com>' },
];

test('native Shopify order confirmation gets merchant-scoped order identity and order event', () => {
  const result = collectShopifyTechnicalEvidenceV1(fixture({
    subject: 'Rendelés (#21946) visszaigazolva',
    text: 'Rendelés: #21946\nKöszönjük, hogy nálunk vásároltál!\nÉrtesítünk majd, ha feladtuk a küldeményt.',
    html: SHOPIFY_HTML_A,
    headers: SHOPIFY_HEADERS_A,
  }));

  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.evidence.some((row) => row.kind === 'platform' && row.normalizedValue === 'Shopify'));
  assert.ok(result.evidence.some((row) => row.kind === 'order_number'
    && row.normalizedValue === '21946'
    && row.namespace === 'MERCHANT:example.test'));
  assert.ok(result.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'order_created'));
  assert.equal(result.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'shipment'), false,
    'future shipment copy in an order confirmation must not become shipment');
});

test('second independent Shopify sender style can scope order through storefront link', () => {
  const result = collectShopifyTechnicalEvidenceV1(fixture({
    sender: {
      addresses: [{ email: 'store+123@t.shopifyemail.com' }],
      domains: ['t.shopifyemail.com'],
      primaryEmail: 'store+123@t.shopifyemail.com',
      primaryDomain: 't.shopifyemail.com',
      primaryName: 'Merchant B',
    },
    subject: 'Rendelés (#32001) visszaigazolva',
    text: 'Rendelés: #32001\nKöszönjük a rendelést.',
    html: `
      <a href="https://merchant-b.example/_t/c/v3/opaque">Rendelés megtekintése</a>
      <img src="https://cdn.shopify.com/s/files/1/product.png" class="order-list__product-image">
      <td class="order-list__product-description-cell">Product</td>
    `,
    headers: SHOPIFY_HEADERS_B,
  }));

  assert.ok(result.evidence.some((row) => row.kind === 'order_number'
    && row.namespace === 'MERCHANT:merchant-b.example'));
  assert.ok(result.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'order_created'));
});

test('native Shopify shipment and delivered templates preserve order identity but do not invent carrier namespace', () => {
  const shipped = collectShopifyTechnicalEvidenceV1(fixture({
    subject: 'Úton van a küldemény (rendelés: #32001)',
    text: 'Rendelés: #32001\nÚton van a rendelésben szereplő összes termék.',
    html: SHOPIFY_HTML_A,
    headers: SHOPIFY_HEADERS_B,
  }));
  assert.ok(shipped.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'shipment'));

  const delivered = collectShopifyTechnicalEvidenceV1(fixture({
    subject: 'Küldemény kézbesítve (rendelés: #32001)',
    text: 'Rendelés: #32001\nKüldemény kézbesítve\nFAMA fuvarlevélszám: 243961796883300013600000',
    html: SHOPIFY_HTML_A,
    headers: SHOPIFY_HEADERS_B,
  }));
  assert.ok(delivered.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'delivery'));
  const tracking = delivered.evidence.find((row) => row.kind === 'tracking_number');
  assert.equal(tracking?.normalizedValue, '243961796883300013600000');
  assert.equal(tracking?.namespace, undefined, 'Shopify must not invent a carrier namespace');
  assert.ok(tracking?.qualifiers.includes('carrier_namespace_required_before_hard_merge'));
});

test('Shopify assets without native authenticated transport grant no lifecycle authority', () => {
  const result = collectShopifyTechnicalEvidenceV1(fixture({
    subject: 'Rendelésed készen áll - #32001',
    text: 'Rendelés: #32001\nA rendelésed sikeresen feldolgoztuk.',
    html: SHOPIFY_HTML_A,
    headers: [
      { name: 'Received', value: 'from smtp-out.eu-west-1.amazonses.com' },
      { name: 'DKIM-Signature', value: 'd=amazonses.com; s=example' },
    ],
  }));
  assert.deepEqual(result.evidence, []);
});

test('authenticated Shopify account/security mail is not commerce TechnicalEvidence', () => {
  const result = collectShopifyTechnicalEvidenceV1(fixture({
    subject: 'New sign-in to your Shopify account',
    text: 'A new device signed in. Review activity.',
    html: '<img src="https://cdn.shopify.com/security.png">',
    headers: SHOPIFY_HEADERS_B,
  }));
  assert.deepEqual(result.evidence, []);
});

test('one Shopify-like signal alone is insufficient', () => {
  const result = collectShopifyTechnicalEvidenceV1(fixture({
    subject: 'Rendelés (#32001) visszaigazolva',
    text: 'Rendelés: #32001',
    html: SHOPIFY_HTML_A,
    headers: [{ name: 'Received', value: 'from o19.mailer.shopify.com' }],
  }));
  assert.deepEqual(result.evidence, []);
});
