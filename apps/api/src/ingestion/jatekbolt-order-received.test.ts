import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericOrderConfirmationEmail } from './generic-order-confirmation-adapter.js';

const body = [
  'Kedves Vásárló!',
  'Köszönjük rendelésed, amelynek állapotáról e-mailben folyamatosan tájékoztatni fogunk.',
  'Ez az e-mail nem minősül a megrendelés visszaigazolásának, csupán a vételi ajánlat megérkezéséről értesítünk.',
  'Megrendelésed visszaigazolása a következő e-mailünkben fog érkezni.',
  'Megrendelésed részletei:',
  'Rendelési szám: 98765432',
  'Termékek összesen:',
  '52 775 Ft',
  'Futárszolgálat DPD:',
  '750 Ft',
  'Engedmény (27% ÁFA):',
  '-5 280 Ft',
  'Összesen:',
  '48 245 Ft',
  'Szállítási mód',
  'Futárszolgálat DPD',
  'Fizetési mód:',
  'Klarna',
].join('\n');

test('parses strict Jatekbolt order-received message without pretending it is merchant acceptance', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['jatekbolt.hu'],
    subject: 'Megrendelési szám: 98765432',
    bodyText: body,
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'jatekbolt-order-received-v1');
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.merchant, 'JatekBolt.hu');
  assert.equal(parsed.extraction.merchant_legal_name, 'Model & Hobby Kft.');
  assert.equal(parsed.extraction.order_number, '98765432');
  assert.equal(parsed.extraction.subtotal, 52775);
  assert.equal(parsed.extraction.shipping_amount, 750);
  assert.equal(parsed.extraction.discount_amount, 5280);
  assert.equal(parsed.extraction.total, 48245);
  assert.equal(parsed.extraction.currency, 'HUF');
  assert.equal(parsed.extraction.payment_method, 'Klarna');
  assert.equal(parsed.extraction.payment_status, 'pending');
  assert.equal(parsed.extraction.shipping_method, 'Futarszolgalat DPD');
  assert.equal(parsed.extraction.carrier, 'DPD');
  assert.ok(parsed.reasons.includes('explicitly_not_merchant_acceptance_yet'));
});

test('Jatekbolt order-received parsing requires the real merchant domain', () => {
  assert.equal(parseGenericOrderConfirmationEmail({
    senderDomains: ['jatekbolt.hu.attacker.example'],
    subject: 'Megrendelési szám: 98765432',
    bodyText: body,
  }), null);
});

test('Jatekbolt order-received parsing rejects mismatched subject and body order ids', () => {
  assert.equal(parseGenericOrderConfirmationEmail({
    senderDomains: ['jatekbolt.hu'],
    subject: 'Megrendelési szám: 98765433',
    bodyText: body,
  }), null);
});

test('Jatekbolt dispatch message is not reclassified as an order-received message', () => {
  assert.equal(parseGenericOrderConfirmationEmail({
    senderDomains: ['jatekbolt.hu'],
    subject: 'Megrendelési szám: #98765432',
    bodyText: [
      'Megrendelésed köszönjük, a csomagod átadtuk a DPD futárszolgálatnak.',
      'Rendelési szám: 98765432',
      'Megrendelésed részletei:',
      'Termékek összesen: 52 775 Ft',
      'Összesen: 48 245 Ft',
      'Fizetési mód: Klarna',
      'Szállítási mód: Futárszolgálat DPD',
    ].join('\n'),
  }), null);
});

test('Jatekbolt order-received parsing rejects inconsistent money reconciliation', () => {
  const inconsistent = body.replace('48 245 Ft', '48 244 Ft');
  assert.equal(parseGenericOrderConfirmationEmail({
    senderDomains: ['jatekbolt.hu'],
    subject: 'Megrendelési szám: 98765432',
    bodyText: inconsistent,
  }), null);
});
