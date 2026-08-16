import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.pcx');
}

const AUTH = {
  senderDomains: ['pcx.hu'],
  senderAddresses: ['vevoszolgalat@pcx.hu'],
  dkimDomains: ['pcx.hu'],
};

test('PCX received order is ORDER_CREATED and production detector cannot see shadow profile', () => {
  const input = {
    ...AUTH,
    subject: 'Rendelés - 260101/580001',
    bodyText: [
      'Azonosító: 260101/580001',
      'Munkatársaink hamarosan megkezdik rendelésed feldolgozását.',
      'A futárnak történő átadásról e-mailben értesítünk.',
      'Rendelés összesítő',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '260101/580001');
  assert.equal(evidence[0]?.production_eligible, false);
});

test('PCX upcoming assembly is ORDER_PACKING and never shipment', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Hamarosan összeállítjuk a rendelésedet',
    bodyText: 'A(z) 260101/580002-es rendelést hamarosan elkezdjük összeállítani.',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_PACKING');
  assert.equal(evidence[0]?.identifiers.order_id, '260101/580002');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('PCX explicit DPD handoff is SHIPPED with order and tracking identity', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'DPD csomagod érkezik, a számlát csatoltuk',
    bodyText: [
      'Örömmel értesítünk, hogy rendelésedet kézbesítésre átadtuk, várhatóan a következő munkanapon érkezik.',
      'Csomag azonosító: 16380133000001',
      'Azonosító: 260101/580003',
      'A számlát és a garancialevelet mellékeltük.',
    ].join('\n'),
    attachmentFilenames: ['260101-580003.pdf'],
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPPED');
  assert.equal(evidence[0]?.identifiers.order_id, '260101/580003');
  assert.equal(evidence[0]?.identifiers.tracking_id, '16380133000001');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('PCX handoff plus verified invoice attachment yields SHIPPED and INVOICE separately', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'DPD csomagod érkezik, a számlát csatoltuk',
    bodyText: [
      'Örömmel értesítünk, hogy rendelésedet kézbesítésre átadtuk, várhatóan a következő munkanapon érkezik.',
      'A számlát aláírás és bélyegző nélkül is hiteles formában mellékeltük.',
      'Csomag azonosító: 16380133000002',
      'Azonosító: 260101/580004',
    ].join('\n'),
    attachmentFilenames: ['260101-580004.pdf', 'POB008001-2026.pdf'],
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate).sort(), ['INVOICE', 'SHIPPED']);
  const invoice = evidence.find((row) => row.event_candidate === 'INVOICE');
  assert.equal(invoice?.identifiers.order_id, '260101/580004');
  assert.equal(invoice?.identifiers.invoice_id, null);
  assert.ok(invoice?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('PCX warranty PDF alone is not invoice despite invoice-like terminology', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Dokumentumok',
    bodyText: 'Garancialap. Számlaérték 5798 HUF. Megrendelés száma 260101/580005.',
    attachmentFilenames: ['260101-580005.pdf'],
  }), []);
});

test('PCX shipment without POB invoice attachment cannot invent INVOICE', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'DPD csomagod érkezik, a számlát csatoltuk',
    bodyText: [
      'Rendelésedet kézbesítésre átadtuk.',
      'A számlát és a garancialevelet mellékeltük.',
      'Csomag azonosító: 16380133000003',
      'Azonosító: 260101/580006',
    ].join('\n'),
    attachmentFilenames: ['260101-580006.pdf'],
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['SHIPPED']);
  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
});

test('PCX conditional locker payment instructions do not create payment success', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'DPD csomagod érkezik, a számlát csatoltuk',
    bodyText: [
      'Rendelésedet kézbesítésre átadtuk.',
      'Csomag azonosító: 16380133000004',
      'Azonosító: 260101/580007',
      'Sikeres kártyás fizetés után a DPD elküldi a csomagautomata nyitásához szükséges PIN kódot.',
    ].join('\n'),
  });

  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
});

test('PCX post-purchase review request is OTHER and never delivery evidence', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Hogy működnek a termékeid?',
    bodyText: 'Mondd el a véleményed a 260101/580008 rendelésben vásárolt termékekről.',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('PCX profile rejects lookalike DKIM', () => {
  assert.deepEqual(rows({
    ...AUTH,
    dkimDomains: ['pcx.hu.attacker.example'],
    subject: 'Hamarosan összeállítjuk a rendelésedet',
    bodyText: 'A(z) 260101/580009-es rendelést hamarosan elkezdjük összeállítani.',
  }), []);
});

test('PCX unsupported payment, return, refund, warranty and delivered wording stays unsupported', () => {
  const unsupported = [
    ['Sikeres fizetés', 'A 260101/580010 rendelés fizetése sikeres.'],
    ['Visszaküldés', 'A 260101/580010 rendelés visszaküldése elindult.'],
    ['Visszatérítés', 'A 260101/580010 rendelés összegét visszatérítettük.'],
    ['Garanciális ügy', 'A 260101/580010 rendeléshez garanciális ügy indult.'],
    ['Kézbesítve', 'A 260101/580010 rendelés sikeresen kézbesítve.'],
    ['Törölve', 'A 260101/580010 rendelést töröltük.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});
