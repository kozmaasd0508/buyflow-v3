import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const platform = {
  senderDomains: ['gyerekjatekbolt.com'],
  senderAddresses: ['gyerekjatekbolt@gyerekjatekbolt.com'],
  dkimDomains: ['mail6.smtp.shoprenter.hu', 'eu.mailgun.org'],
  returnPathDomains: ['mail6.smtp.shoprenter.hu'],
};

test('observed Gyerekjatekbolt successful card payment is lifecycle-only shadow evidence', () => {
  const input = {
    ...platform,
    subject: 'Sikeres bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!',
    bodyText: [
      'Köszönjük, hogy nálunk vásárolt.',
      'A(z) 771234. számú rendelést sikeresen befizette.',
      'Rendelésének új állapota: Sikeres bankkártyás fizetés',
      'A sikeres fizetés adatai:',
      'Tranzakció azonosító: 9000111122223333',
      'Válaszkód: 00',
      'Válaszüzenet: Tranzakció elfogadva',
      'Összeg: 14960',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const matches = detectShadowProtocolEvidence(input);
  const payment = matches.find((match) => match.protocol_id === 'merchant.hu.gyerekjatekbolt');
  assert.ok(payment);
  assert.equal(payment.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(payment.identifiers.order_id, '771234');
  assert.equal(payment.identifiers.payment_reference, '9000111122223333');
  assert.equal(payment.production_eligible, false);
  assert.ok(payment.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('payment status label without explicit accepted transaction evidence is held', () => {
  const matches = detectShadowProtocolEvidence({
    ...platform,
    subject: 'Sikeres bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!',
    bodyText: 'A(z) 771234. számú rendelést sikeresen befizette. Rendelésének új állapota: Sikeres bankkártyás fizetés',
  });

  assert.equal(matches.some((match) => match.protocol_id === 'merchant.hu.gyerekjatekbolt'), false);
});

test('observed explicit courier handoff becomes SHIPPED but never DELIVERED', () => {
  const matches = detectShadowProtocolEvidence({
    ...platform,
    subject: 'Gyerekjatekbolt.com - a(z) 771234. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 771234',
      'A megrendelés frissítésre került, jelenlegi állapot: Szállítás alatt',
      'Rendelését átadtuk a futárszolgálat részére várhatóan a következő munkanapon kézbesítik Önnek.',
    ].join('\n'),
  });

  const shipped = matches.find((match) => match.protocol_id === 'merchant.hu.gyerekjatekbolt');
  assert.ok(shipped);
  assert.equal(shipped.event_candidate, 'SHIPPED');
  assert.equal(shipped.identifiers.order_id, '771234');
  assert.notEqual(shipped.event_candidate, 'DELIVERED');
  assert.equal(shipped.production_eligible, false);
  assert.ok(shipped.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shipped.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('merchant-defined Szállítás alatt label alone does not prove physical handoff', () => {
  const matches = detectShadowProtocolEvidence({
    ...platform,
    subject: 'Gyerekjatekbolt.com - a(z) 771234. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 771234\nA megrendelés frissítésre került, jelenlegi állapot: Szállítás alatt',
  });

  assert.equal(matches.some((match) => match.protocol_id === 'merchant.hu.gyerekjatekbolt'), false);
});

test('observed explicit merchant delivered status becomes lower-authority DELIVERED shadow evidence', () => {
  const matches = detectShadowProtocolEvidence({
    ...platform,
    subject: 'Gyerekjatekbolt.com – a(z) 771234. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 771234\nA megrendelés frissítésre került, jelenlegi állapot:\nRendelés kézbesítve',
  });

  const delivered = matches.find((match) => match.protocol_id === 'merchant.hu.gyerekjatekbolt');
  assert.ok(delivered);
  assert.equal(delivered.event_candidate, 'DELIVERED');
  assert.equal(delivered.identifiers.order_id, '771234');
  assert.equal(delivered.production_eligible, false);
  assert.ok(delivered.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('another Shoprenter merchant cannot inherit Gyerekjatekbolt lifecycle semantics', () => {
  const matches = detectShadowProtocolEvidence({
    senderDomains: ['masikbolt.hu'],
    senderAddresses: ['rendeles@masikbolt.hu'],
    dkimDomains: ['mail6.smtp.shoprenter.hu'],
    returnPathDomains: ['mail6.smtp.shoprenter.hu'],
    subject: 'MásikBolt - a(z) 771234. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 771234\nA megrendelés frissítésre került, jelenlegi állapot: Szállítás alatt\nRendelését átadtuk a futárszolgálat részére.',
  });

  assert.equal(matches.some((match) => match.protocol_id === 'merchant.hu.gyerekjatekbolt'), false);
});

test('Gyerekjatekbolt-looking mail without verified Shoprenter infrastructure is held', () => {
  const matches = detectShadowProtocolEvidence({
    senderDomains: ['gyerekjatekbolt.com'],
    senderAddresses: ['gyerekjatekbolt@gyerekjatekbolt.com'],
    dkimDomains: ['smtp.shoprenter.hu.attacker.example'],
    returnPathDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    subject: 'Gyerekjatekbolt.com - a(z) 771234. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 771234\nA megrendelés frissítésre került, jelenlegi állapot: Szállítás alatt\nRendelését átadtuk a futárszolgálat részére.',
  });

  assert.equal(matches.some((match) => match.protocol_id === 'merchant.hu.gyerekjatekbolt'), false);
});
