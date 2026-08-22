import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { universalCarrierExtractor } from './carrier-extractor.js';
import { runExtractionEngineV2 } from './engine-v2.js';
import { universalEventTypeExtractor } from './event-type-extractor.js';

function email(input: {
  subject: string;
  snippet?: string;
  sender?: string;
  name?: string;
}): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `event-test-${Math.random()}`,
    subject: input.subject,
    from: [{ email: input.sender ?? 'orders@example-shop.hu', ...(input.name ? { name: input.name } : {}) }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T20:00:00.000Z',
    snippet: input.snippet ?? input.subject,
    folders: ['inbox'],
    attachments: [],
  };
}

test('event extractor resolves a current shipment without treating future delivery wording as delivered', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'A csomagod feladásra került',
    snippet: 'A rendelésedet átadtuk a futárszolgálatnak. Holnap kézbesítjük.',
  }));
  const claims = universalEventTypeExtractor.extract(document).filter((claim) => claim.field === 'event_type');
  assert.ok(claims.some((claim) => claim.value === 'shipment'));
  assert.ok(!claims.some((claim) => claim.value === 'delivery'));
});

test('quoted old order confirmation does not create a second lifecycle event', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Your order has been shipped',
    snippet: [
      'Your order has been shipped.',
      'Tracking number: 123456789012',
      '-----Original Message-----',
      'Order confirmed',
      'We have received your order.',
    ].join('\n'),
  }));
  const claims = universalEventTypeExtractor.extract(document).filter((claim) => claim.field === 'event_type');
  assert.ok(claims.some((claim) => claim.value === 'shipment'));
  assert.ok(!claims.some((claim) => claim.value === 'order_created'));
});

test('payment, refund, invoice and delivery use explicit lifecycle evidence', () => {
  const cases: Array<[string, string]> = [
    ['Sikeres bankkártyás fizetés', 'payment_completed'],
    ['Visszatérítés megtörtént', 'refund'],
    ['A számlád elkészült', 'invoice_or_receipt'],
    ['A csomagod sikeresen kézbesítve', 'delivery'],
  ];
  for (const [subject, expected] of cases) {
    const claims = universalEventTypeExtractor.extract(buildEmailDocumentV1(email({ subject })));
    assert.ok(claims.some((claim) => claim.field === 'event_type' && claim.value === expected), subject);
  }
});

test('carrier extractor uses explicit label and active-message courier evidence', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Csomagértesítő',
    snippet: 'Futárszolgálat: DPD\nTracking number: 13169408547018',
  }));
  const claims = universalCarrierExtractor.extract(document).filter((claim) => claim.field === 'carrier');
  assert.ok(claims.some((claim) => claim.value === 'DPD' && claim.confidence >= 0.99));
});

test('courier mentioned only in quoted history is not emitted as current carrier evidence', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Rendelési értesítő',
    snippet: [
      'A rendelésed beérkezett.',
      '-----Original Message-----',
      'Korábbi csomagod futára: GLS',
    ].join('\n'),
  }));
  const claims = universalCarrierExtractor.extract(document).filter((claim) => claim.field === 'carrier');
  assert.ok(!claims.some((claim) => String(claim.value).toUpperCase() === 'GLS'));
});

test('engine v2 runs all nine extractors and resolves shipment carrier tracking', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'A csomagod feladásra került',
    snippet: [
      'Futárszolgálat: DPD',
      'Tracking number: 13169408547018',
      'Eladó: Example Store Kft.',
    ].join('\n'),
  }));
  const result = runExtractionEngineV2(document);

  assert.equal(result.evidence.ranExtractors.length, 9);
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.carrier.value, 'DPD');
  assert.equal(result.resolved.trackingNumber.value, '13169408547018');
  assert.equal(result.reviewRequired, false);
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
});

test('explicit carrier label outranks a weaker incidental carrier mention', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Csomagértesítő',
    snippet: 'Futárszolgálat: DPD\nA GLS név egy tájékoztató mondatban is szerepel.',
  }));
  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.carrier.status, 'resolved');
  assert.equal(result.resolved.carrier.value, 'DPD');
});

test('two different explicit carrier labels become REVIEW', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Csomagértesítő',
    snippet: 'Futárszolgálat: DPD\nCarrier: GLS',
  }));
  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.carrier.status, 'conflict');
  assert.equal(result.reviewRequired, true);
});

test('shipment without tracking is warning only, not REVIEW', () => {
  const result = runExtractionEngineV2(buildEmailDocumentV1(email({
    subject: 'Your order has been shipped',
  })));
  assert.ok(result.validation.issues.some((issue) => issue.code === 'lifecycle_tracking_missing'));
  assert.equal(result.validation.reviewRequired, false);
});

test('contradictory explicit payment status evidence becomes REVIEW before validation can guess', () => {
  const result = runExtractionEngineV2(buildEmailDocumentV1(email({
    subject: 'Sikeres fizetés',
    snippet: 'Sikeres fizetés\nFizetési mód: Utánvét',
  })));
  assert.equal(result.resolved.eventType.value, 'payment_completed');
  assert.equal(result.resolved.paymentStatus.status, 'conflict');
  assert.equal(result.reviewRequired, true);
});
