import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const FOXPOST_IDENTITY = {
  senderDomains: ['foxpost.hu'],
  senderAddresses: ['no-reply@foxpost.hu'],
  dkimDomains: ['foxpost.hu'],
};

function foxpostEvidence(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'carrier.hu.foxpost');
}

test('direct FOXPOST pre-advice is SHIPMENT_CREATED and explicitly not shipped', () => {
  const input = {
    ...FOXPOST_IDENTITY,
    subject: 'Előértesítés',
    bodyText: [
      'Ezúton értesítünk, hogy a FOXPOST rendszerében egy csomag feladásához szükséges csomagszámot hoztak létre a megadott adataid alapján.',
      'A csomagot még nem adták át a FOXPOST részére.',
      'A csomag adatai:',
      'Feladó: Example Merchant Kft.',
      'Csomagszám: CLFOX178500000000001',
      'Kézbesítés típusa: FOXPOST',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const [shadow] = foxpostEvidence(input);
  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow.identifiers.tracking_id, 'CLFOX178500000000001');
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('direct FOXPOST warehouse possession is IN_TRANSIT but cannot mark delivered', () => {
  const [shadow] = foxpostEvidence({
    ...FOXPOST_IDENTITY,
    subject: 'Csomagod már a raktárunkban van',
    bodyText: [
      'Csomagod, amelyet Example Merchant Kft. adott fel számodra, beérkezett raktárunkba, hamarosan megkapod a FOXPOST A-BOX csomagautomatába.',
      'Amint küldeményed átvehető, értesítünk.',
      'Csomagod azonosítószáma: CLFOX178500000000001',
    ].join('\n'),
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'IN_TRANSIT');
  assert.equal(shadow.identifiers.tracking_id, 'CLFOX178500000000001');
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('direct FOXPOST locker-arrival email is READY_FOR_PICKUP and never DELIVERED', () => {
  const evidence = foxpostEvidence({
    ...FOXPOST_IDENTITY,
    subject: 'Csomagod megérkezett',
    bodyText: [
      'Ezúton értesítünk, hogy Example Merchant Kft. által feladott csomagod megérkezett, amely átvehető az alábbiak szerint:',
      'Csomagautomata megnevezése: FOXPOST A-BOX Example',
      'Nyitókód: 123456789',
      'Csomagod FOXPOST azonosítószáma: CLFOX178500000000001',
      'Csomagátvétel határideje: 2026-08-20 12:00',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'READY_FOR_PICKUP');
  assert.equal(evidence[0]?.identifiers.tracking_id, 'CLFOX178500000000001');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('same FOXPOST tracking id can progress from pre-advice to warehouse to ready-for-pickup', () => {
  const tracking = 'CLFOX178500000000777';
  const inputs = [
    {
      ...FOXPOST_IDENTITY,
      subject: 'Előértesítés',
      bodyText: `A FOXPOST rendszerében egy csomag feladásához szükséges csomagszámot hoztak létre.\nA csomagot még nem adták át a FOXPOST részére.\nCsomagszám: ${tracking}`,
    },
    {
      ...FOXPOST_IDENTITY,
      subject: 'Csomagod már a raktárunkban van',
      bodyText: `Csomagod beérkezett raktárunkba, hamarosan megkapod a célautomatába.\nCsomagod azonosítószáma: ${tracking}`,
    },
    {
      ...FOXPOST_IDENTITY,
      subject: 'Csomagod megérkezett',
      bodyText: `Csomagod megérkezett, amely átvehető az alábbiak szerint:\nCsomagautomata megnevezése: FOXPOST A-BOX Example\nCsomagod FOXPOST azonosítószáma: ${tracking}`,
    },
  ];

  const events = inputs.map((input) => {
    const [row] = foxpostEvidence(input);
    assert.ok(row);
    assert.equal(row.identifiers.tracking_id, tracking);
    return row.event_candidate;
  });

  assert.deepEqual(events, ['SHIPMENT_CREATED', 'IN_TRANSIT', 'READY_FOR_PICKUP']);
});

test('FOXPOST-looking mail without foxpost.hu DKIM is rejected', () => {
  const evidence = foxpostEvidence({
    senderDomains: ['foxpost.hu'],
    senderAddresses: ['no-reply@foxpost.hu'],
    dkimDomains: ['foxpost.hu.attacker.example'],
    subject: 'Csomagod megérkezett',
    bodyText: 'Csomagod megérkezett, amely átvehető. Csomagautomata megnevezése: fake. Csomagod FOXPOST azonosítószáma: CLFOX178500000000001',
  });

  assert.deepEqual(evidence, []);
});

test('FOXPOST marketing or feedback email does not become a parcel lifecycle event', () => {
  const evidence = foxpostEvidence({
    ...FOXPOST_IDENTITY,
    subject: 'Fontos számunkra a véleményed!',
    bodyText: 'Kíváncsiak vagyunk a véleményedre és szolgáltatásunkkal kapcsolatos tapasztalatodra.',
  });

  assert.deepEqual(evidence, []);
});
