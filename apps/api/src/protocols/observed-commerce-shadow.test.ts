import assert from 'node:assert/strict';
import test from 'node:test';
import { registeredProtocolProfiles } from './registry.js';
import { detectShadowProtocolEvidence } from './shadow.js';
import { registeredTestProtocolProfiles } from './test-registry.js';

test('production registry stays empty while first commerce wave is available only in shadow', () => {
  assert.deepEqual(registeredProtocolProfiles(), []);
  assert.deepEqual(
    registeredTestProtocolProfiles().map((profile) => profile.protocol_id).sort(),
    ['commerce.shopify', 'commerce.shoprenter', 'commerce.unas', 'commerce.woocommerce'],
  );
  assert.ok(registeredTestProtocolProfiles().every((profile) => profile.status === 'test'));
});

test('observed UNAS transport plus rendered order structure recognizes order creation in shadow', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['merchant.example'],
    transportHosts: ['s49.unas.hu'],
    subject: 'Example Shop - Automata megrendelés visszaigazolás - 1234-56789',
    bodyText: [
      'Kedves Vásárlónk!',
      'Megrendelésedet sikeresen leadtad, annak státuszáról hamarosan értesítünk.',
      'Megrendelés adatok',
      'Azonosító',
      '1234-56789',
      'Szállítási mód',
      'Csomagautomata',
      'Fizetési mód',
      'Bankkártya',
    ].join('\n'),
  });

  const unas = evidence.find((row) => row.protocol_id === 'commerce.unas');
  assert.ok(unas);
  assert.equal(unas.event_candidate, 'ORDER_CREATED');
  assert.equal(unas.identifiers.order_id, '1234-56789');
  assert.equal(unas.production_eligible, false);
  assert.ok(unas.provenance_levels.includes('observed_real_email'));
});

test('UNAS-looking body without observed UNAS transport is held', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['merchant.example'],
    subject: 'Automata megrendelés visszaigazolás - 1234-56789',
    bodyText: 'Megrendelésedet sikeresen leadtad. Megrendelés adatok\nAzonosító\n1234-56789\nSzállítási mód\nGLS\nFizetési mód\nUtánvét',
  });

  assert.equal(evidence.some((row) => row.protocol_id === 'commerce.unas'), false);
});

test('UNAS transport lookalike domain is rejected', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['merchant.example'],
    transportHosts: ['s49.unas.hu.attacker.example'],
    bodyText: 'Megrendelésedet sikeresen leadtad. Megrendelés adatok\nAzonosító\n1234-56789\nSzállítási mód\nGLS\nFizetési mód\nUtánvét',
  });

  assert.equal(evidence.some((row) => row.protocol_id === 'commerce.unas'), false);
});

test('observed Shoprenter infrastructure plus rendered order structure recognizes order creation in shadow', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['merchant.example'],
    dkimDomains: ['mail6.smtp.shoprenter.hu'],
    returnPathDomains: ['mail6.smtp.shoprenter.hu'],
    subject: 'Example Shop - Rendelés 536066',
    bodyText: [
      'RENDELÉS VISSZAIGAZOLÁS',
      'Megrendelése megérkezett, feldolgozása elkezdődött',
      'Köszönettel vettük megrendelését!',
      'Rendelés részletei',
      'Rendelésszám: #536066',
      'Szállítási mód',
      'Házhozszállítás',
      'Fizetési mód',
      'Bankkártya',
    ].join('\n'),
  });

  const shoprenter = evidence.find((row) => row.protocol_id === 'commerce.shoprenter');
  assert.ok(shoprenter);
  assert.equal(shoprenter.event_candidate, 'ORDER_CREATED');
  assert.equal(shoprenter.identifiers.order_id, '536066');
  assert.equal(shoprenter.production_eligible, false);
  assert.ok(shoprenter.provenance_levels.includes('observed_real_email'));
});

test('Shoprenter-looking body without platform DKIM and return-path evidence is held', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['merchant.example'],
    bodyText: 'Megrendelése megérkezett, feldolgozása elkezdődött\nRendelés részletei\nRendelésszám: #536066',
  });

  assert.equal(evidence.some((row) => row.protocol_id === 'commerce.shoprenter'), false);
});

test('Shoprenter infrastructure lookalikes are rejected', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['merchant.example'],
    dkimDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    returnPathDomains: ['mail6.smtp.shoprenter.hu.attacker.example'],
    bodyText: 'Megrendelése megérkezett, feldolgozása elkezdődött\nRendelés részletei\nRendelésszám: #536066',
  });

  assert.equal(evidence.some((row) => row.protocol_id === 'commerce.shoprenter'), false);
});

test('shared Shopify sender remains platform-only OTHER and cannot create or auto-link a Purchase', () => {
  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['g.shopifyemail.com'],
    senderAddresses: ['store+123456@g.shopifyemail.com'],
    subject: 'Extra kedvezmény csak ma',
    bodyText: 'Promóciós ajánlat, nincs rendelési esemény.',
  });

  const shopify = evidence.find((row) => row.protocol_id === 'commerce.shopify');
  assert.ok(shopify);
  assert.equal(shopify.event_candidate, 'OTHER');
  assert.equal(shopify.production_eligible, false);
  assert.ok(shopify.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shopify.prohibitions.includes('DO_NOT_AUTO_LINK'));
});
