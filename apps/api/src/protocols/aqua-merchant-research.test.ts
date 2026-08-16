import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { AQUA_MERCHANT_RESEARCH_V1 } from './profiles/aqua-merchant-research-v1.js';

function rows(input: Parameters<typeof detectProtocolEvidence>[0]) {
  return detectProtocolEvidence(input, [AQUA_MERCHANT_RESEARCH_V1]);
}

const AUTH = {
  senderDomains: ['aqua.hu'],
  senderAddresses: ['noreply@aqua.hu'],
};

test('AQUA research profile is invisible to production detector', () => {
  const input = {
    ...AUTH,
    subject: 'Rendelésed beérkezett',
    bodyText: [
      'Rendelésed beérkezett és rögzítettük.',
      'A megrendelés kizárólag az Aqua Webáruház ügyintézőjének visszajelzése után tekinthető visszaigazoltnak.',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('AQUA first system order email does not become accepted purchase', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Rendelésed rögzítve',
    bodyText: [
      'Megrendelésed rögzítettük.',
      'A rendelés csak az AQUA ügyintéző visszaigazolása után tekinthető elfogadottnak.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('AQUA explicit later acceptance is research ORDER_CREATED only', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Rendelés visszaigazolva',
    bodyText: [
      'A rendelésedet sikeresen visszaigazoltuk.',
      'Az AQUA ezúton visszaigazolja és elfogadja a megrendelést.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.equal(evidence[0]?.identifiers.order_id, null);
});

test('AQUA withdrawal confirmation is OTHER, not RETURN or REFUNDED', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Elállási nyilatkozat visszaigazolása',
    bodyText: 'Elállási nyilatkozatodat rögzítettük, elállási szándékodat visszaigazoljuk.',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('AQUA warranty certificate delivery is documentation, not WARRANTY claim', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Jótállási jegy',
    bodyText: 'A csomagfeladás után a jótállási jegyet PDF formátumban megküldjük.',
    attachmentFilenames: ['jotallasi-jegy.pdf'],
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence.some((row) => row.event_candidate === 'WARRANTY'), false);
});

test('AQUA current Saferpay wording does not invent payment lifecycle', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Bankkártyás fizetés',
    bodyText: 'A fizetés a tanúsítvánnyal rendelkező Saferpay fizetőkapun keresztül történik.',
  }), []);
});

test('AQUA delivery-date wording alone does not invent shipment lifecycle', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Kiszállítási információ',
    bodyText: 'A megrendelés kiszállítási dátuma és időpontja: holnap 10:00-14:00.',
  }), []);
});

test('AQUA unsupported invoice and final lifecycle wording remains unsupported', () => {
  const unsupported = [
    ['Számla', 'A rendelésedhez elkészült a számla.'],
    ['Csomag feladva', 'A csomagodat átadtuk a futárnak.'],
    ['Átvehető', 'Rendelésed átvehető az AQUA átvevőponton.'],
    ['Kézbesítve', 'Rendelésed sikeresen kézbesítve.'],
    ['Visszatérítés', 'A vételárat visszatérítettük.'],
    ['Garanciális ügy', 'Garanciális ügyedet rögzítettük.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});

test('third-party MilPay AQUA marketing is not AQUA merchant authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['milpay.hu'],
    senderAddresses: ['info@milpay.hu'],
    subject: 'Most már az Aqua.hu-n is fizethetsz részletekben',
    bodyText: 'Mostantól az Aqua.hu-n is kamatmentes részletfizetéssel vásárolhatsz.',
  }), []);
});

test('AQUA lookalike domain is rejected', () => {
  assert.deepEqual(rows({
    senderDomains: ['aqua.hu.attacker.example'],
    senderAddresses: ['noreply@aqua.hu.attacker.example'],
    subject: 'Rendelésed beérkezett',
    bodyText: 'Rendelésed beérkezett. A rendelés csak az AQUA ügyintéző visszaigazolása után tekinthető elfogadottnak.',
  }), []);
});
