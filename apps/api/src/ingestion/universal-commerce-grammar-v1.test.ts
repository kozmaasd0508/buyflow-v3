import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { evaluateUniversalCommerceGrammarV1 } from './universal-commerce-grammar-v1.js';

function email(input: {
  subject: string;
  body: string;
  sender?: string;
}): NormalizedEmail {
  return {
    provider: 'mailgun',
    providerMessageId: `<${Math.random()}@unknown-shop.test>`,
    subject: input.subject,
    from: [{ email: input.sender ?? 'orders@unknown-shop.example', name: 'Unknown Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-24T19:00:00.000Z',
    snippet: input.body,
    folders: ['inbound'],
    attachments: [],
  };
}

function classify(message: NormalizedEmail) {
  return evaluateUniversalCommerceGrammarV1(buildEmailDocumentV1(message));
}

test('unknown merchant order confirmation becomes actionable from independent evidence', () => {
  const result = classify(email({
    subject: 'Megrendelés visszaigazolása',
    body: [
      'Köszönjük, megrendelését megkaptuk.',
      'Rendelésszám: 8734621',
      'Rendelési összesítő:',
      '1x Bosch fúrógép',
      '24 990 Ft',
      'Fizetési mód: Bankkártya',
      'Szállítási mód: Házhozszállítás',
      'Végösszeg: 24 990 Ft',
    ].join('\n'),
  }));

  assert.equal(result.lifecycle, 'order_created');
  assert.equal(result.eventType, 'order_created');
  assert.equal(result.decision, 'actionable');
  assert.ok(result.positiveEvidence.includes('order_identity'));
  assert.ok(result.positiveEvidence.includes('explicit_order_created'));
});

test('packing and future carrier handoff are not classified as shipped', () => {
  const result = classify(email({
    subject: 'A megrendelés összekészítve, feladásra várakozik',
    body: [
      'Rendelésszám: 44822',
      'Csomagját összekészítettük, jelenleg feladásra vár.',
      'Hamarosan átadjuk a csomagot a futárszolgálatnak.',
      'Végösszeg: 10 030 Ft',
    ].join('\n'),
  }));

  assert.equal(result.lifecycle, 'order_processing');
  assert.equal(result.eventType, 'order_updated');
  assert.equal(result.decision, 'actionable');
  assert.ok(result.negativeEvidence.includes('not_yet_shipped'));
});

test('explicit shipment language becomes shipped for an unknown merchant', () => {
  const result = classify(email({
    subject: 'Rendelés elküldve',
    body: [
      'Rendelésszám: 25051657',
      'A rendelésed elküldve, a csomag úton van.',
      'Csomagszám: 90635257523',
    ].join('\n'),
  }));

  assert.equal(result.lifecycle, 'shipped');
  assert.equal(result.eventType, 'shipment');
  assert.equal(result.decision, 'actionable');
});

test('out-for-delivery and delivered are separate lifecycle states', () => {
  const outForDelivery = classify(email({
    subject: 'Csomagja a kézbesítőnél van',
    body: 'Küldeményazonosító: PN9S650213812\nCsomagját kézbesítőnk átvette, ma kézbesítjük.',
    sender: 'notice@carrier-example.hu',
  }));
  assert.equal(outForDelivery.lifecycle, 'out_for_delivery');
  assert.equal(outForDelivery.eventType, 'shipment');

  const delivered = classify(email({
    subject: 'Sikeres kézbesítés',
    body: 'Küldeményazonosító: PN9S650213812\nA csomag kézbesítve, az átvétel megtörtént.',
    sender: 'notice@carrier-example.hu',
  }));
  assert.equal(delivered.lifecycle, 'delivered');
  assert.equal(delivered.eventType, 'delivery');
});

test('generic order cancellation is a lifecycle update, not a new order', () => {
  const result = classify(email({
    subject: '#1000597074 számú megrendelés törlése',
    body: 'Rendelésszám: 1000597074\nTájékoztatunk, hogy a rendelésed törölted.',
  }));

  assert.equal(result.lifecycle, 'order_cancelled');
  assert.equal(result.eventType, 'order_updated');
  assert.equal(result.decision, 'actionable');
});

test('post-purchase review request is blocked even when it contains an order id', () => {
  const result = classify(email({
    subject: 'Order #19601, how did it go?',
    body: 'Order number: 19601\nPlease share your review and rate your purchase.',
  }));

  assert.equal(result.lifecycle, 'review_request');
  assert.equal(result.eventType, null);
  assert.equal(result.decision, 'blocked');
  assert.ok(result.negativeEvidence.includes('review_request_language'));
});

test('promotion containing the word order is not enough', () => {
  const result = classify(email({
    subject: 'Rendelés most 20% kedvezménnyel!',
    body: 'Csak vasárnap éjfélig él a kedvezmény. Nézd meg ajánlatainkat!',
    sender: 'newsletter@unknown-shop.example',
  }));

  assert.equal(result.lifecycle, 'unknown');
  assert.equal(result.eventType, null);
  assert.equal(result.decision, 'review');
});

test('invoice, payment and refund are semantic events independent of merchant name', () => {
  const invoice = classify(email({
    subject: 'Számlája elkészült',
    body: 'Rendelésszám: 8734621\nA számla elkészült és elérhető.\nVégösszeg: 24 990 Ft',
  }));
  assert.equal(invoice.lifecycle, 'invoice');
  assert.equal(invoice.eventType, 'invoice_or_receipt');

  const payment = classify(email({
    subject: 'Fizetés sikeres',
    body: 'Rendelésszám: 8734621\nSikeres tranzakció.\nÖsszeg: 24 990 Ft',
  }));
  assert.equal(payment.lifecycle, 'payment_completed');
  assert.equal(payment.eventType, 'payment_completed');

  const refund = classify(email({
    subject: 'Visszatérítés elindult',
    body: 'Rendelésszám: 8734621\nA visszatérítés elindult.\nÖsszeg: 24 990 Ft',
  }));
  assert.equal(refund.lifecycle, 'refund');
  assert.equal(refund.eventType, 'refund');
});
