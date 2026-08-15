import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericOrderConfirmationEmail } from './generic-order-confirmation-adapter.js';

const body = `Rendelés: #1783-975-87-395

Kedves Kozma Gábor!

Köszönjük megrendelésedet. A rendelést számítógépes rendszerünk eltárolta, a rendelés feldolgozását munkatársaink rövidesen megkezdik.

A rendelés részletei:

100% Whey Protein Professional (1 kg)
Íz: csokoládé
Scitec Nutrition
1 db. ×
15 990 Ft = 15 990 Ft

Whey Infusion (25 gr.)
Íz: csokoládé fagyi, Egyéb: free_sample
Scitec Nutrition
1 db. ×
0 Ft = 0 Ft

Rendelt termékek értéke összesen:
15 990 Ft

Szállítás (FOXPOST - Packeta Group (fizetés csak bankkártyával)):
790 Ft

Végösszeg:
16 780 Ft`;

test('parses a Hungarian Rendelés: #... confirmation without merchant-specific code', () => {
  const result = parseGenericOrderConfirmationEmail({
    senderDomains: ['scitec.hu'],
    subject: 'Kedves Kozma Gábor, Scitec Nutrition rendelésed: 2026-07-13 22:51:16-kor rögzítettük! (1783-975-87-395)',
    bodyText: body,
  });
  assert.ok(result);
  assert.equal(result.parserVersion, 'generic-order-confirmation-v1.2');
  assert.equal(result.extraction.event_type, 'order_created');
  assert.equal(result.extraction.order_number, '1783-975-87-395');
  assert.equal(result.extraction.total, 16780);
  assert.equal(result.extraction.currency, 'HUF');
  assert.equal(result.extraction.merchant, 'Scitec');
  assert.ok(result.reasons.includes('generic_labeled_total'));
  assert.ok(result.reasons.includes('generic_order_details_section'));
});

test('does not turn a marketing sentence with Rendelés: into an order without confirmation evidence', () => {
  const result = parseGenericOrderConfirmationEmail({
    senderDomains: ['shop.example.hu'],
    subject: 'Nézd meg korábbi rendelésedet',
    bodyText: 'Rendelés: #12345678\nA rendelés részletei: korábbi vásárlásod. Vásárolj újra 20% kedvezménnyel. Végösszeg: 12 990 Ft',
  });
  assert.equal(result, null);
});

test('still rejects public-mailbox senders even with realistic order text', () => {
  const result = parseGenericOrderConfirmationEmail({
    senderDomains: ['gmail.com'],
    subject: 'Rendelés visszaigazolás',
    bodyText: 'Rendelés: #12345678\nKöszönjük megrendelésedet. A rendelés részletei:\nVégösszeg: 12 990 Ft',
  });
  assert.equal(result, null);
});
