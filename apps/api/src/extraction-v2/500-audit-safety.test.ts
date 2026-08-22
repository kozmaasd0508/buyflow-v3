import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { runExtractionEngineV2 } from './engine-v2.js';
import { universalOrderNumberExtractor } from './order-number-extractor.js';

function email(input: {
  subject: string;
  snippet: string;
  sender?: string;
  senderName?: string;
}): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `audit-500-safety-${Math.random()}`,
    subject: input.subject,
    from: [{ email: input.sender ?? 'shop@example.com', name: input.senderName ?? 'Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T22:00:00.000Z',
    snippet: input.snippet,
    folders: ['inbox'],
    attachments: [],
  };
}

test('merchant token before shipment noun is not mistaken for tracking', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Értesítés 13169408547018 HappyBox24 küldemény mai kézbesítéséről',
    snippet: [
      'Értesítjük, hogy a HappyBox24 partnerünk által feladott csomagot futárunk a mai napon kézbesítésre átvette.',
      'Szállítási mód: DPD',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.carrier.value, 'DPD');
  assert.equal(result.resolved.trackingNumber.value, '13169408547018');
  assert.notEqual(result.resolved.trackingNumber.value, 'HAPPYBOX24');
});

test('numeric parcel id in a shipment subject is corroborated without provider-specific parsing', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Értesítés 16380124260518 MODELL&HOBBY Kft. küldemény feladásáról',
    snippet: [
      'Értesítjük, hogy a mai napon MODELL&HOBBY Kft. partnerünk az Ön részére kézbesítendő csomagot adott fel.',
      'Szállítási mód: DPD',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.trackingNumber.value, '16380124260518');
});

test('delivery-today attempt plus parcel-number label resolves shipment and short numeric tracking', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'GLS 3412842135 mai kézbesítése / GLS 3412842135 delivery today',
    snippet: [
      'Ezúton értesítünk, hogy partnerünk által feladott csomagot a mai napon megkíséreljük kézbesíteni.',
      'Szállítási mód: GLS',
      'Csomagszám:',
      '3412842135',
      'Utánvét összeg: 0 Ft',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.trackingNumber.value, '3412842135');
});

test('strong Hungarian order receipt language resolves order creation', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Sikeres rendelés megerősítése',
    snippet: [
      'Köszönjük megrendelésed!',
      'A #46789 számú rendelést megkaptuk, jelenleg feldolgozás alatt áll.',
      'Rendelés száma: 46789',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'order_created');
  assert.equal(result.resolved.orderNumber.value, '46789');
});

test('merchant handoff phrase can span normalized message lines and still resolve shipment', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'A rendelésed teljesített.',
    snippet: [
      'A 46789 számú rendelésed',
      'átadtuk a futárnak a kézbesítéshez.',
      'Szállítási mód: Express One',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'shipment');
});

test('payment reminder for an existing invoice does not create a new invoice event', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Fizetési emlékeztető',
    snippet: [
      'Felhívjuk figyelmét, hogy a számlájának fizetési határideje rövidesen lejár.',
      'Számla száma: 8032959539',
      'Fizetendő összeg: 7345 Ft',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, null);
  assert.equal(result.resolved.invoiceNumber.value, '8032959539');
});

test('actual newly issued invoice wording remains invoice evidence', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Számlája érkezett',
    snippet: [
      'Önnek új számlája érkezett.',
      'Számla száma: INV-2026-1234',
      'Fizetendő összeg: 150000 Ft',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'invoice_or_receipt');
  assert.equal(result.resolved.invoiceNumber.value, 'INV-2026-1234');
});

test('URL-shaped document candidate cannot become an order number', () => {
  const base = buildEmailDocumentV1(email({
    subject: 'Értékesítési dokumentum',
    snippet: 'Dokumentum egy korábbi vásárláshoz.',
  }));
  const document = {
    ...base,
    signals: {
      ...base.signals,
      orderNumbers: ['s-f.baselinker.com/46181083/z4jusq3ppg/'],
    },
  };

  const claims = universalOrderNumberExtractor.extract(document);
  assert.equal(claims.some((claim) => claim.field === 'order_number'), false);
});

test('carrier collection amount is not a purchase total on shipment email', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'A küldemény úton van',
    snippet: [
      'A küldemény úton van.',
      'Szállítási mód: Express One',
      'A küldemény átvételekor fizetendő összeg: 0 Ft.',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.total.value, null);
  assert.equal(result.resolved.currency.value, null);
  assert.ok(result.evidence.bundle.claims.some((claim) => (
    claim.field === 'total' && claim.qualifiers?.includes('explicit_cod_collection_amount')
  )));
});

test('carrier collection amount may remain purchase total on an order-created email', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Rendelés visszaigazolása #ABC-1234',
    snippet: [
      'Köszönjük a rendelésed!',
      'Rendelés száma: ABC-1234',
      'A csomag átvételekor fizetendő összeg: 9990 Ft.',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'order_created');
  assert.equal(result.resolved.total.value, 9990);
  assert.equal(result.resolved.currency.value, 'HUF');
});

test('bare ten-digit number is not tracking without shipment and carrier corroboration', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Account update',
    snippet: 'Ügyfélazonosító: 3412842135',
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.trackingNumber.value, null);
});
