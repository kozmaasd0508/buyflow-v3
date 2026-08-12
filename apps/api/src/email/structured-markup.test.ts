import assert from 'node:assert/strict';
import test from 'node:test';
import { auditStructuredMarkup } from './structured-markup.js';

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
});

test('detects schema.org microdata types', () => {
  const html = `<div itemscope itemtype="https://schema.org/ParcelDelivery"><span itemprop="trackingNumber">ABC</span></div>`;
  const result = auditStructuredMarkup(html);
  assert.equal(result.hasMicrodata, true);
  assert.deepEqual(result.microdataTypes, ['ParcelDelivery']);
  assert.deepEqual(result.commerceTypes, ['ParcelDelivery']);
});

test('counts invalid JSON-LD without exposing content', () => {
  const html = `<script type="application/ld+json">{invalid}</script>`;
  const result = auditStructuredMarkup(html);
  assert.equal(result.hasJsonLd, true);
  assert.equal(result.jsonLdParseErrors, 1);
  assert.deepEqual(result.jsonLdTypes, []);
});
