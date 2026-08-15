import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicLifecycleEmail } from './deterministic-lifecycle-parser.js';

test('parses Gyerekjatekbolt failed payment', () => {
  const result = parseDeterministicLifecycleEmail({ senderDomains: ['gyerekjatekbolt.com'], subject: 'Sikertelen bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!', bodyText: 'A(z) 535574. számú rendelést NEM sikerült befizetnie.' });
  assert.ok(result); assert.equal(result.lifecycleEvent, 'payment_failed'); assert.equal(result.extraction.order_number, '535574'); assert.equal(result.extraction.payment_status, 'failed');
});

test('parses explicit Gyerekjatekbolt cancellation', () => {
  const result = parseDeterministicLifecycleEmail({ senderDomains: ['gyerekjatekbolt.com'], subject: 'A rendelés állapota megváltozott', bodyText: 'Rendelésszám: 535574 Jelenlegi állapot: Törölve' });
  assert.ok(result); assert.equal(result.lifecycleEvent, 'cancelled'); assert.equal(result.extraction.order_number, '535574');
});

test('parses MPL accepted parcel as shipped with sender, tracking and COD', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['posta.hu'],
    senderEmails: ['kozponti.ertesites@posta.hu'],
    subject: 'Csomagot adtak fel neked',
    bodyText: 'Értesítünk, hogy csomagot adtak fel Neked.\nCsomag adatai\nFeladó: Szidibox Karton Kft.\nCsomagazonosító: [PB9S650307180](https://posta.hu/nyomkovetes/nyitooldal?ids=PB9S650307180)\nFeladás dátuma: 2026.07.23.\nÁrufizetési összeg: 26 390 Ft',
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'shipped');
  assert.equal(result.shipmentPhase, 'shipped');
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.tracking_number, 'PB9S650307180');
  assert.equal(result.extraction.carrier, 'Magyar Posta Logisztika (MPL)');
  assert.equal(result.extraction.parcel_sender, 'Szidibox Karton Kft.');
  assert.equal(result.extraction.cod_amount, 26390);
  assert.equal(result.extraction.cod_currency, 'HUF');
});

test('parses Nylas-style flattened MPL labels without relying on line breaks', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['posta.hu'],
    senderEmails: ['kozponti.ertesites@posta.hu'],
    subject: 'Csomagot adtak fel neked',
    bodyText: 'Értesítünk, hogy csomagot adtak fel Neked. Csomag adatai Feladó: Szidibox Karton Kft. Csomagazonosító: PB9S650307180 Feladás dátuma: 2026.07.23. Kézbesítési cím: Szolnok Árufizetési összeg: 26 390 Ft',
  });
  assert.ok(result);
  assert.equal(result.shipmentPhase, 'shipped');
  assert.equal(result.extraction.parcel_sender, 'Szidibox Karton Kft.');
  assert.equal(result.extraction.tracking_number, 'PB9S650307180');
  assert.equal(result.extraction.cod_amount, 26390);
});

test('parses MPL courier-out and pickup-ready as distinct non-delivered phases', () => {
  const base = 'Feladó: Szidibox Karton Kft.\nCsomagazonosító: PB9S650307180\nÁrufizetési összeg: 26 390 Ft';
  const out = parseDeterministicLifecycleEmail({
    senderDomains: ['posta.hu'], senderEmails: ['kozponti.ertesites@posta.hu'],
    subject: 'Csomagod a kézbesítőnél van', bodyText: `Értesítünk, hogy csomagod a kézbesítőnél van.\n${base}`,
  });
  const pickup = parseDeterministicLifecycleEmail({
    senderDomains: ['posta.hu'], senderEmails: ['kozponti.ertesites@posta.hu'],
    subject: 'Csomagod a postán átvehető', bodyText: `Értesítünk, hogy csomagod 2026.07.31-ig átvehető az alábbi postán:\n${base}`,
  });
  assert.ok(out); assert.equal(out.shipmentPhase, 'out_for_delivery'); assert.equal(out.extraction.event_type, 'shipment');
  assert.ok(pickup); assert.equal(pickup.shipmentPhase, 'ready_for_pickup'); assert.equal(pickup.extraction.event_type, 'shipment');
});

