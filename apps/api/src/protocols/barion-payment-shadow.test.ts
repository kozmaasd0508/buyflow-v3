import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input).filter((row) => row.protocol_id === 'payment.hu.barion');
}

const BODY = [
  'Hello customer@example.com!',
  'Sikeresen fizettél 12 345 Ft-ot bankkártyával!',
  'Rendelés, szállítás vagy visszatérítés kapcsán kérjük, a kereskedő ügyfélszolgálatát keresd.',
  'A tranzakció részletei:',
  'Elfogadóhely neve: Example Merchant',
  'Banki engedélykód: 123456',
  'Fizetés Barion azonosítója: 0123456789abcdef0123456789abcdef',
  'Rendelés elfogadóhelyen nyilvántartott azonosítója: SHOP-12345',
].join('\n');

const NYLAS_LAYOUT_BODY = BODY.replace(
  'Sikeresen fizettél 12 345 Ft-ot bankkártyával!',
  'Sikeresen\nfizettél\n12 345 Ft -ot\nbankkártyával!',
);

test('new Barion sender is shadow PAYMENT_SUCCESS and production registry cannot see it', () => {
  const input = {
    senderDomains: ['barion.com'],
    senderAddresses: ['noreply@barion.com'],
    dkimDomains: ['barion.com'],
    subject: 'Sikeres fizetés',
    bodyText: BODY,
  };
  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.identifiers.payment_reference, '0123456789abcdef0123456789abcdef');
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('real Nylas whitespace and Ft tag-boundary layout keeps authenticated Barion PAYMENT_SUCCESS semantics', () => {
  const evidence = rows({
    senderDomains: ['barion.com'],
    senderAddresses: ['noreply@barion.com'],
    dkimDomains: ['barion.com'],
    subject: 'Sikeres fizetés',
    bodyText: NYLAS_LAYOUT_BODY,
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.identifiers.payment_reference, '0123456789abcdef0123456789abcdef');
  assert.equal(evidence[0]?.production_eligible, false);
});

test('older barion@barion.com sender remains valid authenticated PAYMENT_SUCCESS', () => {
  const evidence = rows({
    senderDomains: ['barion.com'],
    senderAddresses: ['barion@barion.com'],
    dkimDomains: ['barion.com'],
    subject: 'Sikeres fizetés',
    bodyText: BODY.replace('SHOP-12345', 'Nincs megadva'),
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
});

test('merchant-owned order reference is deliberately not extracted as BuyFlow order id', () => {
  const [evidence] = rows({
    senderDomains: ['barion.com'],
    senderAddresses: ['noreply@barion.com'],
    dkimDomains: ['barion.com'],
    subject: 'Sikeres fizetés',
    bodyText: BODY,
  });
  assert.ok(evidence);
  assert.equal(evidence.identifiers.order_id, null);
  assert.equal(evidence.identifiers.payment_reference, '0123456789abcdef0123456789abcdef');
});

test('refund support wording inside a success receipt never becomes REFUNDED', () => {
  const evidence = rows({
    senderDomains: ['barion.com'],
    senderAddresses: ['noreply@barion.com'],
    dkimDomains: ['barion.com'],
    subject: 'Sikeres fizetés',
    bodyText: BODY,
  });
  assert.deepEqual(evidence.map((row) => row.event_candidate), ['PAYMENT_SUCCESS']);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
});

test('Barion success subject alone is insufficient', () => {
  assert.deepEqual(rows({
    senderDomains: ['barion.com'],
    senderAddresses: ['noreply@barion.com'],
    dkimDomains: ['barion.com'],
    subject: 'Sikeres fizetés',
    bodyText: 'Köszönjük, hogy a Bariont választottad.',
  }), []);
});

test('Barion lookalike DKIM and merchant-origin Barion mentions are rejected', () => {
  assert.deepEqual(rows({
    senderDomains: ['barion.com'],
    senderAddresses: ['noreply@barion.com'],
    dkimDomains: ['barion.com.attacker.example'],
    subject: 'Sikeres fizetés',
    bodyText: BODY,
  }), []);

  assert.deepEqual(rows({
    senderDomains: ['shop.example'],
    senderAddresses: ['orders@shop.example'],
    dkimDomains: ['shop.example'],
    subject: 'Sikeres fizetés Barionnal',
    bodyText: BODY,
  }), []);
});

test('Barion marketing/account sender does not inherit payment authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['barion.com'],
    senderAddresses: ['hello@barion.com'],
    dkimDomains: ['barion.com'],
    subject: 'Sikeres fizetés',
    bodyText: BODY,
  }), []);
});

test('non-success payment phrases do not invent failed, action-required or refund events', () => {
  const fixtures = [
    { subject: 'Sikertelen fizetés', bodyText: 'A fizetés sikertelen volt. Fizetés Barion azonosítója: 0123456789abcdef0123456789abcdef' },
    { subject: 'Fizetés folyamatban', bodyText: 'A fizetés eredménye még függőben van. Fizetés Barion azonosítója: 0123456789abcdef0123456789abcdef' },
    { subject: 'Visszatérítés', bodyText: 'A visszatérítés feldolgozása megtörtént. Fizetés Barion azonosítója: 0123456789abcdef0123456789abcdef' },
  ];
  for (const fixture of fixtures) {
    assert.deepEqual(rows({
      senderDomains: ['barion.com'],
      senderAddresses: ['noreply@barion.com'],
      dkimDomains: ['barion.com'],
      ...fixture,
    }), []);
  }
});
