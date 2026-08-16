import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id.startsWith('invoicing.hu.billingo'));
}

const AUTH = {
  senderDomains: ['billingo.hu'],
  senderAddresses: ['noreply@billingo.hu'],
  dkimDomains: ['billingo.hu'],
};

const INVOICE_BODY = [
  'Example Merchant számla',
  'Tisztelt Vásárló!',
  'Önnek számlája érkezett a(z) Example Merchant cégtől.',
  'Cégnév: Example Merchant Kft.',
  'E-mail: invoice@example.test',
  'A számla végösszege: 12 345 Ft',
  'Fizetési határidő: 2026-08-20',
  'Számla sorszáma: EX / 2026-001234',
  'Fizetési mód: Átutalás',
  'Ez egy automata üzenet, amit a Billingo számlázóprogram állított ki.',
  '[Számla letöltése](https://ses-track.billingo.hu/CL0/https:%2F%2Fapp.billingo.hu%2Fdocument-access%2Fsynthetic-token)',
  'Ezt a számlát a Billingo Online Számlázóval állították ki.',
].join('\n');

const PROFORMA_BODY = [
  'Example Academy díjbekérő',
  'Tisztelt Vásárló!',
  'Önnek díjbekérője érkezett a(z) Example Academy cégtől.',
  'Az átutalás közlemény rovatában kérjük, hogy kizárólag a díjbekérő sorszámát tüntesse fel.',
  'Cégnév: Example Academy Kft.',
  'E-mail: finance@example.test',
  // These misleading labels are intentionally copied from the observed Billingo proforma structure.
  'A számla végösszege: 342 900 Ft',
  'Fizetési határidő: 2026-08-20',
  'Számla sorszáma: 018879',
  'Fizetési mód: Átutalás',
  'Ez egy automata üzenet, amit a Billingo számlázóprogram állított ki.',
  '[DÍJBEKÉRŐ LETÖLTÉSE](https://ses-track.billingo.hu/CL0/https:%2F%2Fapp.billingo.hu%2Fdocument-access%2Fsynthetic-proforma-token)',
  'Ezt a számlát a Billingo Online Számlázóval állították ki.',
].join('\n');

test('Billingo invoice is shadow INVOICE and production registry cannot see it', () => {
  const input = {
    ...AUTH,
    subject: 'Számlája érkezett',
    bodyText: INVOICE_BODY,
  };

  assert.deepEqual(detectProtocolEvidence(input), []);

  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.protocol_id, 'invoicing.hu.billingo');
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.invoice_id, 'EX / 2026-001234');
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('Billingo electronic invoice wording remains INVOICE', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Számlája érkezett',
    bodyText: INVOICE_BODY.replace(
      'Önnek számlája érkezett',
      'Önnek elektronikus számlája érkezett',
    ).replace('EX / 2026-001234', '2026-52'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.invoice_id, '2026-52');
});

test('Billingo invoice number supports spaced prefix and slash format', () => {
  const [evidence] = rows({
    ...AUTH,
    subject: 'Számlája érkezett',
    bodyText: INVOICE_BODY.replace('EX / 2026-001234', 'BT / 2026-009222'),
  });

  assert.ok(evidence);
  assert.equal(evidence.identifiers.invoice_id, 'BT / 2026-009222');
});

test('Billingo proforma is OTHER, never INVOICE, despite invoice-like field labels', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Díjbekérője érkezett',
    bodyText: PROFORMA_BODY,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.protocol_id, 'invoicing.hu.billingo.proforma');
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.invoice_id, null);
  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('proforma invoice-like labels alone cannot satisfy Billingo invoice profile', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Díjbekérője érkezett',
    bodyText: PROFORMA_BODY
      .replace('Önnek díjbekérője érkezett', 'Önnek díjbekérője érkezett')
      .replace('DÍJBEKÉRŐ LETÖLTÉSE', 'Számla letöltése'),
  });

  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
});

test('Billingo invoice subject alone is insufficient', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Számlája érkezett',
    bodyText: 'Kérjük, jelentkezzen be a Billingo fiókjába.',
  }), []);
});

test('Billingo account/subscription notice does not become invoice', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Előfizetés hosszabbítása 7 nap múlva lesz esedékes',
    bodyText: 'Tájékoztatunk, hogy az előfizetésed hosszabbítása 7 nap múlva lesz esedékes.',
  }), []);
});

test('Billingo lookalike DKIM is rejected', () => {
  assert.deepEqual(rows({
    senderDomains: ['billingo.hu'],
    senderAddresses: ['noreply@billingo.hu'],
    dkimDomains: ['billingo.hu.attacker.example'],
    subject: 'Számlája érkezett',
    bodyText: INVOICE_BODY,
  }), []);
});

test('merchant-origin Billingo mention does not inherit Billingo invoice authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['shop.example'],
    senderAddresses: ['orders@shop.example'],
    dkimDomains: ['shop.example'],
    subject: 'Számlája érkezett - Billingo',
    bodyText: INVOICE_BODY,
  }), []);
});

test('verified Billingo provider does not invent correction or cancellation events without observed templates', () => {
  const unsupported = [
    {
      subject: 'Sztornó számlája érkezett',
      bodyText: 'Az eredeti számla sztornózásra került. Számla sorszáma: ST-2026-123.',
    },
    {
      subject: 'Módosító számlája érkezett',
      bodyText: 'Módosító számla készült. Számla sorszáma: MOD-2026-123.',
    },
  ];

  for (const fixture of unsupported) {
    assert.deepEqual(rows({ ...AUTH, ...fixture }), []);
  }
});

test('Billingo invoice existence never implies payment success', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Számlája érkezett',
    bodyText: INVOICE_BODY.replace('Fizetési mód: Átutalás', 'Fizetési mód: Bankkártya'),
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['INVOICE']);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
});
