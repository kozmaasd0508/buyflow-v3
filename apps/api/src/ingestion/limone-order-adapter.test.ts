import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLimoneOrderEmail } from './limone-order-adapter.js';

const body = `Tisztelt Kozma Gábor!
Webáruházunkban rendelést adott le.
Termékek
Név
Bruttó ár
Mennyiség
Bruttó ár összesen
Lattafa Yara EDP 100ml Női Parfüm [URL: https://www.limone.hu/spd/l36/Lattafa-Yara-EDP-100ml-Noi-Parfum] (l36)
8 054 Ft
1 db
8 054 Ft
2x Illatminta jár ajándékba! [URL: https://www.limone.hu/Titkos-ajandek] (aji1alap)
366 Ft
1 db
366 Ft
Kedvezmény [Ajándék: aji1alap]
-366 Ft
1 db
-366 Ft
Összesen
8 054 Ft
Szállítási költség
1 090 Ft
Fizetési kezelési költség
290 Ft
Végösszeg
9 434 Ft
Megrendelés adatok
Azonosító
98691-106627
Szállítási mód
ExpressOne házhoz szállítás
Fizetési mód
Utánvétes fizetés
Köszönjük, hogy webáruházunkban vásárolt!
Ez egy automata visszaigazolás a megrendelés leadásáról, nem jelenti a szerződés létrejöttét.`;

test('parses a Limone order confirmation even when Gmail does not classify it as Purchases', () => {
  const parsed = parseLimoneOrderEmail({
    senderDomains: ['limone.hu'],
    subject: 'Parfümök online a Limone.hu-n - Automata megrendelés visszaigazolás - 98691-106627',
    bodyText: body,
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.order_number, '98691-106627');
  assert.equal(parsed.extraction.merchant, 'Limone.hu');
  assert.equal(parsed.extraction.subtotal, 8054);
  assert.equal(parsed.extraction.shipping_amount, 1090);
  assert.equal(parsed.extraction.discount_amount, 366);
  assert.equal(parsed.extraction.total, 9434);
  assert.equal(parsed.extraction.currency, 'HUF');
  assert.equal(parsed.extraction.payment_status, 'cash_on_delivery');
  assert.equal(parsed.extraction.carrier, 'Express One');
  assert.equal(parsed.extraction.products.length, 2);
  assert.equal(parsed.extraction.products[0]?.sku, 'l36');
  assert.equal(parsed.extraction.products[0]?.total_price, 8054);
});

test('requires the same order number in subject and body', () => {
  const parsed = parseLimoneOrderEmail({
    senderDomains: ['limone.hu'],
    subject: 'Automata megrendelés visszaigazolás - 98691-999999',
    bodyText: body,
  });
  assert.equal(parsed, null);
});

test('does not accept a lookalike sender domain', () => {
  const parsed = parseLimoneOrderEmail({
    senderDomains: ['limone.hu.evil.example'],
    subject: 'Automata megrendelés visszaigazolás - 98691-106627',
    bodyText: body,
  });
  assert.equal(parsed, null);
});
