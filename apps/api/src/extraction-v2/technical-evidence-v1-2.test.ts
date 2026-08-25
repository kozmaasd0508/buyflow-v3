import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import {
  collectTechnicalEvidenceV12,
  extractPlatformSemanticEvidenceV12,
  extractProviderHeaderEvidenceV12,
  extractQualifiedUrlEvidenceV12,
  summarizeTechnicalEvidenceV12,
} from './technical-evidence-v1-2.js';

function documentFixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas' as EmailDocumentV1['provider'],
    providerMessageId: 'opaque-v12-test-message',
    receivedAt: '2026-08-23T21:30:00.000Z',
    sender: {
      addresses: [],
      domains: ['example.test'],
      primaryEmail: null,
      primaryDomain: 'example.test',
      primaryName: null,
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

function contains(rows: ReturnType<typeof collectTechnicalEvidenceV12>['evidence'], kind: string, value: string): boolean {
  return rows.some((row) => row.kind === kind && row.normalizedValue === value);
}

test('UNAS exact order generator is order evidence but status generator is not', () => {
  const order = extractPlatformSemanticEvidenceV12(documentFixture({
    headers: [{ name: 'X-Mailer', value: 'Unas MAIL /shop_order_send.php 98691' }],
  }));
  const status = extractPlatformSemanticEvidenceV12(documentFixture({
    headers: [{ name: 'X-Mailer', value: 'Unas MAIL /admin_order_det.php 98691' }],
  }));

  assert.ok(order.some((row) => row.kind === 'platform' && row.normalizedValue === 'UNAS'));
  assert.ok(order.some((row) => row.kind === 'event' && row.normalizedValue === 'order_created'));
  assert.equal(order.some((row) => row.kind === 'order_number'), false, 'trailing UNAS shop/account id must never become order id');
  assert.ok(status.some((row) => row.kind === 'platform' && row.normalizedValue === 'UNAS'));
  assert.equal(status.some((row) => row.kind === 'event'), false);
});

test('WooCommerce structural evidence types Order # only when multiple DOM primitives agree', () => {
  const positive = extractPlatformSemanticEvidenceV12(documentFixture({
    text: 'Order #19997\nProduct\nQuantity\nPrice',
    html: '<span class="woocommerce-Price-amount amount">3990 <span class="woocommerce-Price-currencySymbol">Ft</span></span>',
  }));
  const weak = extractPlatformSemanticEvidenceV12(documentFixture({
    text: 'Order #19997',
    html: '<div>ordinary message</div>',
  }));

  assert.ok(positive.some((row) => row.kind === 'order_number' && row.normalizedValue === '19997'));
  assert.equal(positive.some((row) => row.kind === 'event'), false, 'order table identity does not prove current lifecycle event');
  assert.equal(weak.some((row) => row.kind === 'order_number'), false);
});

test('Shopify requires multiple independent platform fingerprints and grants no event authority', () => {
  const positive = extractPlatformSemanticEvidenceV12(documentFixture({
    headers: [
      { name: 'Received', value: 'from o12.mailer.shopify.com' },
      { name: 'Message-ID', value: '<opaque@shopify.com>' },
      { name: 'Feedback-Id', value: 's_123:shopify' },
    ],
    html: '<img class="order-list__product-image">',
  }));
  const weak = extractPlatformSemanticEvidenceV12(documentFixture({
    headers: [{ name: 'Received', value: 'from mailer.shopify.com' }],
  }));

  assert.ok(positive.some((row) => row.kind === 'platform' && row.normalizedValue === 'Shopify'));
  assert.equal(positive.some((row) => row.kind === 'event'), false);
  assert.equal(weak.some((row) => row.kind === 'platform' && row.normalizedValue === 'Shopify'), false);
});

test('MPL ids alias is tracking only on official Posta tracking endpoint', () => {
  const positive = extractQualifiedUrlEvidenceV12(documentFixture({
    html: '<a href="https://posta.hu/nyomkovetes/nyitooldal?ids=PB9S650307180">track</a>',
  }));
  const hostile = extractQualifiedUrlEvidenceV12(documentFixture({
    html: '<a href="https://example.test/path?ids=PB9S650307180">not tracking</a>',
  }));

  assert.ok(positive.some((row) => row.kind === 'tracking_number' && row.normalizedValue === 'PB9S650307180' && row.namespace === 'MPL'));
  assert.deepEqual(hostile, []);
});

test('Szamlazz dedicated invoice header creates exact invoice identity and invoice event', () => {
  const rows = extractProviderHeaderEvidenceV12(documentFixture({
    headers: [{ name: 'X-Szamlazz-Invoice', value: 'SPORT-2026-11103' }],
  }));

  assert.ok(rows.some((row) => row.kind === 'invoice_number' && row.normalizedValue === 'SPORT-2026-11103' && row.namespace === 'SZAMLAZZ_HU'));
  assert.ok(rows.some((row) => row.kind === 'event' && row.normalizedValue === 'invoice_or_receipt'));
});

test('v1.2 remains additive, shadow-only, 0-write and 0-AI', () => {
  const document = documentFixture({
    headers: [{ name: 'X-Szamlazz-Invoice', value: 'INV-2026-1' }],
  });
  const before = JSON.stringify(document);
  const result = collectTechnicalEvidenceV12(document);

  assert.equal(result.collectorVersion, '1.2.0');
  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(JSON.stringify(document), before);
  assert.ok(contains(result.evidence, 'invoice_number', 'INV-2026-1'));
  assert.ok(contains(result.evidence, 'event', 'invoice_or_receipt'));

  const summary = summarizeTechnicalEvidenceV12(result);
  assert.equal(summary.productionWrites, 0);
  assert.equal(summary.aiCalls, 0);
  assert.ok(summary.identifierKindsPresent.includes('invoice_number'));
});
