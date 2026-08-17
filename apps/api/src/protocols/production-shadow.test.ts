import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { registeredProtocolProfiles } from './registry.js';
import {
  emitProductionShadowEmailObservation,
  observeProductionShadowEmail,
  registeredProductionShadowProfiles,
} from './production-shadow.js';

const EXPECTED_GREEN_IDS = [
  'carrier.hu.dpd',
  'carrier.hu.foxpost',
  'carrier.hu.expressone',
  'carrier.hu.gls',
  'carrier.hu.mpl',
  'merchant.hu.gymbeam',
  'merchant.hu.alza',
  'payment.hu.simplepay',
];

const DPD_TRACKING = '16380100000001';

function dpdPreadviceEmail(withDkim = true): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'must-not-appear-in-shadow-log',
    subject: `Értesítés ${DPD_TRACKING} küldemény előkészítéséről`,
    from: [{ email: 'noreply@dpd.hu', name: 'DPD' }],
    to: [{ email: 'private-customer@example.test' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-17T08:00:00.000Z',
    folders: ['INBOX'],
    headers: withDkim
      ? [
        {
          name: 'Authentication-Results',
          value: 'mx.google.com; dkim=pass header.d=dpd.hu; spf=pass',
        },
      ]
      : [],
    bodyHtml: [
      '<p>Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő csomago(ka)t készített össze, melye(ke)t a következő csomagszámon és adatokkal tartunk nyilván.</p>',
      '<p>Tájékoztatjuk, hogy ez egy előértesítés, a csomag(ok) fizikailag még nem került(ek) átadásra részünkre, a további állapotváltozásról újabb értesítést fogunk küldeni.</p>',
      `<p>Example Merchant ${DPD_TRACKING}</p>`,
      '<p>PRIVATE BODY MARKER</p>',
    ].join(''),
    attachments: [],
  };
}

test('Gate B allowlist contains exactly the eight reviewed GREEN profiles', () => {
  assert.deepEqual(
    registeredProductionShadowProfiles().map((profile) => profile.protocol_id),
    EXPECTED_GREEN_IDS,
  );
  assert.ok(registeredProductionShadowProfiles().every((profile) => profile.status === 'test'));
});

test('production registry remains empty while Gate B shadow is available', () => {
  assert.deepEqual(registeredProtocolProfiles(), []);
});

test('GREEN production shadow observes authenticated DPD pre-advice without write authority', () => {
  const rows = observeProductionShadowEmail(dpdPreadviceEmail());
  const created = rows.find(
    (row) => row.protocol_id === 'carrier.hu.dpd' && row.event_candidate === 'SHIPMENT_CREATED',
  );

  assert.ok(created, 'expected authenticated DPD pre-advice to be observed');
  assert.equal(created.would_write, false);
  assert.equal(created.production_eligible, false);
  assert.equal(created.identifiers_present.tracking_id, true);
  assert.equal(created.authentication_evidence_present.dkim, true);
  assert.ok(created.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(created.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('required DKIM evidence fails closed in production shadow', () => {
  const rows = observeProductionShadowEmail(dpdPreadviceEmail(false));
  assert.equal(
    rows.some((row) => row.protocol_id === 'carrier.hu.dpd' && row.event_candidate === 'SHIPMENT_CREATED'),
    false,
  );
});

test('production shadow log is privacy-reduced and contains no raw email or identifier values', () => {
  const captured: Array<{ label: string; payload: string }> = [];
  const rows = emitProductionShadowEmailObservation(
    dpdPreadviceEmail(),
    (label, payload) => captured.push({ label, payload }),
  );

  assert.ok(rows.length > 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.label, '[protocol-production-shadow]');

  const payload = captured[0]?.payload ?? '';
  assert.match(payload, /"would_write":false/);
  assert.doesNotMatch(payload, /must-not-appear-in-shadow-log/);
  assert.doesNotMatch(payload, /private-customer@example\.test/);
  assert.doesNotMatch(payload, /PRIVATE BODY MARKER/);
  assert.doesNotMatch(payload, new RegExp(DPD_TRACKING));
  assert.doesNotMatch(payload, /noreply@dpd\.hu/);
});

test('YELLOW and RED profiles cannot enter the Gate B allowlist', () => {
  const ids = new Set(registeredProductionShadowProfiles().map((profile) => profile.protocol_id));
  for (const excluded of [
    'payment.hu.barion',
    'payment.stripe',
    'payment.paypal',
    'carrier.hu.packeta',
    'commerce.woocommerce',
    'commerce.shopify',
    'merchant.hu.emag',
  ]) {
    assert.equal(ids.has(excluded), false, `${excluded} must remain outside Gate B`);
  }
});
