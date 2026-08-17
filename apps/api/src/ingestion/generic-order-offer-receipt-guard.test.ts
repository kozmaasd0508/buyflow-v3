import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericOrderConfirmationEmail } from './generic-order-confirmation-adapter.js';

test('generic parser rejects Hungarian offer-receipt acknowledgement that explicitly denies order confirmation', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.ismeretlen-bolt.hu'],
    subject: 'Megrendelési szám: 77889901',
    bodyText: [
      'Köszönjük rendelésed!',
      'Megrendelés azonosító: 77889901',
      'Rendelés részletei',
      'Végösszeg: 24 990 Ft',
      'Fizetési mód: Bankkártya',
      'Szállítási mód: GLS',
      'Ez az e-mail nem minősül a megrendelés visszaigazolásának, csupán a vételi ajánlat megérkezéséről értesítünk.',
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('generic parser rejects English acknowledgement that explicitly says the order is not accepted yet', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.unknown-store.example'],
    subject: 'Order confirmation ORD-77881',
    bodyText: [
      'We have received your order.',
      'Order number: ORD-77881',
      'Order details',
      'Grand total: 79.00 EUR',
      'Payment method: Visa',
      'Shipping method: Standard',
      'This email does not constitute acceptance of your order. Your order has not yet been accepted.',
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('generic parser still recognizes a normal Hungarian order confirmation without non-acceptance wording', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.valodi-demo.hu'],
    subject: 'Megrendelés visszaigazolás HU-2026-8811',
    bodyText: [
      'Köszönjük megrendelésed!',
      'Megrendelés azonosító: HU-2026-8811',
      'Megrendelés adatai',
      'Végösszeg: 24 990 Ft',
      'Fizetési mód: Utánvét',
      'Szállítási mód: GLS',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'generic-order-confirmation-v1.3');
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.order_number, 'HU-2026-8811');
});

test('trusted JatekBolt order-received adapter remains available despite its explicit non-acceptance disclaimer', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['jatekbolt.hu'],
    subject: 'Megrendelési szám: 12247833',
    bodyText: [
      'Köszönjük rendelésed',
      'Ez az e-mail nem minősül a megrendelés visszaigazolásának, csupán a vételi ajánlat megérkezéséről értesítünk.',
      'Megrendelésed részletei',
      'Rendelési szám: 12247833',
      'Termékek összesen: 10 000 Ft',
      'Futárszolgálat DPD: 1 490 Ft',
      'Engedmény: 0 Ft',
      'Összesen: 11 490 Ft',
      'Fizetési mód: Klarna',
      'Szállítási mód: DPD',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'jatekbolt-order-received-v1');
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.order_number, '12247833');
  assert.equal(parsed.extraction.payment_status, 'pending');
});
