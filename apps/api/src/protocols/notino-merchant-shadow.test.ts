import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.notino');
}

const AUTH = {
  senderDomains: ['notino.hu'],
  senderAddresses: ['info@notino.hu'],
  dkimDomains: ['notino.hu'],
};

const CART_BODY = [
  '[| notino.hu |](https://www.notino.hu/?utm_source=test&utm_medium=email&utm_campaign=unfinished-order&utm_content=header-notino)',
  'Kár lenne nem befejezni a megrendelést.',
  'A választása:',
  '[Teszt parfüm](https://www.notino.hu/order-reorder.asp?pk=SYNTHETIC&utm_source=test&utm_medium=email&utm_campaign=unfinished-order&utm_content=product_list-product)',
  'Eau de Parfum',
  '1 db 8310 Ft',
  'Teljes ár (ÁFÁ-val)',
  '8310 Ft',
  'Szerezzen örömet magának és rendelje meg amit kiválasztott. Csak néhány kattintás.',
].join('\n');

test('Notino unfinished cart is shadow OTHER and production cannot see it', () => {
  const input = {
    ...AUTH,
    subject: 'A kosárban Önre várnak a termékek',
    bodyText: CART_BODY,
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.equal(evidence[0]?.identifiers.tracking_id, null);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('Notino concrete product quantity price and reorder URL do not create purchase identity', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'A kosárban Önre várnak a termékek',
    bodyText: CART_BODY,
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['OTHER']);
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('Notino unfinished-cart subject alone is insufficient', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'A kosárban Önre várnak a termékek',
    bodyText: 'Tekintse meg a kiválasztott termékeket.',
  }), []);
});

test('Notino incomplete generic basket copy without unfinished-order campaign is insufficient', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'A kosárban Önre várnak a termékek',
    bodyText: [
      'Kár lenne nem befejezni a megrendelést.',
      'Rendelje meg amit kiválasztott.',
      '1 db 8310 Ft',
    ].join('\n'),
  }), []);
});

test('Notino lookalike DKIM is rejected', () => {
  assert.deepEqual(rows({
    ...AUTH,
    dkimDomains: ['notino.hu.attacker.example'],
    subject: 'A kosárban Önre várnak a termékek',
    bodyText: CART_BODY,
  }), []);
});

test('Notino password-change email on same authenticated channel is not commerce lifecycle', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'A notino.hu fiókjához tartozó belépési adatok módosítása',
    bodyText: [
      '[| notino.hu |](https://www.notino.hu/?utm_source=transaction-email&utm_medium=email&utm_campaign=new-password&utm_content=header-notino)',
      'Kérvény a bejelentkezési adatok módosításához',
      'A notino.hu fiókjához tartozó jelszó módosításához kattintson a következő gombra.',
    ].join('\n'),
  }), []);
});

test('Notino newsletter and club senders do not inherit transactional lifecycle authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['notino.hu'],
    senderAddresses: ['newsletter@notino.hu'],
    dkimDomains: ['notino.hu'],
    subject: 'Úton vannak Önhöz a nagy kedvezmények',
    bodyText: 'Rendeljen most ingyenes szállítással.',
  }), []);

  assert.deepEqual(rows({
    senderDomains: ['notino.hu'],
    senderAddresses: ['club@notino.hu'],
    dkimDomains: ['notino.hu'],
    subject: 'Hűségpontokat nemcsak a vásárlásáért kap',
    bodyText: 'Notino Club ajánlat.',
  }), []);
});

test('official-like packing wording is not promoted without a verified recipient template', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'A csomagja készül',
    bodyText: [
      'A csomagot éppen csomagoljuk a raktárban és kiküldésre készítjük.',
      'A csomag hamarosan mozgásba kerül.',
    ].join('\n'),
  }), []);
});

test('invented Notino lifecycle wording remains unsupported until directly observed', () => {
  const unsupported = [
    ['Rendelés visszaigazolása', 'Köszönjük rendelését. Rendelésszám: TEST-10001.'],
    ['A csomagot átadtuk szállításra', 'A csomag már a szállítónál van. Csomagszám: TEST-PARCEL-1.'],
    ['Rendelése kézbesítve', 'A rendelés sikeresen kézbesítve.'],
    ['Sikertelen kézbesítés', 'A csomag kézbesítése nem sikerült.'],
    ['Fizetés sikeres', 'Az online bankkártyás fizetés sikeres.'],
    ['Számla', 'Elektronikus számláját mellékelten küldjük.'],
    ['Visszaküldés', 'A visszaküldési kérelmet rögzítettük.'],
    ['Visszatérítés', 'A vételárat visszatérítettük.'],
    ['Rendelés törölve', 'A rendelését töröltük.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});

test('return-policy wording never invents a settled refund', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Visszaküldési tájékoztató',
    bodyText: 'A termék visszaküldhető. A visszatérítéssel várhatunk, amíg a termék vissza nem érkezik vagy a visszaküldést nem igazolja.',
  }), []);
});
