import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const SMTP_SHOPRENTER = {
  dkimDomains: ['mail6.smtp.shoprenter.hu'],
  returnPathDomains: ['mail6.smtp.shoprenter.hu'],
};

const FORPRO_SENDER = {
  senderDomains: ['sport8.hu'],
  senderAddresses: ['info@sport8.hu'],
};

function merchantEvidence(
  protocolId: string,
  input: Parameters<typeof detectShadowProtocolEvidence>[0],
) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === protocolId);
}

function assertNoUnsafeLifecyclePromotion(
  evidence: ReturnType<typeof detectShadowProtocolEvidence>,
) {
  const unsafe = new Set([
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'READY_FOR_PICKUP',
    'DELIVERED',
    'REFUNDED',
  ]);
  assert.deepEqual(
    evidence.filter((row) => unsafe.has(row.event_candidate)),
    [],
  );
}

test('observed Forproshop confirmation is ORDER_CREATED in merchant shadow and generic Shoprenter shadow', () => {
  const input = {
    ...FORPRO_SENDER,
    ...SMTP_SHOPRENTER,
    subject: 'Rendelés visszaigazolás - Forproshop - 27184',
    bodyText: [
      'RENDELÉS VISSZAIGAZOLÁS',
      'Köszönjük, hogy a Forproshop webáruházban vásárolt.',
      'Megrendelése megérkezett és feldolgozása megkezdődött.',
      'Rendelés azonosító: 27184',
      'Rendelés részletei',
      'Rendelésszám: #27184',
      'Szállítási mód',
      'FOXPOST - Packeta Group csomagautomata',
      'Fizetési mód',
      'Utánvétel',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);

  const evidence = detectShadowProtocolEvidence(input);
  const merchant = evidence.find((row) => row.protocol_id === 'merchant.hu.forproshop');
  const platform = evidence.find((row) => row.protocol_id === 'commerce.shoprenter');

  assert.ok(merchant);
  assert.equal(merchant.event_candidate, 'ORDER_CREATED');
  assert.equal(merchant.identifiers.order_id, '27184');
  assert.equal(merchant.production_eligible, false);

  assert.ok(platform);
  assert.equal(platform.event_candidate, 'ORDER_CREATED');
  assert.equal(platform.identifiers.order_id, '27184');
  assert.equal(platform.protocol_version, '1.0.0-test.3');
  assert.equal(platform.production_eligible, false);
});

test('Forproshop shipping-progress label stays OTHER because it does not prove carrier handoff', () => {
  const evidence = merchantEvidence('merchant.hu.forproshop', {
    ...FORPRO_SENDER,
    ...SMTP_SHOPRENTER,
    subject: 'Forproshop – a(z) 27184. számú rendelés állapota megváltozott',
    bodyText: [
      'Forproshop',
      'RENDELÉS FRISSÍTÉS',
      'Rendelés állapota: Rendelése elkészült - szállítás folyamatban',
      'Rendelés adatai',
      'Rendelésszám: 27184',
      'Várható szállítás',
      '2026. június 25.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.identifiers.order_id, '27184');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assertNoUnsafeLifecyclePromotion(evidence);
});

test('Forproshop Teljesítve stays OTHER and never becomes delivered or refunded', () => {
  const evidence = merchantEvidence('merchant.hu.forproshop', {
    ...FORPRO_SENDER,
    ...SMTP_SHOPRENTER,
    subject: 'Forproshop – a(z) 27184. számú rendelés állapota megváltozott',
    bodyText: [
      'Forproshop',
      'RENDELÉS FRISSÍTÉS',
      'Rendelés állapota: Teljesítve',
      'Rendelés adatai',
      'Rendelésszám: 27184',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
  assertNoUnsafeLifecyclePromotion(evidence);
});

test('Forproshop-looking status on another sender cannot inherit Forproshop semantics', () => {
  const evidence = merchantEvidence('merchant.hu.forproshop', {
    senderDomains: ['other-shop.example'],
    senderAddresses: ['info@other-shop.example'],
    ...SMTP_SHOPRENTER,
    subject: 'Forproshop – a(z) 27184. számú rendelés állapota megváltozott',
    bodyText: 'Rendelés állapota: Rendelése elkészült - szállítás folyamatban\nRendelésszám: 27184',
  });

  assert.deepEqual(evidence, []);
});

test('Forproshop-looking mail on a Shoprenter lookalike domain is rejected', () => {
  const evidence = merchantEvidence('merchant.hu.forproshop', {
    ...FORPRO_SENDER,
    dkimDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    returnPathDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    subject: 'Forproshop – a(z) 27184. számú rendelés állapota megváltozott',
    bodyText: 'Rendelés állapota: Teljesítve\nRendelésszám: 27184',
  });

  assert.deepEqual(evidence, []);
});

test('four-merchant Shoprenter status safety matrix blocks label-only shipment and delivery promotion', () => {
  const fixtures = [
    {
      name: 'Gyerekjatekbolt Szállítás alatt without explicit courier handoff',
      input: {
        senderDomains: ['gyerekjatekbolt.com'],
        senderAddresses: ['gyerekjatekbolt@gyerekjatekbolt.com'],
        ...SMTP_SHOPRENTER,
        subject: 'Gyerekjatekbolt.com – a(z) 536066. számú rendelés állapota megváltozott',
        bodyText: [
          'Rendelésszám: #536066',
          'A megrendelés frissítésre került, jelenlegi állapot: Szállítás alatt',
        ].join('\n'),
      },
    },
    {
      name: 'Home Automatica Elküldve without carrier proof',
      input: {
        senderDomains: ['homeautomatica.hu'],
        senderAddresses: ['info@homeautomatica.hu'],
        ...SMTP_SHOPRENTER,
        subject: 'Home Automatica Kft – a(z) 842. számú rendelés állapota megváltozott',
        bodyText: [
          'Rendelésszám: 842',
          'A megrendelés frissítésre került, jelenlegi állapot:',
          'Elküldve',
        ].join('\n'),
      },
    },
    {
      name: 'WebArena Elküldve without carrier proof',
      input: {
        senderDomains: ['webarena.hu'],
        senderAddresses: ['ugyfelszolgalat@webarena.hu'],
        ...SMTP_SHOPRENTER,
        subject: 'Webaréna – a(z) 236636. számú rendelés állapota megváltozott',
        bodyText: [
          'Rendelésszám: 236636',
          'A megrendelés frissítésre került, jelenlegi állapot:',
          'Elküldve',
        ].join('\n'),
      },
    },
    {
      name: 'WebArena Teljesítve without direct carrier delivery proof',
      input: {
        senderDomains: ['webarena.hu'],
        senderAddresses: ['ugyfelszolgalat@webarena.hu'],
        ...SMTP_SHOPRENTER,
        subject: 'Webaréna – a(z) 236636. számú rendelés állapota megváltozott',
        bodyText: [
          'Rendelésszám: 236636',
          'A megrendelés frissítésre került, jelenlegi állapot:',
          'Teljesítve',
        ].join('\n'),
      },
    },
    {
      name: 'Forproshop shipping-progress label without carrier handoff proof',
      input: {
        ...FORPRO_SENDER,
        ...SMTP_SHOPRENTER,
        subject: 'Forproshop – a(z) 27184. számú rendelés állapota megváltozott',
        bodyText: 'Rendelés állapota: Rendelése elkészült - szállítás folyamatban\nRendelésszám: 27184',
      },
    },
    {
      name: 'Forproshop Teljesítve without direct carrier delivery proof',
      input: {
        ...FORPRO_SENDER,
        ...SMTP_SHOPRENTER,
        subject: 'Forproshop – a(z) 27184. számú rendelés állapota megváltozott',
        bodyText: 'Rendelés állapota: Teljesítve\nRendelésszám: 27184',
      },
    },
  ];

  for (const fixture of fixtures) {
    const evidence = detectShadowProtocolEvidence(fixture.input);
    assertNoUnsafeLifecyclePromotion(evidence);
  }
});

test('Home Automatica Jóváírás remains non-refund in cross-merchant safety matrix', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['homeautomatica.hu'],
    senderAddresses: ['info@homeautomatica.hu'],
    ...SMTP_SHOPRENTER,
    subject: 'Home Automatica Kft – a(z) 842. számú rendelés állapota megváltozott',
    bodyText: [
      'Rendelésszám: 842',
      'A megrendelés frissítésre került, jelenlegi állapot:',
      'Jóváírás',
    ].join('\n'),
  });

  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
});
