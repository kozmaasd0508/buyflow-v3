import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { MEDIAMARKT_MERCHANT_RESEARCH_V1 } from './profiles/mediamarkt-merchant-research-v1.js';

function rows(input: Parameters<typeof detectProtocolEvidence>[0]) {
  return detectProtocolEvidence(input, [MEDIAMARKT_MERCHANT_RESEARCH_V1]);
}

const AUTH = {
  senderDomains: ['mediamarkt.hu'],
  senderAddresses: ['noreply@mediamarkt.hu'],
};

test('MediaMarkt research profile is invisible to production detector', () => {
  const input = {
    ...AUTH,
    subject: 'Megrendelés visszaigazolása',
    bodyText: [
      'Megrendelése megérkezett rendszerünkbe.',
      'Ez a visszaigazolás nem jelenti rendelése elfogadását.',
      'A szerződés létrejöttéről külön e-mailben értesítjük.',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.production_eligible, false);
});

test('MediaMarkt first order acknowledgement does not create a purchase', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Megrendelés beérkezett',
    bodyText: [
      'Rendelése beérkezett és rögzítésre került.',
      'A jelen üzenet nem jelenti az ajánlat elfogadását.',
      'A szerződés létrejöttéről külön értesítést küldünk.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
});

test('MediaMarkt documented logistics handoff is research SHIPPED only', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Rendelésének szállítása',
    bodyText: [
      'Rendelését összekészítettük és átadtuk logisztikai partnerünknek kézbesítésre.',
      'Csomagazonosító: TEST-PARCEL-123.',
      'A csomag útját a beágyazott linken nyomon követheti.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPPED');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.equal(evidence[0]?.identifiers.tracking_id, null);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('MediaMarkt store pickup readiness is never delivered', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Rendelése átvehető',
    bodyText: [
      'Rendelése elkészült és átvehető a kiválasztott áruházban.',
      'Időpontot foglalok',
      'Az átvételhez mutassa be a QR kódot.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'READY_FOR_PICKUP');
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('MediaMarkt pickup subject alone is insufficient', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Rendelése átvehető',
    bodyText: 'Köszönjük, hogy nálunk vásárolt.',
  }), []);
});

test('MediaMarkt lookalike sender domain is rejected', () => {
  assert.deepEqual(rows({
    senderDomains: ['mediamarkt.hu.attacker.example'],
    senderAddresses: ['noreply@mediamarkt.hu.attacker.example'],
    subject: 'Rendelésének szállítása',
    bodyText: [
      'Rendelését átadtuk logisztikai partnerünknek.',
      'Csomagazonosító: TEST123. Nyomon követheti a csomagot.',
    ].join('\n'),
  }), []);
});

test('MediaMarkt merchant wording does not invent payment, refund or delivery lifecycle', () => {
  const unsupported = [
    ['Sikeres fizetés', 'SimplePay bankkártyás fizetés sikeres.'],
    ['Visszatérítés', 'A vételár visszatérítése folyamatban van.'],
    ['Rendelés kézbesítve', 'Köszönjük vásárlását, rendelése kézbesítve.'],
    ['Rendelés törölve', 'Rendelését töröltük.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});

test('Számlaközpont invoice channel is not MediaMarkt merchant authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['szamlakozpont.hu'],
    senderAddresses: ['invoice@szamlakozpont.hu'],
    subject: 'MediaMarkt elektronikus számla',
    bodyText: 'A MediaMarkt rendeléséhez tartozó elektronikus számla.',
    attachmentFilenames: ['szamla_TEST-2026-001.pdf'],
  }), []);
});
