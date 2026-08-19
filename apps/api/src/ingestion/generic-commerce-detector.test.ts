import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { detectGenericCommerceV1, detectGenericCommerceV2, GENERIC_COMMERCE_SHADOW_VERSION } from './generic-commerce-detector.js';
import { parseNormalizedDeterministicEmail } from './normalized-email-deterministic.js';

function email(input: { subject: string; sender: string; name?: string; snippet?: string }): NormalizedEmail {
  return {
    provider: 'mailgun',
    providerMessageId: `<${Math.random()}@example.com>`,
    subject: input.subject,
    from: [{ email: input.sender, name: input.name ?? null }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-19T20:00:00.000Z',
    snippet: input.snippet ?? input.subject,
    folders: ['inbound', 'mailgun-shadow'],
    attachments: [],
  };
}

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
  assert.equal(document.signals.shippingAmounts[0]?.amount, 1190);
  assert.equal(document.signals.shippingAmounts[0]?.currency, 'HUF');
  assert.equal(document.signals.codAmounts[0]?.amount, 300);
  assert.equal(document.signals.codAmounts[0]?.currency, 'HUF');
  assert.ok(document.sections.some((section) => section.type === 'order_summary'));
  assert.deepEqual(document.signals.products.map(({ name, quantity, unitPrice, totalPrice, currency }) => ({
    name,
    quantity,
    unitPrice,
    totalPrice,
    currency,
  })), [
    { name: 'Arginin A.K.G - GymBeam', quantity: 1, unitPrice: 3790, totalPrice: 3790, currency: 'HUF' },
    { name: 'Gurtni Camo - GymBeam', quantity: 1, unitPrice: 1890, totalPrice: 1890, currency: 'HUF' },
  ]);

  const generic = detectGenericCommerceV1(document);
  assert.ok(generic);
  assert.equal(generic.eventType, 'order_created');
  assert.equal(generic.orderNumber, '3010410391');
  assert.equal(generic.carrier, 'Express One');
  assert.deepEqual(generic.total, { amount: 7170, currency: 'HUF' });
  assert.deepEqual(generic.shippingAmount, { amount: 1190, currency: 'HUF' });
  assert.deepEqual(generic.codAmount, { amount: 300, currency: 'HUF' });
  assert.equal(generic.products.length, 2);
});

test('normalized deterministic pipeline falls back to generic-commerce-v2 shadow with structured fields', () => {
  const parsed = parseNormalizedDeterministicEmail(gymBeamEmail());
  assert.ok(parsed);
  assert.equal(parsed.parserVersion, GENERIC_COMMERCE_SHADOW_VERSION);
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.order_number, '3010410391');
  assert.equal(parsed.extraction.total, 7170);
  assert.equal(parsed.extraction.currency, 'HUF');
  assert.equal(parsed.extraction.shipping_amount, 1190);
  assert.equal(parsed.extraction.cod_amount, 300);
  assert.equal(parsed.extraction.cod_currency, 'HUF');
  assert.equal(parsed.extraction.carrier, 'Express One');
  assert.equal(parsed.extraction.payment_status, 'cash_on_delivery');
  assert.equal(parsed.extraction.payment_method, 'Utánvéttel');
  assert.match(parsed.extraction.shipping_method ?? '', /Express One/);
  assert.deepEqual(parsed.extraction.products.map(({ name, quantity, unit_price, total_price, currency }) => ({
    name,
    quantity,
    unit_price,
    total_price,
    currency,
  })), [
    { name: 'Arginin A.K.G - GymBeam', quantity: 1, unit_price: 3790, total_price: 3790, currency: 'HUF' },
    { name: 'Gurtni Camo - GymBeam', quantity: 1, unit_price: 1890, total_price: 1890, currency: 'HUF' },
  ]);
});

test('generic-commerce-v2 recognizes strong lifecycle subjects missed by v1 audit', () => {
  const cases: Array<[NormalizedEmail, string]> = [
    [email({ subject: 'Csomag kézbesítés ma – ETA és módosítás', sender: 'ertesites@expressone.hu' }), 'shipment'],
    [email({ subject: 'Küldemény feldolgozása megkezdődött', sender: 'ertesites@expressone.hu' }), 'shipment'],
    [email({ subject: 'Google Play-rendelés (2026. aug. 16.) nyugtája', sender: 'googleplay-noreply@google.com' }), 'invoice_or_receipt'],
    [email({ subject: 'Parfümök online a Limone.hu-n - Automata megrendelés visszaigazolás - 98691-106627', sender: 'info@limone.hu' }), 'order_created'],
    [email({ subject: 'FNP Products - Sikeres rendelés megerősítése 🥳', sender: 'info@fnp.hu' }), 'order_created'],
    [email({ subject: 'Elkészült a rendelésedhez tartozó számla', sender: 'info@jatekbolt.hu' }), 'invoice_or_receipt'],
  ];

  for (const [message, expectedEvent] of cases) {
    const result = detectGenericCommerceV2(buildEmailDocumentV1(message));
    assert.ok(result, message.subject ?? 'missing subject');
    assert.equal(result.eventType, expectedEvent, message.subject ?? 'missing subject');
  }
});

test('generic-commerce-v2 keeps representative promotional noise unmatched', () => {
  const noise = [
    email({ subject: '🎀 FINAL SUMMER SALE: akár –35% VASÁRNAP ÉJFÉLIG!🎀', sender: 'store+85580841304@g.shopifyemail.com' }),
    email({ subject: 'Hoztunk egy hűsítő kedvezményt ❄️', sender: 'meki@m.mcdonalds.hu' }),
    email({ subject: '📸 200 db 10x15 cm-es Prémium Fénykép 11800 Ft', sender: 'info@xxlfoto.hu' }),
    email({ subject: 'Elégedett volt Kartonshop.hu webáruházban történt vásárlással?', sender: 'megbizhatobolt@arukereso.hu' }),
  ];

  for (const message of noise) {
    assert.equal(detectGenericCommerceV2(buildEmailDocumentV1(message)), null, message.subject ?? 'missing subject');
  }
});
