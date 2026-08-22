import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';
import type { DeterministicCommerceParseResult } from './deterministic-commerce-parser.js';
import { enrichProviderFieldsV1 } from './provider-field-enrichment-v1.js';

function email(from: string, subject: string, snippet = '', name?: string): NormalizedEmail {
  return {
    provider: 'nylas', providerMessageId: 'test', subject,
    from: [{ email: from, ...(name ? { name } : {}) }], to: [], cc: [], bcc: [],
    receivedAt: '2026-08-20T00:00:00.000Z', snippet,
    folders: [], attachments: [],
  };
}

function parsed(eventType: EmailExtraction['event_type']): DeterministicCommerceParseResult {
  return {
    parserVersion: 'test-shadow', reasons: [],
    extraction: {
      event_type: eventType, merchant: null, merchant_legal_name: null, order_number: null,
      subtotal: null, shipping_amount: null, discount_amount: null, total: null, currency: null,
      payment_status: null, payment_method: null, paid_amount: null, paid_currency: null,
      shipping_method: null, tracking_number: null, carrier: null, parcel_sender: null,
      cod_amount: null, cod_currency: null, invoice_number: null, products: [], confidence: 0.9,
    },
  };
}

test('enriches DPD tracking from trusted subject without changing event type', () => {
  const result = enrichProviderFieldsV1(
    email('noreply@dpd.hu', 'Értesítés 16380143879559 sikeres kézbesítéséről'),
    parsed('delivery'),
  );
  assert.equal(result.extraction.event_type, 'delivery');
  assert.equal(result.extraction.carrier, 'DPD');
  assert.equal(result.extraction.tracking_number, '16380143879559');
});

test('enriches GLS locker tracking from trusted subject', () => {
  const result = enrichProviderFieldsV1(
    email('noreply@gls-hungary.com', 'Értesítés a 3408405568 számú csomag GLS Automatába helyezéséről'),
    parsed('shipment'),
  );
  assert.equal(result.extraction.carrier, 'GLS');
  assert.equal(result.extraction.tracking_number, '3408405568');
});

test('enriches MPL tracking from labeled provider body', () => {
  const result = enrichProviderFieldsV1(
    email('kozponti.ertesites@posta.hu', 'Csomagküldemény', 'Küldeményazonosító: PB9S650295555'),
    parsed('shipment'),
  );
  assert.equal(result.extraction.carrier, 'MPL');
  assert.equal(result.extraction.tracking_number, 'PB9S650295555');
});

test('enriches Express One long shipment identifier', () => {
  const result = enrichProviderFieldsV1(
    email('ertesites@expressone.hu', 'Késik a kézbesítés – új ETA: 5 perc', 'Küldeményazonosító: 669695091305000013605231'),
    parsed('shipment'),
  );
  assert.equal(result.extraction.carrier, 'Express One');
  assert.equal(result.extraction.tracking_number, '669695091305000013605231');
});

test('enriches Epic Games order number only for receipt event', () => {
  const result = enrichProviderFieldsV1(
    email('help@acct.epicgames.com', 'Epic Games bizonylat', 'Számlaazonosító: A2605251823125756'),
    parsed('invoice_or_receipt'),
  );
  assert.equal(result.extraction.order_number, 'A2605251823125756');
});

test('does not enrich untrusted sender with DPD-shaped subject', () => {
  const result = enrichProviderFieldsV1(
    email('promo@example.com', 'Értesítés 16380143879559 sikeres kézbesítéséről'),
    parsed('delivery'),
  );
  assert.equal(result.extraction.carrier, null);
  assert.equal(result.extraction.tracking_number, null);
});

test('enriches shipment COD amount and payment status from explicit labels', () => {
  const result = enrichProviderFieldsV1(
    email('shop@example.hu', 'Csomagod úton van', 'Utánvét összege: 9 560 Ft\nFizetési mód: Utánvét'),
    parsed('shipment'),
  );
  assert.equal(result.extraction.total, 9560);
  assert.equal(result.extraction.currency, 'HUF');
  assert.equal(result.extraction.payment_status, 'cash_on_delivery');
});

test('enriches payment amount and paid status from explicit transaction evidence', () => {
  const result = enrichProviderFieldsV1(
    email('payments@example.hu', 'Fizetési értesítő', 'Sikeres tranzakció\nTranzakció összege: 14 960 Ft'),
    parsed('payment_completed'),
  );
  assert.equal(result.extraction.total, 14960);
  assert.equal(result.extraction.currency, 'HUF');
  assert.equal(result.extraction.payment_status, 'paid');
});

test('marks invoice or receipt paid only with explicit paid evidence', () => {
  const result = enrichProviderFieldsV1(
    email('billing@example.hu', 'A számlád elkészült', 'Fizetés megtörtént.'),
    parsed('invoice_or_receipt'),
  );
  assert.equal(result.extraction.payment_status, 'paid');
});

test('uses non-courier sender display name as merchant fallback', () => {
  const result = enrichProviderFieldsV1(
    email('orders@example-shop.hu', 'Rendelésed szállítás alatt', '', 'MODELL&HOBBY Kft.'),
    parsed('shipment'),
  );
  assert.equal(result.extraction.merchant, 'MODELL&HOBBY Kft.');
});

test('uses parsed parcel sender as merchant fallback for courier mail', () => {
  const input = parsed('shipment');
  input.extraction.parcel_sender = 'MODELL&HOBBY Kft.';
  const result = enrichProviderFieldsV1(
    email('noreply@dpd.hu', 'Értesítés 16380143879559', '', 'DPD Hungary'),
    input,
  );
  assert.equal(result.extraction.merchant, 'MODELL&HOBBY Kft.');
});

test('does not use courier sender display name as merchant fallback', () => {
  const result = enrichProviderFieldsV1(
    email('noreply@dpd.hu', 'Értesítés 16380143879559', '', 'DPD Hungary'),
    parsed('shipment'),
  );
  assert.equal(result.extraction.merchant, null);
});
