import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.gymbeam');
}

const LEGACY_AUTH = {
  senderDomains: ['rendeles.gymbeam.hu'],
  senderAddresses: ['info@rendeles.gymbeam.hu'],
  dkimDomains: ['rendeles.gymbeam.hu'],
};

const SERVICE_AUTH = {
  senderDomains: ['service.gymbeam.hu'],
  senderAddresses: ['info@service.gymbeam.hu'],
  dkimDomains: ['service.gymbeam.hu'],
};

test('GymBeam recorded order is shadow ORDER_CREATED and production cannot see it', () => {
  const input = {
    ...LEGACY_AUTH,
    subject: 'Teszt, rögzítettük a 3008000001 számú rendelésed',
    bodyText: [
      'Köszönjük a 3008000001 számú rendelésed, melyet rendszerünk sikeresen rögzített, és hamarosan megkezdjük a feldolgozását.',
      'A rendelés visszaigazolását és a kézbesítés részleteit csak a rendelés feldolgozása után, külön e-mail-ben fogjuk elküldeni.',
      'Fizetési mód: Utánvét',
      'Szállítási mód: Express One',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '3008000001');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.equal(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'), false);
});

test('GymBeam current processing email is ORDER_PROCESSING and cannot create purchase', () => {
  const evidence = rows({
    ...SERVICE_AUTH,
    subject: 'Teszt, a rendelésed feldolgozás alatt van.',
    bodyText: [
      'Köszönjük! Megkaptuk a rendelésedet.',
      'A 3010000002 számú rendelésed már készül!',
      'Rendelés összesítő',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_PROCESSING');
  assert.equal(evidence[0]?.identifiers.order_id, '3010000002');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
});

test('GymBeam misleading on-the-way subject remains SHIPMENT_CREATED before carrier handoff', () => {
  const evidence = rows({
    ...SERVICE_AUTH,
    subject: 'Teszt, a megrendelésed úton van!',
    bodyText: [
      'Jó hír, megrendelésed már elküldésre került.',
      'A 3010000003 számú rendelésedet becsomagoltuk. Hamarosan a Express One szállító cég kezébe kerül, amely értesíteni fog a szállítás részleteiről.',
      'Ha nem tudod visszafogni az izgatottságodat, a 605855688145000013600003 számmal követheted a csomagot.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '3010000003');
  assert.equal(evidence[0]?.identifiers.tracking_id, '605855688145000013600003');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('GymBeam sent/on-the-way wording without explicit future handoff is not promoted', () => {
  assert.deepEqual(rows({
    ...SERVICE_AUTH,
    subject: 'Teszt, a megrendelésed úton van!',
    bodyText: [
      'Jó hír, megrendelésed már elküldésre került.',
      'A 3010000003 számú rendelésedet becsomagoltuk.',
      'A 605855688145000013600003 számmal követheted a csomagot.',
    ].join('\n'),
  }), []);
});

test('GymBeam automated carrier delay is DELAYED but never delivery failure or delivery', () => {
  const evidence = rows({
    ...SERVICE_AUTH,
    subject: 'Ellenőrizzük a kézbesítést',
    bodyText: [
      'Nyomon követjük a(z) 3010000004 rendelésének útját, és észrevettük, hogy a szállítócég általi kézbesítése a szokásosnál kissé tovább tart.',
      'Aktívan egyeztetünk a futárszolgálattal a megoldás érdekében.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELAYED');
  assert.equal(evidence[0]?.identifiers.order_id, '3010000004');
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERY_FAILED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('GymBeam legacy paid invoice proves merchant payment success and invoice separately', () => {
  const evidence = rows({
    ...LEGACY_AUTH,
    subject: 'Teszt, a számlád a 3008000005 számú rendelésedhez',
    bodyText: [
      'Szeretnénk jelezni, hogy megkaptuk a 3008000005 számú rendelésedért fizetendő összeget.',
      'Ez az email informatív jellegű és mivel a rendelés már fizetett, nem szolgál fizetési megbízásként.',
      'A 32500000005 számú elektronikus számládat a 3008000005 számú rendelésedhez itt találod.',
    ].join('\n'),
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate).sort(), ['INVOICE', 'PAYMENT_SUCCESS']);
  const payment = evidence.find((row) => row.event_candidate === 'PAYMENT_SUCCESS');
  const invoice = evidence.find((row) => row.event_candidate === 'INVOICE');
  assert.equal(payment?.identifiers.order_id, '3008000005');
  assert.equal(invoice?.identifiers.invoice_id, '32500000005');
  assert.ok(payment?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(payment?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
  assert.ok(invoice?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('GymBeam current invoice is INVOICE but paid-summary wording does not create PAYMENT_SUCCESS', () => {
  const evidence = rows({
    ...SERVICE_AUTH,
    subject: 'Teszt a számlád elkészült! - 3010000006',
    bodyText: [
      'Itt van a vásárlásról szóló számla.',
      'Az 4008000006 számú számlád elkészült, itt tudod megtekinteni.',
      'A(z) 3010000006 számú rendelésedhez tartozik.',
      'Minden kifizetve, így a számlával kapcsolatban nincs más teendőd.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.order_id, '3010000006');
  assert.equal(evidence[0]?.identifiers.invoice_id, '4008000006');
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
});

test('GymBeam lifecycle requires the matching authenticated channel', () => {
  assert.deepEqual(rows({
    ...SERVICE_AUTH,
    dkimDomains: ['gymbeam.hu.attacker.example'],
    subject: 'Teszt, a megrendelésed úton van!',
    bodyText: [
      'A 3010000007 számú rendelésedet becsomagoltuk. Hamarosan a Express One szállító cég kezébe kerül.',
      'A 605855688145000013600007 számmal követheted a csomagot.',
    ].join('\n'),
  }), []);

  assert.deepEqual(rows({
    senderDomains: ['support.gymbeam.hu'],
    senderAddresses: ['info@support.gymbeam.hu'],
    dkimDomains: ['support.gymbeam.hu'],
    subject: 'Ellenőrizzük a kézbesítést',
    bodyText: 'A szállítócég általi kézbesítése a szokásosnál kissé tovább tart. Aktívan egyeztetünk a futárszolgálattal.',
  }), []);
});

test('GymBeam Trustpilot and campaign senders do not inherit merchant lifecycle authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['trustpilotmail.com'],
    senderAddresses: ['noreply.invitations@trustpilotmail.com'],
    dkimDomains: ['trustpilotmail.com'],
    subject: 'Milyen volt a GymBeam rendelésed?',
    bodyText: 'Értékeld a vásárlásodat.',
  }), []);

  assert.deepEqual(rows({
    senderDomains: ['gymbeam.com'],
    senderAddresses: ['campaign@gymbeam.com'],
    dkimDomains: ['gymbeam.com'],
    subject: 'GymBeam ajánlat',
    bodyText: 'Akciós termékek és szállítási ajánlatok.',
  }), []);
});

test('GymBeam unsupported cancellation return refund failure and warranty wording stays unsupported', () => {
  const unsupported = [
    ['Rendelés törölve', 'A 3010000010 számú rendelésedet töröltük.'],
    ['Visszaküldés', 'A 3010000010 számú rendelés visszaküldése elindult.'],
    ['Visszatérítés', 'A 3010000010 számú rendelés összegét visszatérítettük.'],
    ['Sikertelen fizetés', 'A 3010000010 számú rendelés fizetése sikertelen.'],
    ['Garancia', 'A 3010000010 számú rendeléshez garanciális ügy indult.'],
    ['Kézbesítve', 'A 3010000010 számú rendelés sikeresen kézbesítve.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...SERVICE_AUTH, subject, bodyText }), []);
  }
});
