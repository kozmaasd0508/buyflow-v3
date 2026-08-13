import assert from 'node:assert/strict';
import test from 'node:test';
import { parseZalandoCommerceEmail } from './zalando-commerce-adapter.js';

test('parses a real Zalando shipment pattern without AI', () => {
  const result = parseZalandoCommerceEmail({
    senderDomains: ['service-mail.zalando.hu'],
    subject: 'A csomagod 01.27 és 01.28 között fog megérkezni.',
    bodyText: 'Szia Kozma! Csomagodat összeállítottuk és útnak indítottuk! A csomagod nyomon követése https://gls-group.eu/HU/hu/csomagkovetes?match=03034483037 A nyomkövetési számod: 03034483037 Rendelésszám 15810003664462',
  });

  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.merchant, 'Zalando');
  assert.equal(result.extraction.order_number, '15810003664462');
  assert.equal(result.extraction.tracking_number, '03034483037');
  assert.equal(result.extraction.carrier, 'GLS');
});

test('keeps rich Zalando order confirmation on the existing AI path', () => {
  const result = parseZalandoCommerceEmail({
    senderDomains: ['service-mail.zalando.hu'],
    subject: 'Köszönjük a rendelésedet',
    bodyText: 'Nézd meg a megrendelés részleteit. Fizetési mód Utánvétes fizetés. Részösszeg 11 990 Ft. Rendelésszám 15810003664462.',
  });
  assert.equal(result, null);
});

test('does not treat Zalando service mail as shipment without explicit shipment evidence', () => {
  const result = parseZalandoCommerceEmail({
    senderDomains: ['service-mail.zalando.hu'],
    subject: 'A termékértesítő be van állítva. Maradj velünk!',
    bodyText: 'Küldünk neked egy e-mailt, ha a termék ismét elérhetővé válik.',
  });
  assert.equal(result, null);
});

test('does not classify digital delivery note as delivered or shipment', () => {
  const result = parseZalandoCommerceEmail({
    senderDomains: ['service-mail.zalando.hu'],
    subject: 'A digitális szállítóleveled',
    bodyText: 'A csomagodat kiszállítottuk.',
  });
  assert.equal(result, null);
});

test('rejects lookalike Zalando sender domains and missing tracking identity', () => {
  assert.equal(parseZalandoCommerceEmail({
    senderDomains: ['service-mail.zalando.hu.attacker.com'],
    subject: 'A csomagod holnap fog megérkezni.',
    bodyText: 'Csomagodat összeállítottuk és útnak indítottuk! A nyomkövetési számod: 03034483037 Rendelésszám 15810003664462',
  }), null);

  assert.equal(parseZalandoCommerceEmail({
    senderDomains: ['service-mail.zalando.hu'],
    subject: 'A csomagod holnap fog megérkezni.',
    bodyText: 'Csomagodat összeállítottuk és útnak indítottuk! Rendelésszám 15810003664462',
  }), null);
});
