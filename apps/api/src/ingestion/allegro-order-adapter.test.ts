import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroOrderEmail } from './allegro-order-adapter.js';

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
      'Futár utánvét, DPD',
      '1 990,00 Ft',
      'ÖSSZESEN',
      '5 675,00 Ft',
      'Fizetési mód',
      'utánvét',
      'Megrendelés száma',
      '3fe09c80-8d79-11f1-b193-cf13a29b46f5',
    ].join('\n\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'allegro-order-v1');
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.merchant, 'DemoSeller');
  assert.equal(parsed.extraction.order_number, '3fe09c80-8d79-11f1-b193-cf13a29b46f5');
  assert.equal(parsed.extraction.total, 5675);
  assert.equal(parsed.extraction.shipping_amount, 1990);
  assert.equal(parsed.extraction.currency, 'HUF');
  assert.equal(parsed.extraction.payment_status, 'cash_on_delivery');
  assert.equal(parsed.extraction.carrier, 'DPD');
  assert.equal(parsed.extraction.products.length, 2);
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
