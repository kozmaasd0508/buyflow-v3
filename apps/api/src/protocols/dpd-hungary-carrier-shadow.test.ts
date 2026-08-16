import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const DPD_IDENTITY = {
  senderDomains: ['dpd.hu'],
  senderAddresses: ['noreply@dpd.hu'],
  dkimDomains: ['dpd.hu'],
};

function dpdEvidence(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'carrier.hu.dpd');
}

test('DPD preparation pre-advice is SHIPMENT_CREATED and explicitly not physical progress', () => {
  const tracking = '16380100000001';
  const input = {
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} küldemény előkészítéséről`,
    bodyText: [
      'Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő csomago(ka)t készített össze, melye(ke)t a következő csomagszámon és adatokkal tartunk nyilván.',
      'Tájékoztatjuk, hogy ez egy előértesítés, a csomag(ok) fizikailag még nem került(ek) átadásra részünkre, a további állapotváltozásról újabb értesítést fogunk küldeni.',
      `Example Merchant\n${tracking}`,
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const [row] = dpdEvidence(input);
  assert.ok(row);
  assert.equal(row.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(row.identifiers.tracking_id, tracking);
  assert.equal(row.production_eligible, false);
  assert.ok(row.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(row.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('older DPD feladásáról subject can still be pre-advice when body says not physically handed over', () => {
  const tracking = '16380100000002';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} küldemény feladásáról`,
    bodyText: [
      'Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő csomago(ka)t készített össze.',
      'Tájékoztatjuk, hogy ez egy előértesítés, a csomag(ok) fizikailag még nem került(ek) átadásra részünkre.',
      tracking,
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('DPD merchant-qualified physical dispatch becomes SHIPPED but does not invent shipped_at', () => {
  const tracking = '16380100000003';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} Example Merchant Kft. küldemény feladásáról`,
    bodyText: [
      'Értesítjük, hogy a mai napon Example Merchant Kft. partnerünk az Ön részére kézbesítendő csomago(ka)t adott fel, melye(ke)t a következő csomagszámo(ko)n és adatokkal tartunk nyilván:',
      `Example Merchant Kft.\n${tracking}`,
      'Várható kiszállítási nap: 2026-08-18',
      'A kézbesítés tényleges napján újabb értesítést küldünk.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPPED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('DPD feladás subject without explicit physical dispatch semantics is not promoted to SHIPPED', () => {
  const tracking = '16380100000004';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} Example Merchant Kft. küldemény feladásáról`,
    bodyText: [
      'Example Merchant Kft. csomagot készített össze.',
      `Csomagszám: ${tracking}`,
      'Várható kiszállítási nap: 2026-08-18',
    ].join('\n'),
  });

  assert.deepEqual(evidence, []);
});

test('DPD delivery-today mail is OUT_FOR_DELIVERY and never DELIVERED', () => {
  const tracking = '16380100000005';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} Example Merchant Kft. küldemény mai kézbesítéséről`,
    bodyText: [
      'Értesítjük, hogy a(z) Example Merchant Kft. partnerünk által az Ön részére feladott csomago(ka)t futárunk a mai napon kézbesítésre átvette.',
      `Example Merchant Kft.\n${tracking}`,
      'A csomago(ka)t futárunk a mai napon várhatóan 08:53 – 09:53 között szállítja ki.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OUT_FOR_DELIVERY');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('DPD explicit successful delivery is direct DELIVERED proof', () => {
  const tracking = '16380100000006';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} sikeres kézbesítéséről`,
    bodyText: `Tisztelt Címzett!\nÉrtesítjük, hogy ${tracking} küldeményét a mai napon sikeresen kézbesítettük.`,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELIVERED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('older DPD delivered wording with számú and küldemény in subject is also accepted', () => {
  const tracking = '06505600000007';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} küldemény sikeres kézbesítéséről`,
    bodyText: `Értesítjük, hogy ${tracking} számú küldeményét a mai napon sikeresen kézbesítettük.`,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELIVERED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
});

test('DPD successful-delivery subject alone is insufficient', () => {
  const tracking = '16380100000008';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} sikeres kézbesítéséről`,
    bodyText: 'Bízunk benne, hogy elégedett volt szolgáltatásunkkal.',
  });

  assert.deepEqual(evidence, []);
});

