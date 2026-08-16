import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const EXPRESSONE_IDENTITY = {
  senderDomains: ['expressone.hu'],
  senderAddresses: ['ertesites@expressone.hu'],
  dkimDomains: ['expressone.hu'],
};

function expressOneEvidence(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'carrier.hu.expressone');
}

test('Express One recipient pre-advice is SHIPMENT_CREATED and not physical possession', () => {
  const tracking = '605855680000000013605231';
  const input = {
    ...EXPRESSONE_IDENTITY,
    subject: 'Előzetes értesítés csomag érkezéséről',
    bodyText: [
      'Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő, 1 darab csomagból álló küldemény feladását jelezte felénk.',
      'A küldemény átadása futárszolgálatunk részére még nem történt meg.',
      `Küldeményszám: ${tracking}`,
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const [shadow] = expressOneEvidence(input);
  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow.identifiers.tracking_id, tracking);
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('Express One pre-advice without explicit not-handed-over wording is not promoted', () => {
  const evidence = expressOneEvidence({
    ...EXPRESSONE_IDENTITY,
    subject: 'Előzetes értesítés csomag érkezéséről',
    bodyText: [
      'Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő, 1 darab csomagból álló küldemény feladását jelezte felénk.',
      'Küldeményszám: 605855680000000013605232',
    ].join('\n'),
  });

  assert.deepEqual(evidence, []);
});

test('Express One physical central-hub inbound is IN_TRANSIT', () => {
  const tracking = '605855680000000013605233';
  const evidence = expressOneEvidence({
    ...EXPRESSONE_IDENTITY,
    subject: 'Küldemény feldolgozása megkezdődött',
    bodyText: [
      'Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő, 1 darab csomagból álló küldeményének feldolgozását megkezdtük a központi raktárunkban (fizikálisan érkeztettük).',
      'A küldeményt a következő küldeményszámon (fuvarlevélszámon) tartjuk nyilván:',
      tracking,
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'IN_TRANSIT');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('Express One same-day courier notification is OUT_FOR_DELIVERY', () => {
  const tracking = '605855680000000013605234';
  const evidence = expressOneEvidence({
    ...EXPRESSONE_IDENTITY,
    subject: 'Csomag kézbesítés ma – ETA és módosítás',
    bodyText: [
      `Értesítjük, hogy a(z) Example Merchant partnerünk által az Ön részére feladott 1 darab csomagból álló küldeményt futárunk a mai napon kézbesítésre átvette, melyet a következő küldeményszámon (fuvarlevélszámon) tartjuk nyilván:`,
      tracking,
      'A küldeményt futárunk a mai napon előreláthatóan 08:39-10:39 óra között az alábbi címre szállítja ki:',
      'ETA: 08:39-10:39',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OUT_FOR_DELIVERY');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('Express One revised ETA mail is DELAYED, not DELIVERY_FAILED', () => {
  const tracking = '605855680000000013605235';
  const evidence = expressOneEvidence({
    ...EXPRESSONE_IDENTITY,
    subject: 'Késik a kézbesítés – új ETA: 5 perc',
    bodyText: [
      `Értesítjük, hogy a ${tracking} küldeményszámon nyilvántartott, Example Merchant partnerünktől az Ön részére feladott 1 darab csomagból álló küldemény a korábban megadott 08:21-10:21 időintervallumban nem került kézbesítésre, a késés mértéke rögzítésre került.`,
      'Várható kézbesítési időpont: 3 óra múlva.',
      'A késésért elnézését kérjük.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELAYED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERY_FAILED'), false);
});

test('Express One explicit delivered feedback is direct DELIVERED proof', () => {
  const tracking = '605855680000000013605236';
  const evidence = expressOneEvidence({
    ...EXPRESSONE_IDENTITY,
    subject: 'Küldemény kézbesítve – kérdőív',
    bodyText: [
      `Example Merchant által ${tracking} számon feladott küldemény 2026-08-10 09:28:00 időpontban átadásra került.`,
      'Bővebb kézbesítési információ, valamint az átvételi elismervény a következő linken érhető el: https://tracking.expressone.hu/?h=example',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELIVERED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.equal(evidence[0]?.production_eligible, false);
});

test('Express One delivered subject alone is not enough', () => {
  const evidence = expressOneEvidence({
    ...EXPRESSONE_IDENTITY,
    subject: 'Küldemény kézbesítve – kérdőív',
    bodyText: 'Kérjük, ossza meg velünk véleményét szolgáltatásunkról.',
  });

  assert.deepEqual(evidence, []);
});

test('Express One sender-side eBox pickup notification is not a recipient purchase shipment event', () => {
  const evidence = expressOneEvidence({
    senderDomains: ['expressone.hu'],
    senderAddresses: ['no-reply@expressone.hu'],
    dkimDomains: ['expressone.hu'],
    subject: 'Expressone értesítés',
    bodyText: [
      'Az "771023" azonosítóval rögzített árufelvétel státusza megváltozott: a megbízást a futár elfogadta.',
      'Az árufelvétel a mai napon, várhatóan a 14-16 óra közötti időintervallumban történik.',
    ].join('\n'),
  });

  assert.deepEqual(evidence, []);
});

test('Express One payment receipt is not shipment DELIVERED or PAYMENT_SUCCESS evidence', () => {
  const evidence = expressOneEvidence({
    senderDomains: ['expressone.hu'],
    senderAddresses: ['slip@expressone.hu'],
    dkimDomains: ['expressone.hu'],
    subject: 'Fizetési bizonylat',
    bodyText: 'FIZETÉSI BIZONYLAT Express One Hungary Kft. Bankkártyás tranzakció.',
  });

  assert.deepEqual(evidence, []);
});

test('Express One-looking mail with lookalike DKIM is rejected', () => {
  const tracking = '605855680000000013605237';
  const evidence = expressOneEvidence({
    senderDomains: ['expressone.hu'],
    senderAddresses: ['ertesites@expressone.hu'],
    dkimDomains: ['expressone.hu.attacker.example'],
    subject: 'Csomag kézbesítés ma – ETA és módosítás',
    bodyText: [
      `A küldeményt futárunk a mai napon kézbesítésre átvette, melyet a következő küldeményszámon (fuvarlevélszámon) tartjuk nyilván: ${tracking}`,
      'A küldeményt futárunk a mai napon előreláthatóan 10:00-12:00 óra között az alábbi címre szállítja ki:',
    ].join('\n'),
  });

  assert.deepEqual(evidence, []);
});

test('same Express One parcel can progress conservatively through the observed recipient lifecycle', () => {
  const tracking = '605855680000000013605238';
  const inputs = [
    {
      ...EXPRESSONE_IDENTITY,
      subject: 'Előzetes értesítés csomag érkezéséről',
      bodyText: `Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő, 1 darab csomagból álló küldemény feladását jelezte felénk.\nA küldemény átadása futárszolgálatunk részére még nem történt meg.\nKüldeményszám: ${tracking}`,
    },
    {
      ...EXPRESSONE_IDENTITY,
      subject: 'Küldemény feldolgozása megkezdődött',
      bodyText: `Küldeményének feldolgozását megkezdtük a központi raktárunkban (fizikálisan érkeztettük).\nA küldeményt a következő küldeményszámon (fuvarlevélszámon) tartjuk nyilván: ${tracking}`,
    },
    {
      ...EXPRESSONE_IDENTITY,
      subject: 'Csomag kézbesítés ma – ETA és módosítás',
      bodyText: `A küldeményt futárunk a mai napon kézbesítésre átvette, melyet a következő küldeményszámon (fuvarlevélszámon) tartjuk nyilván: ${tracking}\nA küldeményt futárunk a mai napon előreláthatóan 08:00-10:00 óra között az alábbi címre szállítja ki:`,
    },
    {
      ...EXPRESSONE_IDENTITY,
      subject: 'Késik a kézbesítés – új ETA: 30 perc',
      bodyText: `Értesítjük, hogy a ${tracking} küldeményszámon nyilvántartott, Example Merchant partnerünktől az Ön részére feladott 1 darab csomagból álló küldemény a korábban megadott 08:00-10:00 időintervallumban nem került kézbesítésre, a késés mértéke rögzítésre került.`,
    },
    {
      ...EXPRESSONE_IDENTITY,
      subject: 'Küldemény kézbesítve – kérdőív',
      bodyText: `Example Merchant által ${tracking} számon feladott küldemény 2026-08-20 10:31:00 időpontban átadásra került.\nBővebb kézbesítési információ, valamint az átvételi elismervény a következő linken érhető el: https://tracking.expressone.hu/?h=example`,
    },
  ];

  const events = inputs.map((input) => {
    const [row] = expressOneEvidence(input);
    assert.ok(row);
    assert.equal(row.identifiers.tracking_id, tracking);
    return row.event_candidate;
  });

  assert.deepEqual(events, ['SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED', 'DELIVERED']);
});
