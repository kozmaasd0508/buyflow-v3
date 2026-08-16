import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const MPL_IDENTITY = {
  senderDomains: ['posta.hu'],
  senderAddresses: ['kozponti.ertesites@posta.hu'],
  dkimDomains: ['posta.hu'],
};

function mplEvidence(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'carrier.hu.mpl');
}

test('legacy MPL Csomagküldemény is SHIPMENT_CREATED and not physical shipment', () => {
  const tracking = 'PBR215200001';
  const input = {
    ...MPL_IDENTITY,
    subject: 'Csomagküldemény',
    bodyText: [
      'Értesítjük, hogy csomagküldeményt adtak fel Önnek.',
      'Küldemény adatai',
      'Feladó: Example Merchant Kft.',
      `Küldeményazonosító: ${tracking}`,
      'Feladás dátuma: 2026.08.15.',
      'Házhoz szállítás esetén a kézbesítő indulásáról újabb üzenetet küldünk Önnek.',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const [shadow] = mplEvidence(input);
  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow.identifiers.tracking_id, tracking);
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('current MPL Csomagot adtak fel neked uses the same safe SHIPMENT_CREATED boundary', () => {
  const tracking = 'PB9S650300002';
  const evidence = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Csomagot adtak fel neked',
    bodyText: [
      'Értesítünk, hogy csomagot adtak fel Neked.',
      'Csomag adatai',
      `Csomagazonosító: ${tracking}`,
      'Feladás dátuma: 2026.08.15.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'IN_TRANSIT'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('current MPL courier notification is OUT_FOR_DELIVERY and not DELIVERED', () => {
  const tracking = 'PB9S650300003';
  const evidence = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Csomagod a kézbesítőnél van',
    bodyText: [
      'Értesítünk, hogy csomagod a kézbesítőnél van.',
      `Csomagazonosító: ${tracking}`,
      'Kézbesítés',
      'Várható érkezés: 13:00-16:00 között',
      'Kézbesítő telefonszáma: +36300000000',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OUT_FOR_DELIVERY');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('legacy MPL courier notification is also OUT_FOR_DELIVERY', () => {
  const tracking = 'PB9S650300004';
  const [shadow] = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Csomagja a kézbesítőnél van',
    bodyText: [
      'Értesítjük, hogy csomagját kézbesítőnk átvette, így azt a mai napon megkíséreljük a megadott címre kézbesíteni.',
      `Küldeményazonosító: ${tracking}`,
    ].join('\n'),
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'OUT_FOR_DELIVERY');
  assert.equal(shadow.identifiers.tracking_id, tracking);
});

test('MPL unsuccessful attempt is DELIVERY_FAILED and not pickup-ready yet', () => {
  const tracking = 'PBR215200005';
  const evidence = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Sikertelen kézbesítés',
    bodyText: [
      'Sikertelen kézbesítési értesítő',
      'Értesítjük, hogy kézbesítőnk 2026.08.16. 11:38-kor nem járt sikerrel csomagjának kézbesítésével.',
      `Küldeményazonosító: ${tracking}`,
      'A csomagját egy közeli postán veheti át, melyről további tájékoztatást küldünk.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELIVERY_FAILED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.equal(evidence.some((row) => row.event_candidate === 'READY_FOR_PICKUP'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('current MPL post-office availability is READY_FOR_PICKUP and never DELIVERED', () => {
  const tracking = 'PB9S650300006';
  const evidence = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Csomagod a postán átvehető',
    bodyText: [
      'Értesítünk, hogy csomagod 2026.08.21-ig átvehető az alábbi postán:',
      'Átvétel helye: Example posta',
      'Átvétel címe: 1000 Example, Fő út 1.',
      'Átvehető: 2026.08.16 - 2026.08.21.',
      `Csomagazonosító: ${tracking}`,
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'READY_FOR_PICKUP');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('legacy MPL Csomagja érkezett is READY_FOR_PICKUP', () => {
  const tracking = 'PBR215200007';
  const [shadow] = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Csomagja érkezett',
    bodyText: [
      'Csomagja letétbe került',
      'Értesítjük, hogy csomagja átvehető az alábbi postán 2026.08.16-tól 2026.08.21-ig.',
      'Átvétel helye: Example posta',
      `Küldeményazonosító: ${tracking}`,
    ].join('\n'),
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'READY_FOR_PICKUP');
  assert.equal(shadow.identifiers.tracking_id, tracking);
});

test('explicit authenticated MPL successful-delivery feedback is DELIVERED', () => {
  const tracking = 'PB9S650300008';
  const evidence = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Véleménye fontos számunkra!',
    bodyText: [
      `A ${tracking} küldemény kézbesítése sikeresen megtörtént.`,
      'Ezúton is köszönjük, hogy a Magyar Posta Logisztika szolgáltatását vette igénybe!',
      'Kérjük, ossza meg véleményét.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELIVERED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.equal(evidence[0]?.production_eligible, false);
});

test('MPL feedback subject without explicit successful-delivery body is not DELIVERED', () => {
  const evidence = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Véleménye fontos számunkra!',
    bodyText: 'Kérjük, segítsen szolgáltatásaink fejlesztésében egy rövid kérdőív kitöltésével.',
  });

  assert.deepEqual(evidence, []);
});

test('Posta payment confirmation is not a carrier lifecycle event', () => {
  const evidence = mplEvidence({
    ...MPL_IDENTITY,
    subject: 'Sikeres fizetés visszaigazolás',
    bodyText: 'Az OTP Mobilalkalmazásból kezdeményezett bankkártyás csekkfizetési tranzakciója sikeres volt.',
    attachmentFilenames: ['feladoveny.pdf'],
  });

  assert.deepEqual(evidence, []);
});

test('Allegro relay mail cannot inherit direct MPL carrier authority', () => {
  const tracking = 'PB9S650300009';
  const evidence = mplEvidence({
    senderDomains: ['allegromail.com'],
    senderAddresses: ['ertesitesek@allegromail.com'],
    dkimDomains: ['allegromail.com'],
    subject: 'Csomagja a kézbesítőnél van',
    bodyText: `Értesítjük, hogy csomagját kézbesítőnk átvette, így azt a mai napon megkíséreljük kézbesíteni. Küldeményazonosító: ${tracking}`,
  });

  assert.deepEqual(evidence, []);
});

test('MPL-looking mail with lookalike DKIM is rejected', () => {
  const tracking = 'PB9S650300010';
  const evidence = mplEvidence({
    senderDomains: ['posta.hu'],
    senderAddresses: ['kozponti.ertesites@posta.hu'],
    dkimDomains: ['posta.hu.attacker.example'],
    subject: 'Csomagod a kézbesítőnél van',
    bodyText: `Értesítünk, hogy csomagod a kézbesítőnél van. Csomagazonosító: ${tracking}`,
  });

  assert.deepEqual(evidence, []);
});

test('same MPL parcel can progress from created to out-for-delivery to failure to pickup-ready', () => {
  const tracking = 'PBR215200011';
  const inputs = [
    {
      ...MPL_IDENTITY,
      subject: 'Csomagküldemény',
      bodyText: `Értesítjük, hogy csomagküldeményt adtak fel Önnek.\nKüldeményazonosító: ${tracking}\nFeladás dátuma: 2026.08.15.`,
    },
    {
      ...MPL_IDENTITY,
      subject: 'Csomagja a kézbesítőnél van',
      bodyText: `Értesítjük, hogy csomagját kézbesítőnk átvette, így azt a mai napon megkíséreljük a megadott címre kézbesíteni.\nKüldeményazonosító: ${tracking}`,
    },
    {
      ...MPL_IDENTITY,
      subject: 'Sikertelen kézbesítés',
      bodyText: `Kézbesítőnk nem járt sikerrel csomagjának kézbesítésével.\nKüldeményazonosító: ${tracking}`,
    },
    {
      ...MPL_IDENTITY,
      subject: 'Csomagja érkezett',
      bodyText: `Csomagja átvehető az alábbi postán.\nÁtvétel helye: Example posta\nKüldeményazonosító: ${tracking}`,
    },
  ];

  const events = inputs.map((input) => {
    const [row] = mplEvidence(input);
    assert.ok(row);
    assert.equal(row.identifiers.tracking_id, tracking);
    return row.event_candidate;
  });

  assert.deepEqual(events, ['SHIPMENT_CREATED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'READY_FOR_PICKUP']);
});

test('same MPL parcel can progress from created to out-for-delivery to explicit DELIVERED', () => {
  const tracking = 'PB9S650300012';
  const inputs = [
    {
      ...MPL_IDENTITY,
      subject: 'Csomagküldemény',
      bodyText: `Értesítjük, hogy csomagküldeményt adtak fel Önnek.\nKüldeményazonosító: ${tracking}\nFeladás dátuma: 2026.08.15.`,
    },
    {
      ...MPL_IDENTITY,
      subject: 'Csomagod a kézbesítőnél van',
      bodyText: `Értesítünk, hogy csomagod a kézbesítőnél van.\nCsomagazonosító: ${tracking}`,
    },
    {
      ...MPL_IDENTITY,
      subject: 'Véleménye fontos számunkra!',
      bodyText: `A ${tracking} küldemény kézbesítése sikeresen megtörtént.`,
    },
  ];

  const events = inputs.map((input) => {
    const [row] = mplEvidence(input);
    assert.ok(row);
    assert.equal(row.identifiers.tracking_id, tracking);
    return row.event_candidate;
  });

  assert.deepEqual(events, ['SHIPMENT_CREATED', 'OUT_FOR_DELIVERY', 'DELIVERED']);
});