test('MPL parsing requires the exact trusted sender address', () => {
  const body = 'Értesítünk, hogy csomagot adtak fel Neked.\nFeladó: Shop Kft.\nCsomagazonosító: PB9S650307180';
  assert.equal(parseDeterministicLifecycleEmail({
    senderDomains: ['posta.hu'], senderEmails: ['attacker@posta.hu'], subject: 'Csomagot adtak fel neked', bodyText: body,
  }), null);
  assert.equal(parseDeterministicLifecycleEmail({
    senderDomains: ['posta.hu.attacker.com'], senderEmails: ['kozponti.ertesites@posta.hu.attacker.com'], subject: 'Csomagot adtak fel neked', bodyText: body,
  }), null);
});

test('parses verified Szidibox public-mailbox packing only as shipment_created', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['gmail.com'],
    senderEmails: ['szidibox@gmail.com'],
    subject: 'Szidibox Karton Kft. Webáruház - Megrendelését összekészítettük SO-2024-30411',
    bodyText: 'Megrendelés összekészítve\nFelhívjuk szíves figyelmét, hogy a Ön által küldött megrendelést összekészítettük és hamarosan átadjuk a futárszolgálat részére.\nRendelésszám:\nSO-2024-30411\nhttps://www.kartonshop.hu/csomagkuldo-doboz',
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'shipment_created');
  assert.equal(result.shipmentPhase, 'shipment_created');
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.order_number, 'SO-2024-30411');
  assert.equal(result.extraction.carrier, 'MPL');
  assert.ok(result.reasons.includes('not_physical_shipment_yet'));
});

test('Szidibox public mailbox anchor requires exact sender, kartonshop domain and order agreement', () => {
  const subject = 'Szidibox Karton Kft. Webáruház - Megrendelését összekészítettük SO-2024-30411';
  const body = 'Megrendelés összekészítve\nmegrendelést összekészítettük és hamarosan átadjuk a futárszolgálat részére.\nRendelésszám: SO-2024-30411\nhttps://www.kartonshop.hu/';
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['gmail.com'], senderEmails: ['other@gmail.com'], subject, bodyText: body }), null);
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['gmail.com'], senderEmails: ['szidibox@gmail.com'], subject, bodyText: body.replace('kartonshop.hu', 'attacker.example') }), null);
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['gmail.com'], senderEmails: ['szidibox@gmail.com'], subject, bodyText: body.replace('SO-2024-30411\nhttps', 'SO-2024-99999\nhttps') }), null);
});

test('parses real Marketa warehouse packing as order_packing, never shipment', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['marketa.hu'],
    subject: '✅ Marketa.hu - 1140165 rendelés - Jó hír! Elkezdtük rendelésed összekészítését! - Megrendelésedet elfogadtuk',
    bodyText: 'A Marketa.hu oldalon keresztül leadott, 1140165 számú rendeléseddel kapcsolatos fontos információ: Örömmel értesítünk, hogy rendelésedet elfogadtuk és raktárunk már elkezdte becsomagolni. Várhatóan raktárunk 1-2 munkanapon belül átadja azt a futárszolgálatnak, amiről emailben ismét értesíteni fogunk.',
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'order_packing');
  assert.equal(result.extraction.event_type, 'order_updated');
  assert.equal(result.extraction.merchant, 'Marketa.hu');
  assert.equal(result.extraction.order_number, '1140165');
  assert.equal(result.extraction.tracking_number, null);
});

test('Marketa packing requires exact sender and explicit future courier handoff', () => {
  const subject = 'Marketa.hu - 1140165 rendelés - Elkezdtük rendelésed összekészítését!';
  const body = '1140165 számú rendeléseddel kapcsolatban raktárunk már elkezdte becsomagolni.';
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['marketa.hu'], subject, bodyText: body }), null);
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['marketa.hu.attacker.com'], subject, bodyText: `${body} Várhatóan raktárunk 1-2 munkanapon belül átadja azt a futárszolgálatnak.` }), null);
});
