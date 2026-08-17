import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseGenericLifecycleEmail,
  parseGenericLifecycleObservations,
} from './generic-lifecycle-adapter.js';

test('real Irodamarket-style mail emits invoice and shipped observations independently', () => {
  const observations = parseGenericLifecycleObservations({
    senderDomains: ['irodamarket.hu'],
    subject: 'Csomagod úton van hozzád és mellékeltük a számlád',
    bodyText: [
      'Ezúton értesítjük, hogy 14107 számú rendelésed átadtuk a DPD futárszolgálatnak',
      'és a levél mellékleteként küldjük a rendelésed számláját is.',
      'Csomagazonosító: 16380091255381',
    ].join('\n'),
  });

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.parserVersion, 'generic-lifecycle-v1.3');
  assert.equal(observations[0]?.extraction.event_type, 'invoice_or_receipt');
  assert.equal(observations[0]?.extraction.order_number, '14107');
  assert.equal(observations[1]?.extraction.event_type, 'shipment');
  assert.equal(observations[1]?.shipmentPhase, 'shipped');
  assert.equal(observations[1]?.extraction.order_number, '14107');
  assert.equal(observations[1]?.extraction.tracking_number, '16380091255381');
});

test('real R-V Webshop-style mail emits invoice and shipment without inventing an invoice id', () => {
  const observations = parseGenericLifecycleObservations({
    senderDomains: ['rvwebshop.co.hu'],
    subject: 'Értesítés',
    bodyText: [
      'Ezúton értesítünk, hogy új elektronikus számlád érkezett',
      'és a 350217 számú rendelésedet átadtuk a futárnak.',
      'A számlát a mellékletben találod.',
    ].join(' '),
  });

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.extraction.event_type, 'invoice_or_receipt');
  assert.equal(observations[0]?.extraction.order_number, '350217');
  assert.equal(observations[0]?.extraction.invoice_number, null);
  assert.equal(observations[1]?.extraction.event_type, 'shipment');
  assert.equal(observations[1]?.shipmentPhase, 'shipped');
});

test('real eDuna-style formal order wording emits invoice and shipment', () => {
  const observations = parseGenericLifecycleObservations({
    senderDomains: ['eduna.hu'],
    subject: 'Értesítés',
    bodyText: [
      'Ezúton értesítjük, hogy 89445 számú rendelését átadtuk a futárnak.',
      'A csomag kézbesítéséről a futár cég fogja tájékoztatni.',
      'Csatolva küldjük az elkészült számlát.',
    ].join('\n'),
  });

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.extraction.event_type, 'invoice_or_receipt');
  assert.equal(observations[0]?.extraction.order_number, '89445');
  assert.equal(observations[1]?.extraction.event_type, 'shipment');
  assert.equal(observations[1]?.shipmentPhase, 'shipped');
  assert.equal(observations[1]?.extraction.order_number, '89445');
});

test('legacy single-result API keeps invoice as primary for combined mail', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['irodamarket.hu'],
    subject: 'Csomagod úton van hozzád és mellékeltük a számlád',
    bodyText: [
      '14107 számú rendelésed átadtuk a DPD futárszolgálatnak.',
      'Mellékleteként küldjük a rendelésed számláját is.',
      'Csomagazonosító: 16380091255381',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'invoice_or_receipt');
  assert.equal(parsed.parserVersion, 'generic-lifecycle-v1.3');
});

test('single shipment still emits exactly one observation', () => {
  const observations = parseGenericLifecycleObservations({
    senderDomains: ['shop.shopbuilder.hu'],
    subject: 'Csomagod úton',
    bodyText: 'Csomagszám: 3406978622\nA rendelt csomagot feladtuk.',
  });

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.extraction.event_type, 'shipment');
  assert.equal(observations[0]?.shipmentPhase, 'shipped');
});

test('future invoice explanation does not create a second observation', () => {
  const observations = parseGenericLifecycleObservations({
    senderDomains: ['orders.demo-shop.hu'],
    subject: 'Rendelésed feladva',
    bodyText: [
      'Rendelésszám: DEMO-889911',
      'Rendelésedet átadtuk a futárszolgálatnak.',
      'A számlát e-mailben küldjük, amikor a csomag kézbesítésre kerül.',
    ].join('\n'),
  });

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.extraction.event_type, 'shipment');
  assert.equal(observations[0]?.shipmentPhase, 'shipped');
});
