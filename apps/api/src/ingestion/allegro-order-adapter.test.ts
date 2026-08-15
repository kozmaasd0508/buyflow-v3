import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroOrderEmail } from './allegro-order-adapter.js';

function commonTail() {
  return [
    'Futár utánvét, DPD',
    '1 990,00 Ft',
    'ÖSSZESEN',
    '5 675,00 Ft',
    'Fizetési mód',
    'utánvét',
    'Megrendelés száma',
    '3fe09c80-8d79-11f1-b193-cf13a29b46f5',
  ];
}

test('parses a rich Allegro marketplace purchase without AI', () => {
  const parsed = parseAllegroOrderEmail({
    senderDomains: ['allegro.com'],
    subject: 'Megvásároltad: Kulacs szett + 1 egyéb termék DemoSeller eladótól.',
    bodyText: [
      'Szia Teszt,',
      'megvásároltad 2 terméket DemoSeller eladótól.',
      'Vásárlás és szállítás',
      'tőle: DemoSeller',
      '[Kulacs szett](https://t.allegro.hu/ajanlat/kulacs-szett-12345678901)',
      '[(12345678901)](https://t.allegro.hu/ajanlat/kulacs-szett-12345678901)',
      '1 830,00 Ft',
      '[Második termék](https://t.allegro.hu/ajanlat/masodik-termek-12345678902)',
      '[(12345678902)](https://t.allegro.hu/ajanlat/masodik-termek-12345678902)',
      '1 855,00 Ft',
      ...commonTail(),
    ].join('\n\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'allegro-order-v1.4');
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.merchant, 'DemoSeller');
  assert.equal(parsed.extraction.order_number, '3fe09c80-8d79-11f1-b193-cf13a29b46f5');
  assert.equal(parsed.extraction.total, 5675);
  assert.equal(parsed.extraction.shipping_amount, 1990);
  assert.equal(parsed.extraction.currency, 'HUF');
  assert.equal(parsed.extraction.payment_status, 'cash_on_delivery');
  assert.equal(parsed.extraction.carrier, 'DPD');
  assert.equal(parsed.extraction.products.length, 2);
  assert.equal(parsed.extraction.products[0]?.unit_price, 1830);
  assert.equal(parsed.extraction.products[1]?.unit_price, 1855);
});

test('parses htmlToCompactText Allegro URL markers used in production', () => {
  const parsed = parseAllegroOrderEmail({
    senderDomains: ['allegro.com'],
    subject: 'Megvásároltad: Kulacs szett + 1 egyéb termék DemoSeller eladótól.',
    bodyText: [
      'Szia Teszt,',
      'megvásároltad 2 terméket DemoSeller eladótól.',
      'Vásárlás és szállítás',
      'tőle: DemoSeller [URL: https://allegro.hu/felhasznalo/DemoSeller]',
      'Kulacs szett [URL: https://t.allegro.hu/ajanlat/kulacs-szett-12345678901]',
      '(12345678901) [URL: https://t.allegro.hu/ajanlat/kulacs-szett-12345678901]',
      '1\u202f830,00 Ft',
      'Második termék [URL: https://t.allegro.hu/ajanlat/masodik-termek-12345678902]',
      '(12345678902) [URL: https://t.allegro.hu/ajanlat/masodik-termek-12345678902]',
      '1\u202f855,00 Ft',
      'Futár utánvét, DPD',
      '1\u202f990,00 Ft',
      'ÖSSZESEN',
      '5\u202f675,00 Ft',
      'Fizetési mód',
      'utánvét',
      'Megrendelés száma',
      '3fe09c80-8d79-11f1-b193-cf13a29b46f5',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.merchant, 'DemoSeller');
  assert.equal(parsed.extraction.products.length, 2);
  assert.equal(parsed.extraction.products[0]?.sku, '12345678901');
  assert.equal(parsed.extraction.products[0]?.unit_price, 1830);
  assert.equal(parsed.extraction.products[1]?.unit_price, 1855);
  assert.equal(parsed.extraction.shipping_amount, 1990);
  assert.equal(parsed.extraction.total, 5675);
});

test('parses a flattened table layout and recovers order id from purchase-history URL', () => {
  const orderId = '3fe09c80-8d79-11f1-b193-cf13a29b46f5';
  const parsed = parseAllegroOrderEmail({
    senderDomains: ['allegro.com'],
    subject: 'Megvásároltad: Kulacs szett + 1 egyéb termék DemoSeller eladótól.',
    bodyText: [
      'Szia Teszt, megvásároltad 2 terméket DemoSeller eladótól.',
      `Vásárlás részletei [URL: https://t.allegro.hu/allegro-fiokom/vasarlasok/vasarlasi-elozmenyek/${orderId}?utm_source=notification]`,
      'Vásárlás és szállítás tőle: DemoSeller [URL: https://allegro.hu/felhasznalo/DemoSeller]',
      'Kulacs szett [URL: https://t.allegro.hu/ajanlat/kulacs-szett-12345678901?x=1]',
      '(12345678901) [URL: https://t.allegro.hu/ajanlat/kulacs-szett-12345678901?x=2] 1 830,00 Ft',
      'Második termék [URL: https://t.allegro.hu/ajanlat/masodik-termek-12345678902?x=1]',
      '(12345678902) [URL: https://t.allegro.hu/ajanlat/masodik-termek-12345678902?x=2] 1 855,00 Ft',
      'Futár utánvét, DPD, Minta utca 12 1 990,00 Ft',
      'ÖSSZESEN 5 675,00 Ft Fizetési mód utánvét',
    ].join(' '),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.order_number, orderId);
  assert.equal(parsed.extraction.merchant, 'DemoSeller');
  assert.equal(parsed.extraction.total, 5675);
  assert.equal(parsed.extraction.shipping_amount, 1990);
  assert.equal(parsed.extraction.payment_method, 'utánvét');
  assert.equal(parsed.extraction.products.length, 2);
  assert.equal(parsed.extraction.products[0]?.sku, '12345678901');
  assert.equal(parsed.extraction.products[0]?.unit_price, 1830);
  assert.equal(parsed.extraction.products[1]?.sku, '12345678902');
  assert.equal(parsed.extraction.products[1]?.unit_price, 1855);
});

test('rejects Allegro-like mail without explicit purchase evidence', () => {
  const parsed = parseAllegroOrderEmail({
    senderDomains: ['allegro.com'],
    subject: 'Csomagod úton van',
    bodyText: 'Megrendelés száma\n3fe09c80-8d79-11f1-b193-cf13a29b46f5',
  });
  assert.equal(parsed, null);
});

test('rejects lookalike Allegro sender', () => {
  const parsed = parseAllegroOrderEmail({
    senderDomains: ['allegro-example.com'],
    subject: 'Megvásároltad: valami',
    bodyText: 'megvásároltad 1 terméket DemoSeller eladótól.',
  });
  assert.equal(parsed, null);
});
