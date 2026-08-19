import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { detectGenericCommerceV1, GENERIC_COMMERCE_SHADOW_VERSION } from './generic-commerce-detector.js';
import { parseNormalizedDeterministicEmail } from './normalized-email-deterministic.js';

function gymBeamEmail(): NormalizedEmail {
  return {
    provider: 'mailgun',
    providerMessageId: '<gymbeam-test@example.com>',
    subject: 'Kozma, a rendelésed feldolgozás alatt van.',
    from: [{ email: 'info@service.gymbeam.hu', name: 'GymBeam' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-17T11:13:00.000Z',
    snippet: [
      'Köszönjük! Megkaptuk a rendelésedet.',
      'A 3010410391 számú rendelésed már készül!',
      'Rendelési összesítő:',
      '1x Arginin A.K.G - GymBeam',
      'Grammsúly: 250 g, Ízesítés: ízesítetlen',
      '3 790Ft',
      '1x Gurtni Camo - GymBeam',
      '1 890Ft',
      'Szállítás: 1 190Ft',
      'Utánvét: 300Ft',
      'Szállítási mód: Kikézbesítés Express One futárral',
      'Fizetési mód: Utánvéttel',
      'Bruttó összeg: 7 170Ft',
    ].join('\n'),
    folders: ['inbound', 'mailgun-shadow', 'eml-expanded'],
    attachments: [],
  };
}

test('EmailDocument v1 extracts generic GymBeam order signals', () => {
  const document = buildEmailDocumentV1(gymBeamEmail());
  assert.equal(document.sender.primaryDomain, 'service.gymbeam.hu');
  assert.ok(document.signals.orderNumbers.includes('3010410391'));
  assert.ok(document.signals.couriers.includes('Express One'));
  assert.equal(document.signals.paymentMethods[0], 'Utánvéttel');
  assert.match(document.signals.shippingMethods[0] ?? '', /Express One/);
  assert.ok(document.sections.some((section) => section.type === 'order_summary'));
  assert.deepEqual(document.signals.products.map(({ name, quantity }) => ({ name, quantity })), [
    { name: 'Arginin A.K.G - GymBeam', quantity: 1 },
    { name: 'Gurtni Camo - GymBeam', quantity: 1 },
  ]);

  const generic = detectGenericCommerceV1(document);
  assert.ok(generic);
  assert.equal(generic.eventType, 'order_created');
  assert.equal(generic.orderNumber, '3010410391');
  assert.equal(generic.carrier, 'Express One');
  assert.deepEqual(generic.total, { amount: 7170, currency: 'HUF' });
  assert.equal(generic.products.length, 2);
});

test('normalized deterministic pipeline falls back to generic-commerce-v1 shadow with structured fields', () => {
  const parsed = parseNormalizedDeterministicEmail(gymBeamEmail());
  assert.ok(parsed);
  assert.equal(parsed.parserVersion, GENERIC_COMMERCE_SHADOW_VERSION);
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.order_number, '3010410391');
  assert.equal(parsed.extraction.total, 7170);
  assert.equal(parsed.extraction.currency, 'HUF');
  assert.equal(parsed.extraction.carrier, 'Express One');
  assert.equal(parsed.extraction.payment_status, 'cash_on_delivery');
  assert.equal(parsed.extraction.payment_method, 'Utánvéttel');
  assert.match(parsed.extraction.shipping_method ?? '', /Express One/);
  assert.deepEqual(parsed.extraction.products.map(({ name, quantity }) => ({ name, quantity })), [
    { name: 'Arginin A.K.G - GymBeam', quantity: 1 },
    { name: 'Gurtni Camo - GymBeam', quantity: 1 },
  ]);
});
