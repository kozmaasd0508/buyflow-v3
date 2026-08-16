import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id.startsWith('invoicing.hu.szamlazz'));
}

const AUTH = {
  senderDomains: ['szamlazz.hu'],
  senderAddresses: ['examplemerchant@szamlazz.hu'],
  dkimDomains: ['szamlazz.hu'],
};

const DOWNLOAD = 'https://www.szamlazz.hu/szamla/fiok/synthetic-access?szfejguid=synthetic-guid';

const INVOICE_BODY = [
  'Tisztelt Vásárló!',
  'Köszönjük, hogy minket választott!',
  'Ezúton küldjük aktuális számláját.',
  'Kérjük, a számla tartalmának megfelelően legyen szíves a kifizetésről gondoskodni!',
  'Ez egy automatikus üzenet.',
  'A számlát cégünk a Számlázz.hu rendszerével állította ki.',
  `[Letöltöm a számlát](${DOWNLOAD})`,
  '©2005-2026 Számlázz.hu',
].join('\n');

const CUSTOM_SHIPPING_BODY = [
  'Kedves Vásárló!',
  'Rendelésedet átadtuk a futárszolgálatnak.',
  'A szállítás pontos időpontjáról ezután a szállító cég fog tájékoztatni.',
  'A rendeléshez tartozó számlád is elkészült, melyet a Letöltöm a számlát lehetőségre kattintva érhetsz el!',
  `[Letöltöm a számlát](${DOWNLOAD})`,
  '©2005-2026 Számlázz.hu',
].join('\n');

const STORNO_BODY = [
  'Kedves Vásárló!',
  'E-EX-2026-10001 sorszámú számládat sztornóztuk. A sztornószámlát a mellékletben találod!',
  'Üdvözlettel: Example Merchant',
  `[Letöltöm a számlát](${DOWNLOAD})`,
  '©2005-2026 Számlázz.hu',
].join('\n');

const REMINDER_BODY = [
  'Tisztelt Vásárló!',
  'Felhívjuk figyelmét, hogy a számlája fizetési határideje 3 nap múlva lejár.',
  'Kérjük, hogy a számla kiegyenlítéséről minél előbb gondoskodjon!',
  `[Letöltöm a számlát](${DOWNLOAD})`,
  '©2005-2026 Számlázz.hu',
].join('\n');

test('Számlázz.hu invoice is shadow INVOICE and production registry cannot see it', () => {
  const input = {
    ...AUTH,
    subject: 'Értesítő: Számla érkezett – Example Merchant',
    bodyText: INVOICE_BODY,
  };

  assert.deepEqual(detectProtocolEvidence(input), []);

  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.protocol_id, 'invoicing.hu.szamlazz');
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.invoice_id, null);
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('Számlázz.hu invoice can extract conservative invoice id from invoice-like PDF filename', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Számlaértesítő - Example Merchant',
    bodyText: INVOICE_BODY,
    attachmentFilenames: ['E-EX-2026-12345.pdf'],
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.invoice_id, 'E-EX-2026-12345');
});

test('merchant-customized shipping subject remains invoice evidence only, never carrier lifecycle', () => {
  const evidence = rows({
    ...AUTH,
    subject: '🎉 123456 számú rendelésedet átadtuk a futárszolgálatnak',
    bodyText: CUSTOM_SHIPPING_BODY,
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['INVOICE']);
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('Számlázz.hu storno is OTHER, never normal invoice or refunded payment', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Számlaértesítő - Example Merchant',
    bodyText: STORNO_BODY,
    attachmentFilenames: ['E-EX-2026-20002.pdf'],
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.protocol_id, 'invoicing.hu.szamlazz.storno');
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.invoice_id, null);
  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('Számlázz.hu payment reminder is OTHER, not payment failure or payer action', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Emlékeztető: Számla kifizetésre vár – Example Merchant',
    bodyText: REMINDER_BODY,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.protocol_id, 'invoicing.hu.szamlazz.payment-reminder');
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.invoice_id, null);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_FAILED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_ACTION_REQUIRED'), false);
});

test('invoice subject alone is insufficient because Számlázz.hu templates are customizable', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Értesítő: Számla érkezett – Example Merchant',
    bodyText: 'Köszönjük, hogy minket választott!',
  }), []);
});

test('lookalike DKIM is rejected', () => {
  assert.deepEqual(rows({
    senderDomains: ['szamlazz.hu'],
    senderAddresses: ['examplemerchant@szamlazz.hu'],
    dkimDomains: ['szamlazz.hu.attacker.example'],
    subject: 'Értesítő: Számla érkezett – Example Merchant',
    bodyText: INVOICE_BODY,
  }), []);
});

test('merchant-origin Számlázz.hu mention does not inherit invoicing authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['shop.example'],
    senderAddresses: ['billing@shop.example'],
    dkimDomains: ['shop.example'],
    subject: 'Számla érkezett - Számlázz.hu',
    bodyText: INVOICE_BODY,
  }), []);
});

test('unobserved proforma template is not promoted to invoice despite provider authentication and invoice link', () => {
  const bodyText = [
    'Tisztelt Vásárló!',
    'Díjbekérő érkezett. Kérjük, az összeget a megadott határidőig rendezze.',
    `[Letöltöm a bizonylatot](${DOWNLOAD})`,
    '©2005-2026 Számlázz.hu',
  ].join('\n');

  const evidence = rows({
    ...AUTH,
    subject: 'Díjbekérő érkezett',
    bodyText,
  });

  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
});

test('unobserved correction/modification wording is not invented as positive lifecycle', () => {
  const bodyText = [
    'Módosító számla készült a korábbi bizonylathoz.',
    `[Letöltöm a számlát](${DOWNLOAD})`,
    '©2005-2026 Számlázz.hu',
  ].join('\n');

  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Módosító számla',
    bodyText,
  }), []);
});

test('invoice existence and payment wording never imply PAYMENT_SUCCESS', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Értesítő: Számla érkezett – Example Merchant',
    bodyText: INVOICE_BODY.replace(
      'Kérjük, a számla tartalmának megfelelően legyen szíves a kifizetésről gondoskodni!',
      'Fizetési mód: Bankkártya. A számlát az online rendeléshez állítottuk ki.',
    ),
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['INVOICE']);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
});
