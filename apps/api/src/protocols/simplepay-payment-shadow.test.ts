import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const IDENTITY = {
  senderDomains: ['simplepay.hu'],
  senderAddresses: ['noreply@simplepay.hu'],
  dkimDomains: ['simplepay.hu'],
};

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input).filter((row) => row.protocol_id === 'payment.hu.simplepay');
}

const ONLINE_SUCCESS = {
  ...IDENTITY,
  subject: 'SimplePay - Sikeres fizetés - https://www.example-shop.hu',
  bodyText: [
    'Tisztelt Ügyfelünk!',
    'Online rendelés adatai:',
    'Tranzakció dátuma: 2026.08.16. 12:34',
    'Kereskedő: https://www.example-shop.hu',
    'SimplePay tranzakció azonosító: 812345678',
    'Külső hivatkozási szám: ORD-12345',
    'Fizetett összeg: 12 990 HUF',
    'Tájékoztatjuk, hogy jelen üzenet a SimplePay rendszere által automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.',
  ].join('\n'),
};

test('SimplePay success is shadow PAYMENT_SUCCESS and production cannot see it', () => {
  assert.deepEqual(detectProtocolEvidence(ONLINE_SUCCESS), []);
  const evidence = rows(ONLINE_SUCCESS);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.identifiers.payment_reference, '812345678');
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('SimplePay external reference is not promoted to a global order id', () => {
  const [evidence] = rows(ONLINE_SUCCESS);
  assert.ok(evidence);
  assert.equal(evidence.identifiers.order_id, null);
  assert.equal(evidence.identifiers.payment_reference, '812345678');
});

test('SimplePay stored-card recurring charge is PAYMENT_SUCCESS but cannot create a purchase', () => {
  const evidence = rows({
    ...IDENTITY,
    subject: 'SimplePay - Sikeres fizetés - https://www.example-subscription.hu',
    bodyText: [
      'Korábban eltárolásra került bankkártyája sikeresen terhelésre került partnerünk kérésére.',
      'Online rendelés adatai:',
      'SimplePay tranzakció azonosító: 823456789',
      'Külső hivatkozási szám: SUB-2026-08',
      'Fizetett összeg: 3 670 HUF',
      'Jelen üzenet a SimplePay rendszere által automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.',
    ].join('\n'),
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('SimplePay Telefonos POS success is PAYMENT_SUCCESS', () => {
  const evidence = rows({
    ...IDENTITY,
    subject: 'SimplePay - Sikeres fizetés',
    bodyText: [
      'Tranzakció adatai:',
      'Kereskedő: Example Carrier Kft.',
      'Tranzakció típusa: Eladás',
      'Fizetés típusa: Érintéses fizetés SoftPos',
      'SimplePay tranzakció azonosító: 834567890',
      'Fizetett összeg: 8 745 HUF',
      'Tranzakció státusza: Sikeres',
      'Jelen üzenet egy automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.',
    ].join('\n'),
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.identifiers.payment_reference, '834567890');
});

test('SimplePay success subject alone is insufficient', () => {
  assert.deepEqual(rows({
    ...IDENTITY,
    subject: 'SimplePay - Sikeres fizetés - https://www.example-shop.hu',
    bodyText: 'Köszönjük a fizetést.',
  }), []);
});

test('SimplePay payment success does not imply a BuyFlow purchase context', () => {
  const contexts = [
    'Kereskedő: Example Telecom Zrt.',
    'Kereskedő: Example Debt Services Zrt.',
    'Kereskedő: Example Public Administration',
  ];
  for (let index = 0; index < contexts.length; index += 1) {
    const evidence = rows({
      ...IDENTITY,
      subject: 'SimplePay - Sikeres fizetés',
      bodyText: [
        contexts[index],
        `SimplePay tranzakció azonosító: 8456700${index + 10}`,
        'Fizetett összeg: 5 000 HUF',
        'Jelen üzenet a SimplePay rendszere által automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.',
      ].join('\n'),
    });
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
    assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
    assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  }
});

test('SimplePay failed/action-required/refund-like text has no rule in V1', () => {
  const subjects = [
    'SimplePay - Sikertelen fizetés',
    'SimplePay - Fizetés megerősítése szükséges',
    'SimplePay - Sikeres visszatérítés',
  ];
  for (const subject of subjects) {
    assert.deepEqual(rows({
      ...IDENTITY,
      subject,
      bodyText: 'SimplePay tranzakció azonosító: 856789012\nFizetett összeg: 1 000 HUF',
    }), []);
  }
});

test('SimplePay marketing sender and lookalike DKIM are hard negatives', () => {
  assert.deepEqual(rows({
    senderDomains: ['simpleapp.hu'],
    senderAddresses: ['simple@simpleapp.hu'],
    dkimDomains: ['simpleapp.hu'],
    subject: 'Regisztrálj és nyerj SimplePay vásárlással!',
    bodyText: 'SimplePay online fizetés nyereményjáték.',
  }), []);

  assert.deepEqual(rows({
    senderDomains: ['simplepay.hu'],
    senderAddresses: ['noreply@simplepay.hu'],
    dkimDomains: ['simplepay.hu.attacker.example'],
    subject: ONLINE_SUCCESS.subject,
    bodyText: ONLINE_SUCCESS.bodyText,
  }), []);
});
