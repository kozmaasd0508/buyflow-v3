import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import {
  collectTechnicalEvidenceV1,
  extractHeaderTechnicalEvidenceV1,
  extractHtmlSemanticTechnicalEvidenceV1,
  extractStructuredDataTechnicalEvidenceV1,
  extractUrlTechnicalEvidenceV1,
  summarizeTechnicalEvidenceV1,
} from './technical-evidence-v1.js';

function documentFixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas' as EmailDocumentV1['provider'],
    providerMessageId: 'opaque-test-message',
    receivedAt: '2026-08-23T20:00:00.000Z',
    sender: {
      addresses: [],
      domains: ['example.test'],
      primaryEmail: null,
      primaryDomain: 'example.test',
      primaryName: null,
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Test',
    text: '',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: [],
    },
    ...overrides,
  };
}

function hasEvidence(
  rows: ReturnType<typeof collectTechnicalEvidenceV1>['evidence'],
  kind: string,
  normalizedValue: string,
  source?: string,
): boolean {
  return rows.some((row) => row.kind === kind
    && row.normalizedValue === normalizedValue
    && (!source || row.source === source));
}

test('TechnicalEvidence v1 extracts independent header/url/html/structured layers without writes or AI', () => {
  const document = documentFixture({
    headers: [
      { name: 'X-Mailin-Tag', value: 'order-confirm' },
      { name: 'X-Invoice-Number', value: 'INV-2026-11103' },
      { name: 'Authentication-Results', value: 'mx.example; dkim=pass header.d=example.test' },
    ],
    html: `<!doctype html>
      <html>
        <head><title>Order Confirmation</title></head>
        <body>
          <table class="woocommerce-order-details" data-order-id="130354"></table>
          <img alt="GLS" src="logo.png">
          <a href="https://tracking.example/parcel?trackingNr=605855123&amp;order_id=130354">Track</a>
          <script type="application/ld+json">{
            "@context":"https://schema.org",
            "@type":"Order",
            "orderNumber":"130354",
            "price":"14758",
            "priceCurrency":"HUF",
            "seller":{"@type":"Organization","name":"Example Store"},
            "acceptedOffer":{"@type":"Offer","itemOffered":{"@type":"Product","name":"Example Shoe"}}
          }</script>
        </body>
      </html>`,
  });
  const before = JSON.stringify(document);

  const result = collectTechnicalEvidenceV1(document);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(JSON.stringify(document), before, 'collector must not mutate EmailDocumentV1');
  assert.deepEqual(result.ranExtractors.map((row) => row.id), [
    'header-evidence-v1',
    'url-evidence-v1',
    'html-semantic-evidence-v1',
    'structured-data-evidence-v1',
  ]);

  assert.ok(hasEvidence(result.evidence, 'event', 'order_created', 'header'));
  assert.ok(hasEvidence(result.evidence, 'event', 'order_created', 'html_title'));
  assert.ok(hasEvidence(result.evidence, 'event', 'order_created', 'structured_data'));
  assert.ok(hasEvidence(result.evidence, 'invoice_number', 'INV-2026-11103', 'header'));
  assert.ok(hasEvidence(result.evidence, 'tracking_number', '605855123', 'url'));
  assert.ok(hasEvidence(result.evidence, 'order_number', '130354', 'url'));
  assert.ok(hasEvidence(result.evidence, 'order_number', '130354', 'html_attribute'));
  assert.ok(hasEvidence(result.evidence, 'order_number', '130354', 'structured_data'));
  assert.ok(hasEvidence(result.evidence, 'platform', 'WooCommerce', 'html_attribute'));
  assert.ok(hasEvidence(result.evidence, 'carrier', 'GLS', 'alternate_text'));
  assert.ok(hasEvidence(result.evidence, 'currency', 'HUF', 'structured_data'));
  assert.ok(hasEvidence(result.evidence, 'merchant', 'Example Store', 'structured_data'));
  assert.ok(hasEvidence(result.evidence, 'product', 'Example Shoe', 'structured_data'));
  assert.ok(result.evidence.some((row) => row.source === 'authentication'));

  const summary = summarizeTechnicalEvidenceV1(result);
  assert.equal(summary.productionWrites, 0);
  assert.equal(summary.aiCalls, 0);
  assert.equal(summary.hasStructuredData, true);
  assert.ok(summary.identifierKindsPresent.includes('order_number'));
  assert.ok(summary.identifierKindsPresent.includes('tracking_number'));
  assert.ok(summary.identifierKindsPresent.includes('invoice_number'));
});

test('individual extractors remain layer-specific and malformed technical data is non-fatal', () => {
  const document = documentFixture({
    headers: [{ name: 'X-Order-Id', value: 'ORD-12345' }],
    html: `<html><head><title>Neutral message</title></head><body>
      <a href="/tracking/%E0%A4%A">broken path</a>
      <div data-tracking-number="TRK-99999999"></div>
      <script type="application/ld+json">{not valid json</script>
    </body></html>`,
  });

  const header = extractHeaderTechnicalEvidenceV1(document);
  const urls = extractUrlTechnicalEvidenceV1(document);
  const html = extractHtmlSemanticTechnicalEvidenceV1(document);
  const structured = extractStructuredDataTechnicalEvidenceV1(document);

  assert.ok(hasEvidence(header, 'order_number', 'ORD-12345', 'header'));
  assert.ok(hasEvidence(html, 'tracking_number', 'TRK-99999999', 'html_attribute'));
  assert.deepEqual(structured, []);
  assert.ok(Array.isArray(urls), 'malformed URL encoding must not throw');
});
