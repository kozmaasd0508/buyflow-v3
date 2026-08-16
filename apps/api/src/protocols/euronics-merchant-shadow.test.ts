import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.euronics');
}

const AUTH = {
  senderDomains: ['euronics.hu'],
  senderAddresses: ['ugyfelszolgalat@euronics.hu'],
  dkimDomains: ['euronics.hu'],
};

test('Euronics recorded order is ORDER_CREATED and remains shadow-only', () => {
  const input = {
    ...AUTH,
    subject: 'A(z) 85559766 számú rendelésedet fogadtuk!',
    bodyText: [
      'Köszönjük, hogy vásárlásodhoz az Euronics.hu webáruházat választottad.',
      'Rendelésed rögzítettük.',
      'Rendelésed feldolgozását megkezdtük.',
      'Amint terméked átadjuk a futárszolgálatnak, azonnal értesíteni fogunk.',
      'Rendelés azonosító: 85559766',
      'Fizetési mód: Online hitel',
      'Szállítás várható ideje: Sikeres hitelelbírálás után',
      '30 napos elállás',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '85559766');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
});

test('Euronics negative credit decision cancels order but is not payment failure', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'A(z) 85559766 számú rendelésed töröltük',
    bodyText: [
      'Ezúton tájékoztatunk, hogy 85559766 számú megrendelésed töröltük, mert a hiteligénylés elbírálása negatív eredménnyel zárult.',
      'Rendelés azonosító: 85559766',
      'Fizetési mód: Online hitel',
      'Hitelintézet neve: OTP',
      'Állapot: Feldolgozás alatt',
      '30 napos elállás',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'CANCELLED');
  assert.equal(evidence[0]?.identifiers.order_id, '85559766');
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_FAILED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
});

test('Euronics one-time login link is OTHER and cannot create purchase', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Egyszeri belépésre jogosító link',
    bodyText: [
      'Az alábbi linkre kattintva jelszó nélkül beléptetünk az oldalra.',
      'A link a küldéstől számított 60 percig él, és csak egyszer használható.',
      'Tovább a vásárláshoz',
      '30 napos elállás',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
});

test('Euronics marketing/footer withdrawal wording is not RETURN', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'A(z) 85559766 számú rendelésedet fogadtuk!',
    bodyText: [
      'Rendelésed rögzítettük.',
      'Rendelésed feldolgozását megkezdtük.',
      'Rendelés azonosító: 85559766',
      '30 napos elállás',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
});

test('Euronics wrong DKIM rejects otherwise matching order', () => {
  assert.deepEqual(rows({
    ...AUTH,
    dkimDomains: ['euronics.hu.attacker.example'],
    subject: 'A(z) 85559766 számú rendelésedet fogadtuk!',
    bodyText: 'Rendelésed rögzítettük. Rendelésed feldolgozását megkezdtük. Rendelés azonosító: 85559766',
  }), []);
});

test('Euronics lookalike sender rejects otherwise matching order', () => {
  assert.deepEqual(rows({
    senderDomains: ['euronics.hu'],
    senderAddresses: ['orders@euronics.hu'],
    dkimDomains: ['euronics.hu'],
    subject: 'A(z) 85559766 számú rendelésedet fogadtuk!',
    bodyText: 'Rendelésed rögzítettük. Rendelésed feldolgozását megkezdtük. Rendelés azonosító: 85559766',
  }), []);
});

test('Euronics documented but unobserved lifecycle templates stay unsupported', () => {
  const unsupported = [
    ['A(z) 85559766 számú rendelésed feladtuk', 'Csomagod átadtuk a futárszolgálatnak. Csomagszám: 1234567890.'],
    ['A rendelésed átvehető', 'A 85559766 számú rendelésed átvehető az Euronics áruházban.'],
    ['Számlád elkészült', 'A 85559766 rendeléshez tartozó számlát csatoltuk.'],
    ['Elállás visszaigazolása', 'A 85559766 számú rendeléshez elállási kérelmet rögzítettünk.'],
    ['Visszatérítés', 'A 85559766 rendelés összegét visszatérítettük.'],
    ['Kézbesítve', 'A 85559766 rendelést sikeresen kézbesítettük.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});
