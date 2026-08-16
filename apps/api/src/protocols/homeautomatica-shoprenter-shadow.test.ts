import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const SHOPRENTER_INFRA = {
  dkimDomains: ['mail6.smtp.shoprenter.hu'],
  returnPathDomains: ['mail6.smtp.shoprenter.hu'],
};

const HOME_SENDER = {
  senderDomains: ['homeautomatica.hu'],
  senderAddresses: ['info@homeautomatica.hu'],
};

function homeEvidence(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.homeautomatica');
}

test('observed Home Automatica order confirmation is shadow ORDER_CREATED and invisible to production', () => {
  const input = {
    ...HOME_SENDER,
    ...SHOPRENTER_INFRA,
    subject: 'Rendelés 842',
    bodyText: [
      'Home Automatica Kft',
      'RENDELÉS VISSZAIGAZOLÁS',
      'Megrendelése megérkezett, feldolgozása elkezdődött',
      'Rendelés részletei',
      'Rendelésszám: #842',
      'Szállítási mód',
      'FoxPost - Packeta Group',
      'Fizetési mód',
      'CIB bankkártyás fizetés',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);

  const [shadow] = homeEvidence(input);
  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'ORDER_CREATED');
  assert.equal(shadow.identifiers.order_id, '842');
  assert.equal(shadow.production_eligible, false);
});

test('observed failed card payment becomes PAYMENT_FAILED but cannot create or auto-link a Purchase', () => {
  const [shadow] = homeEvidence({
    ...HOME_SENDER,
    ...SHOPRENTER_INFRA,
    subject: 'Sikertelen bankkártyás fizetés a Home Automatica Kft webáruházban!',
    bodyText: [
      'Értesíteni szeretnénk, hogy a(z) 842. számú rendelést nem sikerült befizetnie a CIB bank felületén.',
      'A sikertelen fizetés adatai:',
      'Tranzakció azonosító: TESTFAIL842001',
      'Válaszkód: X0',
      'Válaszüzenet: Authentikációs hiba',
      'A bankkártyás fizetést ismételten megkísérelheti.',
    ].join('\n'),
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'PAYMENT_FAILED');
  assert.equal(shadow.identifiers.order_id, '842');
  assert.equal(shadow.identifiers.payment_reference, 'TESTFAIL842001');
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('later accepted card retry becomes PAYMENT_SUCCESS with explicit accepted transaction proof', () => {
  const [shadow] = homeEvidence({
    ...HOME_SENDER,
    ...SHOPRENTER_INFRA,
    subject: 'Sikeres bankkártyás fizetés a Home Automatica Kft webáruházban!',
    bodyText: [
      'Köszönjük, hogy nálunk vásárolt. A(z) 842. számú rendelést sikeresen befizette.',
      'Rendelésének új állapota: Jóváírás',
      'A sikeres fizetés adatai:',
      'Tranzakció azonosító: TESTOK842002',
      'Válaszkód: 00',
      'Válaszüzenet: Tranzakció elfogadva',
      'Összeg: 5744',
    ].join('\n'),
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(shadow.identifiers.order_id, '842');
  assert.equal(shadow.identifiers.payment_reference, 'TESTOK842002');
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('merchant Jóváírás status alone is OTHER and never a refund or standalone payment success', () => {
  const evidence = homeEvidence({
    ...HOME_SENDER,
    ...SHOPRENTER_INFRA,
    subject: 'Home Automatica Kft – a(z) 842. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 842',
      'A megrendelés frissítésre került, jelenlegi állapot:',
      'Jóváírás',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.order_id, '842');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
});

test('FoxPost szállításra előkészítve is SHIPMENT_CREATED and never physical shipment progress', () => {
  const [shadow] = homeEvidence({
    ...HOME_SENDER,
    ...SHOPRENTER_INFRA,
    subject: 'Home Automatica Kft – a(z) 842. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 842',
      'A megrendelés frissítésre került, jelenlegi állapot:',
      'FoxPost szállításra előkészítve',
    ].join('\n'),
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow.identifiers.order_id, '842');
  assert.ok(shadow.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('merchant Elküldve status alone stays OTHER until direct carrier evidence proves physical progress', () => {
  const evidence = homeEvidence({
    ...HOME_SENDER,
    ...SHOPRENTER_INFRA,
    subject: 'Home Automatica Kft – a(z) 842. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 842',
      'A megrendelés frissítésre került, jelenlegi állapot:',
      'Elküldve',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'IN_TRANSIT'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('another Shoprenter merchant cannot inherit Home Automatica status semantics', () => {
  const evidence = homeEvidence({
    senderDomains: ['other-shop.example'],
    senderAddresses: ['info@other-shop.example'],
    ...SHOPRENTER_INFRA,
    subject: 'Home Automatica Kft – a(z) 842. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 842\nA megrendelés frissítésre került, jelenlegi állapot:\nFoxPost szállításra előkészítve',
  });

  assert.deepEqual(evidence, []);
});

test('Home Automatica-looking mail without exact Shoprenter infrastructure is held', () => {
  const evidence = homeEvidence({
    ...HOME_SENDER,
    dkimDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    returnPathDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    subject: 'Sikeres bankkártyás fizetés a Home Automatica Kft webáruházban!',
    bodyText: 'A(z) 842. számú rendelést sikeresen befizette. Válaszkód: 00 Válaszüzenet: Tranzakció elfogadva',
  });

  assert.deepEqual(evidence, []);
});
