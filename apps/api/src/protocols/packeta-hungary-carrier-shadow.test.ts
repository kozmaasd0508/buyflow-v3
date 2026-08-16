import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const IDENTITY = {
  senderDomains: ['packeta.hu'],
  senderAddresses: ['noreply@packeta.hu'],
  dkimDomains: ['packeta.hu'],
};

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input).filter((row) => row.protocol_id === 'carrier.hu.packeta');
}

test('Packeta accepted transport is shadow SHIPPED, never DELIVERED', () => {
  const input = {
    ...IDENTITY,
    subject: 'A szállítmányt elfogadták a szállításra',
    bodyText: 'Csomag Z 375 2564 629 https://tracking.packeta.com/?id=Z3752564629\nAz Example Merchant feladó most adta fel az Ön csomagját, amely Z-BOXba kerül kézbesítésre.',
  };
  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPPED');
  assert.equal(evidence[0]?.identifiers.tracking_id, 'Z3752564629');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('2026 FoxPost legal-successor Packeta-channel handoff is SHIPPED', () => {
  const evidence = rows({
    ...IDENTITY,
    subject: 'A szállítmányt elfogadták a szállításra',
    bodyText: 'Webáruház Example Shop átadta nekünk az Ön alábbi megrendelését Z 349 3891 717, melyet szerződéses szállítópartnerünk fog kézbesíteni az Ön címére. https://tracking.packeta.com?id=Z3493891717',
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPPED');
  assert.equal(evidence[0]?.identifiers.tracking_id, 'Z3493891717');
});

test('Packeta accepted subject alone is insufficient', () => {
  assert.deepEqual(rows({
    ...IDENTITY,
    subject: 'A szállítmányt elfogadták a szállításra',
    bodyText: 'Csomag Z 123 4567 890. Kövesse nyomon csomagját.',
  }), []);
});

test('Packeta Z-BOX and staffed pickup-point mail are READY_FOR_PICKUP', () => {
  const fixtures = [
    'Csomag Z 204 4621 128 https://tracking.packeta.com/?id=Z2044621128\nA Example Merchant feladótól kapott csomagja készen áll a Z-BOXban történő átvételre.\nKód a rekesz kinyitásához 1 2 3 4 5 6',
    'az Ön Z 381 8437 810 számú csomagja feladótól Example Merchant átvételre készen áll az alábbi átvevőhelyen: Example Point.\nAz átvételhez szükséges jelszó ABC12.\nhttps://tracking.packeta.com/?id=Z3818437810',
  ];
  for (const bodyText of fixtures) {
    const evidence = rows({ ...IDENTITY, subject: 'A csomag készen áll átvételre', bodyText });
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]?.event_candidate, 'READY_FOR_PICKUP');
    assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
  }
});

test('Packeta kézbesítésre kész reminder still means READY_FOR_PICKUP', () => {
  const evidence = rows({
    ...IDENTITY,
    subject: 'Megjegyzés: A szállítmány kézbesítésre kész',
    bodyText: 'Csomag Z 280 2564 705 https://tracking.packeta.com/?id=Z2802564705\nEmlékeztetjük Önt a csomagjára, amely még mindig a Z-BOXban várja hogy Ön átvegye. Ha nem veszi át, visszaküldésre kerülhet.',
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'READY_FOR_PICKUP');
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
});

test('Packeta COD payment confirmation does not prove delivery or return', () => {
  assert.deepEqual(rows({
    ...IDENTITY,
    subject: 'Visszaigazolás az online kártyás fizetéshez',
    bodyText: 'Megerősítjük a Z 375 2564 629 csomag utánvétjének kifizetését. Ha nem tudja átvenni, a csomag visszaküldésre kerülhet.',
  }), []);
});

test('Packeta account mail and lookalike DKIM are hard negatives', () => {
  assert.deepEqual(rows({ ...IDENTITY, subject: 'E-mail ellenőrzése a Mailroom alkalmazásban', bodyText: 'Igazolja e-mail címét.' }), []);
  assert.deepEqual(rows({
    senderDomains: ['packeta.hu'], senderAddresses: ['noreply@packeta.hu'], dkimDomains: ['packeta.hu.attacker.example'],
    subject: 'A szállítmányt elfogadták a szállításra',
    bodyText: 'Az Example Merchant feladó most adta fel az Ön csomagját, amely Z-BOXba kerül kézbesítésre. Csomag Z 123 4567 890.',
  }), []);
});

test('same Packeta Z id progresses from SHIPPED to READY_FOR_PICKUP', () => {
  const tracking = 'Z1234567890';
  const inputs = [
    { ...IDENTITY, subject: 'A szállítmányt elfogadták a szállításra', bodyText: `Csomag Z 123 4567 890 https://tracking.packeta.com/?id=${tracking}\nAz Example Merchant feladó most adta fel az Ön csomagját, amely Z-BOXba kerül kézbesítésre.` },
    { ...IDENTITY, subject: 'A csomag készen áll átvételre', bodyText: `Csomag Z 123 4567 890 https://tracking.packeta.com/?id=${tracking}\nA Example Merchant feladótól kapott csomagja készen áll a Z-BOXban történő átvételre.` },
  ];
  const events = inputs.map((input) => {
    const [row] = rows(input);
    assert.ok(row);
    assert.equal(row.identifiers.tracking_id, tracking);
    return row.event_candidate;
  });
  assert.deepEqual(events, ['SHIPPED', 'READY_FOR_PICKUP']);
});