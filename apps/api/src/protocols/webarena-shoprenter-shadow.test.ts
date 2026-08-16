import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const WEBARENA_SENDER = {
  senderDomains: ['webarena.hu'],
  senderAddresses: ['ugyfelszolgalat@webarena.hu'],
};

const ORDER_ROUTE = {
  dkimDomains: ['shoprenter.hu'],
  returnPathDomains: ['mail2.shoprenter.hu'],
  transportHosts: ['o5.ptr824.shoprenter.hu'],
};

const STATUS_ROUTE = {
  dkimDomains: ['mail6.smtp.shoprenter.hu'],
  returnPathDomains: ['mail6.smtp.shoprenter.hu'],
  transportHosts: ['mail6.smtp.shoprenter.hu'],
};

function merchantEvidence(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.webarena');
}

test('observed WebArena alternate Shoprenter route recognizes ORDER_CREATED only in shadow', () => {
  const input = {
    ...WEBARENA_SENDER,
    ...ORDER_ROUTE,
    subject: 'Webaréna – Rendelés 246810',
    bodyText: [
      'Megrendelése megérkezett, feldolgozása elkezdődött.',
      'A rendelés részletei',
      'Rendelésszám: 246810',
      'Rendelés dátuma: 2026. 03. 18. 12:09:47',
      'Fizetési mód Utánvétel',
      'Szállítási mód Házhozszállítás futárszolgálattal',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);

  const shadow = detectShadowProtocolEvidence(input);
  const platform = shadow.find((row) => row.protocol_id === 'commerce.shoprenter');
  const merchant = shadow.find((row) => row.protocol_id === 'merchant.hu.webarena');

  assert.ok(platform);
  assert.equal(platform.event_candidate, 'ORDER_CREATED');
  assert.equal(platform.identifiers.order_id, '246810');
  assert.equal(platform.production_eligible, false);
  assert.ok(platform.provenance_levels.includes('observed_real_email'));

  assert.ok(merchant);
  assert.equal(merchant.event_candidate, 'ORDER_CREATED');
  assert.equal(merchant.identifiers.order_id, '246810');
  assert.equal(merchant.production_eligible, false);
});

test('alternate Shoprenter route lookalikes are rejected', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['merchant.example'],
    dkimDomains: ['shoprenter.hu.attacker.example'],
    returnPathDomains: ['mail2.shoprenter.hu.attacker.example'],
    bodyText: 'Megrendelése megérkezett, feldolgozása elkezdődött.\nA rendelés részletei\nRendelésszám: 246810',
  });

  assert.equal(evidence.some((row) => row.protocol_id === 'commerce.shoprenter'), false);
});

test('WebArena Elküldve remains OTHER and cannot set physical shipment state', () => {
  const evidence = merchantEvidence({
    ...WEBARENA_SENDER,
    ...STATUS_ROUTE,
    subject: 'Webaréna – a(z) 246810. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 246810',
      'Rendelés dátuma: 2026. 03. 18. 12:09:47',
      'A megrendelés frissítésre került, jelenlegi állapot:',
      'Elküldve',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.order_id, '246810');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'IN_TRANSIT'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('WebArena Elküldve pattern is repeatable across a second order without becoming SHIPPED', () => {
  const evidence = merchantEvidence({
    ...WEBARENA_SENDER,
    ...STATUS_ROUTE,
    subject: 'Webaréna – a(z) 315902. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 315902',
      'A megrendelés frissítésre került, jelenlegi állapot:',
      'Elküldve',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.order_id, '315902');
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
});

test('WebArena Teljesítve remains OTHER and never means DELIVERED without carrier proof', () => {
  const evidence = merchantEvidence({
    ...WEBARENA_SENDER,
    ...STATUS_ROUTE,
    subject: 'Webaréna – a(z) 246810. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 246810',
      'A megrendelés frissítésre került, jelenlegi állapot:',
      'Teljesítve',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.order_id, '246810');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
});

test('another Shoprenter merchant cannot inherit WebArena status semantics', () => {
  const evidence = merchantEvidence({
    senderDomains: ['other-shop.example'],
    senderAddresses: ['info@other-shop.example'],
    ...STATUS_ROUTE,
    subject: 'Webaréna – a(z) 246810. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 246810\nA megrendelés frissítésre került, jelenlegi állapot:\nTeljesítve',
  });

  assert.deepEqual(evidence, []);
});

test('WebArena-looking status mail without exact Shoprenter infrastructure is held', () => {
  const evidence = merchantEvidence({
    ...WEBARENA_SENDER,
    dkimDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    returnPathDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    subject: 'Webaréna – a(z) 246810. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 246810\nA megrendelés frissítésre került, jelenlegi állapot:\nElküldve',
  });

  assert.deepEqual(evidence, []);
});
