import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const GLS_IDENTITY = {
  senderDomains: ['gls-hungary.com'],
  senderAddresses: ['noreply@gls-hungary.com'],
  dkimDomains: ['gls-hungary.com'],
};

function glsEvidence(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'carrier.hu.gls');
}

test('GLS parcel information is SHIPMENT_CREATED and not physical shipment', () => {
  const input = {
    ...GLS_IDENTITY,
    subject: 'GLS csomag információ / GLS parcel information',
    bodyText: [
      'Ezúton értesítünk, hogy partnerünk csomago(ka)t készített össze számodra.',
      'A csomago(ka)t a beérkezést követő munkanapon megkíséreljük kézbesíteni az alábbiak szerint:',
      'Feladó: Example Merchant Kft.',
      'Csomagszám: 3412000001',
      'Tervezett kézbesítés: 2026. 08. 20.',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const [shadow] = glsEvidence(input);
  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow.identifiers.tracking_id, '3412000001');
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('GLS DeliveryPoints parcel information uses the same safe SHIPMENT_CREATED boundary', () => {
  const [shadow] = glsEvidence({
    ...GLS_IDENTITY,
    subject: 'GLS Átadópont csomaginformáció / GLS DeliveryPoints parcel information',
    bodyText: [
      'Ezúton értesítünk, hogy partnerünk csomago(ka)t készített össze számodra.',
      'A csomago(ka)t a beérkezést követő munkanapon megkíséreljük kézbesíteni az alábbiak szerint:',
      'Csomagszám: 3412000002',
    ].join('\n'),
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow.identifiers.tracking_id, '3412000002');
  assert.equal(shadow.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'), true);
});

test('GLS delivery-today notification is OUT_FOR_DELIVERY but not DELIVERED', () => {
  const evidence = glsEvidence({
    ...GLS_IDENTITY,
    subject: 'GLS 3412000003 mai kézbesítése / GLS 3412000003 delivery today',
    bodyText: [
      'Ezúton értesítünk, hogy partnerünk által feladott csomago(ka)t a mai napon megkíséreljük kézbesíteni a következők szerint:',
      'Tervezett kézbesítés: 9:30 - 12:30',
      'GLS Futár telefonszáma: 06300000000',
      'Csomagszám: 3412000003',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OUT_FOR_DELIVERY');
  assert.equal(evidence[0]?.identifiers.tracking_id, '3412000003');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('GLS locker placement is READY_FOR_PICKUP and never DELIVERED', () => {
  const evidence = glsEvidence({
    ...GLS_IDENTITY,
    subject: 'Értesítés a 3412000004 számú csomag GLS Automatába helyezéséről',
    bodyText: [
      'Ezúton értesítünk, hogy 3412000004 számú csomagodat elhelyeztük GLS Automatánkban.',
      'Csomagod átvételéhez használd a lenti nyitókódot, vagy a csatolt QR-kódot!',
      'GLS Automata: GLS Automata Example',
      'Nyitókód: 123456',
      'Átvételi határidő: 2026.08.20',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'READY_FOR_PICKUP');
  assert.equal(evidence[0]?.identifiers.tracking_id, '3412000004');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('GLS locker COD receipt is narrow direct DELIVERED proof', () => {
  const evidence = glsEvidence({
    ...GLS_IDENTITY,
    subject: 'Utánvétes fizetés visszaigazolás',
    bodyText: 'Csatolva találja a GLS Automatában átvett csomag utánvét nyugtáját.',
    attachmentFilenames: ['paymentReceipt_3412000005.pdf'],
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELIVERED');
  assert.equal(evidence[0]?.identifiers.tracking_id, '3412000005');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.equal(evidence[0]?.production_eligible, false);
});

test('GLS COD receipt without matching receipt attachment is not DELIVERED', () => {
  const evidence = glsEvidence({
    ...GLS_IDENTITY,
    subject: 'Utánvétes fizetés visszaigazolás',
    bodyText: 'Csatolva találja a GLS Automatában átvett csomag utánvét nyugtáját.',
    attachmentFilenames: [],
  });

  assert.deepEqual(evidence, []);
});

test('same GLS parcel can progress conservatively from created to out-for-delivery to pickup-ready', () => {
  const tracking = '3412000006';
  const inputs = [
    {
      ...GLS_IDENTITY,
      subject: 'GLS csomag információ / GLS parcel information',
      bodyText: `Partnerünk csomago(ka)t készített össze számodra.\nA csomago(ka)t a feladást követő munkanapon megkíséreljük kézbesíteni.\nCsomagszám: ${tracking}`,
    },
    {
      ...GLS_IDENTITY,
      subject: `GLS ${tracking} mai kézbesítése / GLS ${tracking} delivery today`,
      bodyText: `A mai napon megkíséreljük kézbesíteni.\nTervezett kézbesítés: 10:00 - 13:00\nCsomagszám: ${tracking}`,
    },
    {
      ...GLS_IDENTITY,
      subject: `Értesítés a ${tracking} számú csomag GLS Automatába helyezéséről`,
      bodyText: `Ezúton értesítünk, hogy ${tracking} számú csomagodat elhelyeztük GLS Automatánkban.\nCsomagod átvételéhez használd a lenti nyitókódot, vagy a csatolt QR-kódot!\nÁtvételi határidő: 2026.08.20`,
    },
  ];

  const events = inputs.map((input) => {
    const [row] = glsEvidence(input);
    assert.ok(row);
    assert.equal(row.identifiers.tracking_id, tracking);
    return row.event_candidate;
  });

  assert.deepEqual(events, ['SHIPMENT_CREATED', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP']);
});

test('GLS-looking mail without gls-hungary.com DKIM is rejected', () => {
  const evidence = glsEvidence({
    senderDomains: ['gls-hungary.com'],
    senderAddresses: ['noreply@gls-hungary.com'],
    dkimDomains: ['gls-hungary.com.attacker.example'],
    subject: 'GLS 3412000007 mai kézbesítése / GLS 3412000007 delivery today',
    bodyText: 'A mai napon megkíséreljük kézbesíteni. Tervezett kézbesítés: 10:00 - 13:00 Csomagszám: 3412000007',
  });

  assert.deepEqual(evidence, []);
});

test('GLS satisfaction survey and dynamic tracking mail do not become lifecycle events', () => {
  const survey = glsEvidence({
    ...GLS_IDENTITY,
    subject: 'GLS elégedettségi kérdőív',
    bodyText: 'Köszönjük, hogy a csomagszállításhoz a GLS-t választotta. Visszajelzése segíti a munkánkat.',
  });
  const dynamic = glsEvidence({
    ...GLS_IDENTITY,
    subject: 'Dinamikus csomagkövetés - GLS',
    bodyText: 'Dinamikus csomagkövető szolgáltatásunk segítségével folyamatosan nyomon követheti csomagja várható kézbesítési időpontját.',
  });

  assert.deepEqual(survey, []);
  assert.deepEqual(dynamic, []);
});