test('DPD recipient refusal becomes RETURN to sender but never REFUNDED', () => {
  const tracking = '16380100000009';
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: `Értesítés ${tracking} küldemény elutasításáról`,
    bodyText: `Az Ön által elutasított ${tracking} csomago(ka)t kérésének megfelelően visszaszállítjuk a feladó részére.`,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'RETURN');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('myDPD redirect confirmation is not physical lifecycle progress', () => {
  const tracking = '16380100000010';
  const evidence = dpdEvidence({
    senderDomains: ['dpdgroup.com'],
    senderAddresses: ['noreply@dpdgroup.com'],
    dkimDomains: ['dpdgroup.com'],
    subject: `A ${tracking} csomag átirányítása sikeresen megtörtént`,
    bodyText: `Tájékoztatjuk, hogy az Example Merchant által feladott csomag módosítása sikeres volt. Csomagszám: ${tracking}`,
  });

  assert.deepEqual(evidence, []);
});

test('DPD payment receipt is not purchase PAYMENT_SUCCESS or parcel DELIVERED evidence', () => {
  const evidence = dpdEvidence({
    ...DPD_IDENTITY,
    subject: 'DPDHU - Fizetési Bizonylat',
    bodyText: 'DPD HUNGARY COURIERS\nHUF 12 990,00\nTransaction details:\nStatus: Completed',
  });

  assert.deepEqual(evidence, []);
});

test('DPD-looking mail with lookalike DKIM is rejected', () => {
  const tracking = '16380100000011';
  const evidence = dpdEvidence({
    senderDomains: ['dpd.hu'],
    senderAddresses: ['noreply@dpd.hu'],
    dkimDomains: ['dpd.hu.attacker.example'],
    subject: `Értesítés ${tracking} sikeres kézbesítéséről`,
    bodyText: `Értesítjük, hogy ${tracking} küldeményét a mai napon sikeresen kézbesítettük.`,
  });

  assert.deepEqual(evidence, []);
});

test('same DPD parcel progresses conservatively from pre-advice to shipped to courier to delivered', () => {
  const tracking = '16380100000012';
  const inputs = [
    {
      ...DPD_IDENTITY,
      subject: `Értesítés ${tracking} küldemény előkészítéséről`,
      bodyText: `Értesítjük, hogy a(z) Example Merchant Kft. partnerünk az Ön részére kézbesítendő csomago(ka)t készített össze.\nTájékoztatjuk, hogy ez egy előértesítés, a csomag(ok) fizikailag még nem került(ek) átadásra részünkre.\n${tracking}`,
    },
    {
      ...DPD_IDENTITY,
      subject: `Értesítés ${tracking} Example Merchant Kft. küldemény feladásáról`,
      bodyText: `Értesítjük, hogy a mai napon Example Merchant Kft. partnerünk az Ön részére kézbesítendő csomago(ka)t adott fel.\n${tracking}\nVárható kiszállítási nap: 2026-08-18`,
    },
    {
      ...DPD_IDENTITY,
      subject: `Értesítés ${tracking} Example Merchant Kft. küldemény mai kézbesítéséről`,
      bodyText: `Értesítjük, hogy a(z) Example Merchant Kft. partnerünk által az Ön részére feladott csomago(ka)t futárunk a mai napon kézbesítésre átvette.\n${tracking}\nA csomago(ka)t futárunk a mai napon várhatóan 09:00 - 10:00 között szállítja ki.`,
    },
    {
      ...DPD_IDENTITY,
      subject: `Értesítés ${tracking} sikeres kézbesítéséről`,
      bodyText: `Értesítjük, hogy ${tracking} küldeményét a mai napon sikeresen kézbesítettük.`,
    },
  ];

  const events = inputs.map((input) => {
    const [row] = dpdEvidence(input);
    assert.ok(row);
    assert.equal(row.identifiers.tracking_id, tracking);
    return row.event_candidate;
  });

  assert.deepEqual(events, ['SHIPMENT_CREATED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']);
});
