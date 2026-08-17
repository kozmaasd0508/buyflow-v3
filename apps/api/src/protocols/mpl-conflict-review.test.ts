import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicLifecycleEmail } from '../ingestion/deterministic-lifecycle-parser.js';
import { detectShadowProtocolEvidence } from './shadow.js';

test('reviewed current MPL posting notice remains SHIPMENT_CREATED in protocol shadow', () => {
  const tracking = 'PB9S650307180';
  const bodyText = [
    'Értesítünk, hogy csomagot adtak fel Neked.',
    'Csomag adatai',
    'Feladó: Example Merchant Kft.',
    `Csomagazonosító: ${tracking}`,
    'Feladás dátuma: 2026.07.23.',
    'Házhoz szállítás esetén a kézbesítő indulásáról vagy a csomag átvételi pontra történő érkezéséről újabb üzenetet küldünk.',
  ].join('\n');

  const shadow = detectShadowProtocolEvidence({
    senderDomains: ['posta.hu'],
    senderAddresses: ['kozponti.ertesites@posta.hu'],
    dkimDomains: ['posta.hu'],
    subject: 'Csomagot adtak fel neked',
    bodyText,
  }).filter((row) => row.protocol_id === 'carrier.hu.mpl');

  assert.equal(shadow.length, 1);
  assert.equal(shadow[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow[0]?.identifiers.tracking_id, tracking);
  assert.equal(shadow[0]?.production_eligible, false);
  assert.ok(shadow[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(shadow[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));

  const legacy = parseDeterministicLifecycleEmail({
    senderDomains: ['posta.hu'],
    senderEmails: ['kozponti.ertesites@posta.hu'],
    subject: 'Csomagot adtak fel neked',
    bodyText,
  });

  assert.ok(legacy);
  assert.equal(legacy.lifecycleEvent, 'shipped');
  assert.equal(legacy.shipmentPhase, 'shipped');
});
