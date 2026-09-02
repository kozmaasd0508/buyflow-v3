import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditStructuredMarkup,
  extractStructuredDataRecords,
} from './structured-markup.js';

test('detects JSON-LD commerce types', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Order","orderNumber":"123","acceptedOffer":{"@type":"Offer"}}
      </script>
    </head></html>`;

  const result = auditStructuredMarkup(html);
  assert.equal(result.hasJsonLd, true);
  assert.equal(result.jsonLdBlocks, 1);
  assert.equal(result.jsonLdParseErrors, 0);
  assert.deepEqual(result.jsonLdTypes, ['Offer', 'Order']);
  assert.deepEqual(result.commerceTypes, ['Offer', 'Order']);

  const records = extractStructuredDataRecords(html);
  assert.equal(records[0]?.normalization, 'raw_json');
});

test('detects schema.org microdata types only as type hints', () => {
  const html = `<div itemscope itemtype="https://schema.org/ParcelDelivery"><span itemprop="trackingNumber">ABC</span></div>`;
  const result = auditStructuredMarkup(html);
  assert.equal(result.hasMicrodata, true);
  assert.deepEqual(result.microdataTypes, ['ParcelDelivery']);
  assert.deepEqual(result.commerceTypes, ['ParcelDelivery']);

  const records = extractStructuredDataRecords(html);
  assert.equal(records[0]?.normalization, 'microdata_type_hint');
  assert.deepEqual(records[0]?.payload, {
    itemType: 'https://schema.org/ParcelDelivery',
    fieldEvidence: false,
  });
});

test('raw JSON-LD parse is preferred and entity compatibility fallback is provenance tagged', () => {
  const html = `<script type="application/ld+json">{&quot;@type&quot;:&quot;Order&quot;,&quot;orderNumber&quot;:&quot;123&quot;}</script>`;
  const records = extractStructuredDataRecords(html);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.schemaType, 'Order');
  assert.equal(records[0]?.normalization, 'html_entity_compat');

  const result = auditStructuredMarkup(html);
  assert.equal(result.jsonLdParseErrors, 0);
  assert.deepEqual(result.jsonLdTypes, ['Order']);
});

test('counts invalid JSON-LD without exposing content', () => {
  const html = `<script type="application/ld+json">{invalid}</script>`;
  const result = auditStructuredMarkup(html);
  assert.equal(result.hasJsonLd, true);
  assert.equal(result.jsonLdParseErrors, 1);
  assert.deepEqual(result.jsonLdTypes, []);
});

test('deep JSON-LD audit is bounded and cannot recurse the JS stack', () => {
  let nested: Record<string, unknown> = { '@type': 'Order' };
  for (let index = 0; index < 200; index += 1) {
    nested = { child: nested };
  }
  const html = `<script type="application/ld+json">${JSON.stringify(nested)}</script>`;
  const result = auditStructuredMarkup(html);
  assert.equal(result.hasJsonLd, true);
  assert.equal(result.jsonLdParseErrors, 0);
});
