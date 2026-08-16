import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.emag');
}

const AUTH = {
  senderDomains: ['emag.hu'],
  senderAddresses: ['no-reply-t@emag.hu'],
  dkimDomains: ['emag.hu'],
};

const CART_BODY = [
  'Ne feledkezz meg a kosárba helyezett termékekről!',
  'Észrevettük, hogy rátaláltál a keresett termékekre, kosárba is helyezted azokat, de a rendelést nem véglegesítetted.',
  'Ügyelj arra, hogy a termékek kosárba helyezése nem jelenti azok lefoglalását, így érdemes lenne mielőbb véglegesítened a rendelést!',
  'Mentett bankkártyával történő fizetés esetén a rendelés lemondását követően 30 percen belül visszatérítjük a vételárat.',
  'Mégsem felel meg a termék? 30 napig termékvisszaküldést indíthatsz.',
  'Példa termék',
  '1 db.',
  '70.888 Ft',
].join('\n');

test('eMAG abandoned cart is shadow OTHER and production cannot see it', () => {
  const input = {
    ...AUTH,
    subject: 'Kozma Teszt, íme néhány tipp, miért érdemes befejezned a rendelésed!',
    bodyText: CART_BODY,
  };

  assert.deepEqual(detectProtocolEvidence(input), []);

  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('eMAG abandoned cart refund and return wording never becomes lifecycle', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Kozma Teszt, íme néhány tipp, miért érdemes befejezned a rendelésed!',
    bodyText: CART_BODY,
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['OTHER']);
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('eMAG cart-abandon profile accepts observed e2 sender generation with emag.hu DKIM', () => {
  const evidence = rows({
    senderDomains: ['e2.emag.hu'],
    senderAddresses: ['no-reply-t@e2.emag.hu'],
    dkimDomains: ['emag.hu'],
    subject: 'Teszt, íme néhány tipp, miért érdemes befejezned a rendelésed!',
    bodyText: CART_BODY,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
});

test('eMAG lookalike DKIM is rejected', () => {
  assert.deepEqual(rows({
    ...AUTH,
    dkimDomains: ['emag.hu.attacker.example'],
    subject: 'Teszt, íme néhány tipp, miért érdemes befejezned a rendelésed!',
    bodyText: CART_BODY,
  }), []);
});

test('eMAG marketing about shipping is not a logistics lifecycle event', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Szombaton is szállítunk easyboxba országszerte!',
    bodyText: 'Nézd meg aktuális ajánlatainkat! Rendelj easyboxba és élvezd a kedvezményes szállítást.',
  }), []);
});

test('eMAG marketing cashback wording is not REFUNDED', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Akár 120.000 Ft visszatérítés!',
    bodyText: 'A megjelölt termékek vásárlása esetén promóciós pénzvisszatérítés érhető el.',
  }), []);
});

test('eMAG subject alone is insufficient for abandoned-cart classification', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Teszt, íme néhány tipp, miért érdemes befejezned a rendelésed!',
    bodyText: 'Tekintsd meg ajánlatainkat.',
  }), []);
});

test('eMAG provider identity alone does not invent unverified transactional lifecycle', () => {
  const unsupported = [
    ['Rendelésed visszaigazolása', 'Köszönjük rendelésed. Rendelésszám: 123456789.'],
    ['Csomagodat átadtuk a futárnak', 'Rendelés 123456789 átadva a futárszolgálatnak.'],
    ['Rendelésed kézbesítve', 'Rendelés 123456789 sikeresen kézbesítve.'],
    ['Visszatérítés megtörtént', 'A rendelésed összegét visszatérítettük.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});
