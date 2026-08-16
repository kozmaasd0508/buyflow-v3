import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.bestbyte');
}

const AUTH = {
  senderDomains: ['bestbyte.hu'],
  senderAddresses: ['noreply@bestbyte.hu'],
  returnPathDomains: ['bestbyte.hu'],
  transportHosts: ['noreply.bestbyte.smtp.hu'],
};

const INVOICE = {
  ...AUTH,
  subject: 'Elektronikus számla - 11739BKSE26',
  bodyText: [
    'Értesítjük, hogy 11739BKSE26 bizonylatszámmal új elektronikus számla készült az Önök részére.',
    'Elektronikus számlájukat és a hozzá tartozó hash kód mellékletben csatolásra került.',
  ].join('\n'),
  attachmentFilenames: ['HASH_11739BKSE26.TXT', '11739BKSE26.PDF'],
};

test('BestByte direct electronic invoice is INVOICE and remains shadow-only', () => {
  assert.deepEqual(detectProtocolEvidence(INVOICE), []);

  const evidence = rows(INVOICE);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.invoice_id, '11739BKSE26');
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.equal(evidence[0]?.identifiers.payment_reference, null);
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('BestByte invoice does not imply payment success, order creation or refund', () => {
  const evidence = rows(INVOICE);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
});

test('BestByte invoice subject alone is insufficient', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Elektronikus számla - 11739BKSE26',
    bodyText: 'Köszönjük a vásárlást.',
  }), []);
});

test('BestByte invoice without exact return-path domain is rejected', () => {
  assert.deepEqual(rows({
    ...INVOICE,
    returnPathDomains: ['mailer.example'],
  }), []);
});

test('BestByte lookalike sender is rejected', () => {
  assert.deepEqual(rows({
    ...INVOICE,
    senderDomains: ['bestbyte.hu.attacker.example'],
    senderAddresses: ['noreply@bestbyte.hu.attacker.example'],
    returnPathDomains: ['bestbyte.hu.attacker.example'],
  }), []);
});

test('fizz marketplace order naming BestByte seller is not direct BestByte authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['fizz.hu'],
    senderAddresses: ['noreply@fizz.hu'],
    dkimDomains: ['fizz.hu'],
    subject: '#1000743039 számú megrendelésed rögzítésre került 🛒',
    bodyText: [
      'Rendelésed sikeresen rögzítettük és továbbítottuk kereskedő partnerünk számára.',
      'Forgalmazó: Bestbyte Kft.',
      'A rendelés feldolgozása elkezdődött.',
    ].join('\n'),
  }), []);
});

test('fizz invoice wrapper naming BestByte seller is not direct BestByte invoice authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['fizz.hu'],
    senderAddresses: ['noreply@fizz.hu'],
    dkimDomains: ['fizz.hu'],
    subject: '#1000743039 számú rendeléshez tartozó számla🧾',
    bodyText: 'A levél csatolmányaként találod a Bestbyte Kft. által kiállított számlát.',
    attachmentFilenames: ['11739BKSE26.pdf'],
  }), []);
});

test('direct GLS parcel email naming BestByte remains carrier authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['gls-hungary.com'],
    senderAddresses: ['noreply@gls-hungary.com'],
    dkimDomains: ['gls-hungary.com'],
    subject: 'GLS csomag információ / GLS parcel information',
    bodyText: 'Feladó: BestByte. Partnerünk csomagot készített össze számodra.',
  }), []);
});

test('direct Express One parcel email naming BestByte remains carrier authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['expressone.hu'],
    senderAddresses: ['ertesites@expressone.hu'],
    dkimDomains: ['expressone.hu'],
    subject: 'Express One - sikeres kézbesítési értesítő',
    bodyText: 'BESTBYTE BB -saját által feladott küldemény átadásra került.',
  }), []);
});

test('officially documented order receipt semantics are not invented as a BestByte template', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Rendelés visszaigazolás',
    bodyText: [
      'Megrendelésed megérkezett rendszerünkbe.',
      'Ez az automatikus e-mail nem minősül az ajánlat elfogadásának.',
      'Rendelés száma: 12345678',
    ].join('\n'),
  }), []);
});

test('return/refund wording alone is unsupported in BestByte V1', () => {
  const unsupported = [
    ['Termék visszaküldése', 'Elállási kérelmedet rögzítettük.'],
    ['Visszatérítés', 'A visszatérítés feldolgozása folyamatban van.'],
    ['Rendelés kézbesítve', 'Rendelésed kézbesítve.'],
    ['Rendelés törölve', 'Rendelésed töröltük.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});
