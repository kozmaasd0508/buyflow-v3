import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroOrderEmail } from './allegro-order-adapter.js';
import { parseAllegroSalesDocumentEmail } from './allegro-sales-document-adapter.js';

const subject = 'Megrendelésre szánt értékesítési dokumentum 46181083 (Dokument sprzedaży do zamówienia 46181083)';
const body = `Tájékoztatást kaptunk arról, hogy a csomagod megérkezett, és már nálad van.
Ennek az üzenetnek a mellékletében megtalálja a 46181083-es rendeléshez szükséges értékesítési dokumentumot.
Link a számlaoldalhoz: https://orders-f.baselinker.com/46181083/z4jusq3ppg/invoice
Forrás tartalma: W załączniku tej wiadomości znajdziesz Dokument sprzedaży za zamówienie 46181083`;

test('classifies exact Allegro relay sales-document mail as invoice, not delivery', () => {
  const result = parseAllegroSalesDocumentEmail({
    senderDomains: ['allegromail.com'],
    subject,
    bodyText: body,
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'invoice_or_receipt');
  assert.equal(result.extraction.order_number, '46181083');
  assert.equal(result.extraction.tracking_number, null);
  assert.equal(result.parserVersion, 'allegro-sales-document-v1');
});

test('sales-document identity wins through the wired Allegro adapter even with delivered wording', () => {
  const result = parseAllegroOrderEmail({
    senderDomains: ['allegromail.com'],
    subject,
    bodyText: body,
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'invoice_or_receipt');
  assert.equal(result.extraction.order_number, '46181083');
  assert.equal(result.shipmentPhase, undefined);
});

test('rejects lookalike relay domain', () => {
  assert.equal(parseAllegroSalesDocumentEmail({
    senderDomains: ['allegromail.com.attacker.example'],
    subject,
    bodyText: body,
  }), null);
});

test('rejects mismatched order numbers and missing invoice URL', () => {
  assert.equal(parseAllegroSalesDocumentEmail({
    senderDomains: ['allegromail.com'],
    subject: 'Megrendelésre szánt értékesítési dokumentum 46181083 (Dokument sprzedaży do zamówienia 99999999)',
    bodyText: body,
  }), null);

  assert.equal(parseAllegroSalesDocumentEmail({
    senderDomains: ['allegromail.com'],
    subject,
    bodyText: body.replace('https://orders-f.baselinker.com/46181083/z4jusq3ppg/invoice', 'https://example.com/not-an-invoice'),
  }), null);
});
