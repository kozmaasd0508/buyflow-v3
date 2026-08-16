import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.ipon');
}

const AUTH = {
  senderDomains: ['ipon.hu'],
  senderAddresses: ['info@ipon.hu'],
  dkimDomains: ['ipon.hu'],
};

test('iPon recorded order is ORDER_CREATED and remains shadow-only', () => {
  const input = {
    ...AUTH,
    subject: 'iPon - Rendelés #3091626',
    bodyText: [
      'KÖSZÖNJÜK, HOGY TŐLÜNK RENDELTÉL!',
      'Vásárlás azonosító: #3091626',
      '2026.04.10. 15:55-kor az alábbi termék(ek) rendelését rögzítettük a(z) 3091626 rendelési számon.',
      'A jelen megrendelés részünkről ajánlattételnek nem minősül.',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '3091626');
  assert.equal(evidence[0]?.production_eligible, false);
});

test('iPon future courier handoff is ORDER_PROCESSING and never shipment', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'iPon - Rendelés #3091626',
    bodyText: [
      'Az alábbi termékeket hétfőn átadjuk a futárnak, innentől 1-3 munkanapon belül kiszállítják.',
      "2026.04.10 15:55-kor az alábbi termékeket rendelted meg a(z) '3091626' rendelési számon.",
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_PROCESSING');
  assert.equal(evidence[0]?.identifiers.order_id, '3091626');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('iPon Csomagfeladás is SHIPMENT_CREATED because handoff is still same-day future wording', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Csomagfeladás #3091626',
    bodyText: [
      'Rendelésedet a mai napon átadjuk a GLS futárszolgálatnak, akik hamarosan, 1-2 munkanapon belül kiszállítják.',
      'Csomagszám: 3396938822.',
      'A csomagkövetést az alábbi linken érheted el néhány órán belül.',
      'Vásárlás azonosító: #3091626',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '3091626');
  assert.equal(evidence[0]?.identifiers.tracking_id, '3396938822');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('iPon SZAMI Group pre-advice also stays SHIPMENT_CREATED', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Csomagfeladás #3007290',
    bodyText: [
      'Rendelésedet a mai napon átadjuk a SZAMI Group futárszolgálatnak, akik hamarosan, 1-2 munkanapon belül kiszállítják.',
      'Csomagszám: SZ1200I2113825.',
      'Vásárlás azonosító: #3007290',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(evidence[0]?.identifiers.tracking_id, 'SZ1200I2113825');
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('iPon explicit invoice email is INVOICE with invoice id from subject', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Számla 2026/067376',
    bodyText: 'Köszönjük a vásárlást! Mellékelten küldjük a vásárláshoz tartozó számlát, a garanciajegyet és az elállási tájékoztatót.',
    attachmentFilenames: [
      'Tajekoztato-a-jotallasi-es-elallasi-jogokrol.pdf',
      '2177008-guarantee.pdf',
      '2026-067376-invoice-2177008.pdf',
    ],
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.invoice_id, '2026/067376');
  assert.equal(evidence.some((row) => row.event_candidate === 'WARRANTY'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
});

test('iPon guarantee and withdrawal attachments alone do not create invoice/warranty/return', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Dokumentumok',
    bodyText: 'Garanciajegy és elállási tájékoztató.',
    attachmentFilenames: ['2177008-guarantee.pdf', 'Tajekoztato-a-jotallasi-es-elallasi-jogokrol.pdf'],
  }), []);
});

test('iPon cart reminder is OTHER and cannot create a purchase', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Kosár emlékeztető',
    bodyText: [
      'KOSÁRBAN MARADT TERMÉKEK',
      'A legutóbbi látogatásod során a kosaradban maradtak az alábbi termékek:',
      'TRACER Tumba hangszóró - 24 590 Ft',
      'Pár kattintás után azonnal meg tudod vásárolni a kívánt termékeket.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.equal(evidence.some((row) => row.event_candidate === 'ORDER_CREATED'), false);
});

test('iPon product review request is OTHER and never delivery evidence', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Termékek véleményezése',
    bodyText: 'Véleményezze a megrendelt termékeket! Elégedett a termékkel, ajánlaná másnak is?',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('iPon wrong DKIM rejects otherwise matching lifecycle email', () => {
  assert.deepEqual(rows({
    ...AUTH,
    dkimDomains: ['ipon.hu.attacker.example'],
    subject: 'Csomagfeladás #3091626',
    bodyText: 'Rendelésedet a mai napon átadjuk a GLS futárszolgálatnak. Csomagszám: 3396938822. Vásárlás azonosító: #3091626',
  }), []);
});

test('iPon human finance reply is not generalized into automated payment success', () => {
  assert.deepEqual(rows({
    senderDomains: ['ipon.hu'],
    senderAddresses: ['cserbalazs@ipon.hu'],
    dkimDomains: ['ipon.hu'],
    subject: 'Re: Ax 17',
    bodyText: 'Az utalás beérkezett. Köszönöm.',
  }), []);
});

test('iPon human withdrawal guidance does not prove RETURN or REFUNDED', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Re: termékcsere',
    bodyText: 'A nem kért termékre elállást tud igénybe venni. Csatoljuk az elállási nyilatkozatot.',
  }), []);
});

test('iPon unsupported final lifecycle wording stays unsupported', () => {
  const unsupported = [
    ['Kézbesítve #3091626', 'A 3091626 rendelést sikeresen kézbesítettük.'],
    ['Törölve #3091626', 'A 3091626 rendelést töröltük.'],
    ['Visszatérítés #3091626', 'A 3091626 rendelés összegét visszatérítettük.'],
    ['Garanciális ügy #3091626', 'A 3091626 rendeléshez garanciális ügy indult.'],
    ['Fizetés sikeres #3091626', 'A 3091626 rendelés fizetése sikeres.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});
