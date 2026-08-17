import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGlsLifecycleEmail } from '../ingestion/gls-carrier-bridge-adapter.js';
import { detectShadowProtocolEvidence } from './shadow.js';

test('reviewed GLS Kézbesítés várható pre-advice remains SHIPMENT_CREATED', () => {
  const tracking = '3412000099';
  const bodyText = [
    'Ezúton értesítünk, hogy partnerünk csomago(ka)t készített össze számodra.',
    'A csomago(ka)t a feladást követő munkanapon megkíséreljük kézbesíteni az alábbiak szerint:',
    'Feladó:',
    'Example Merchant Kft.',
    'Csomagszám:',
    tracking,
    'Kézbesítés várható: 2026. 08. 20.',
    '(Amennyiben partnerünk ma feladja a csomago(ka)t.)',
  ].join('\n');

  const deterministic = parseGlsLifecycleEmail({
    from: [{ email: 'noreply@gls-hungary.com' }],
    subject: 'GLS csomag információ / GLS parcel information',
    bodyText,
  });

  assert.ok(deterministic);
  assert.equal(deterministic.shipmentPhase, 'shipment_created');
  assert.equal(deterministic.extraction.tracking_number, tracking);

  const evidence = detectShadowProtocolEvidence({
    senderDomains: ['gls-hungary.com'],
    senderAddresses: ['noreply@gls-hungary.com'],
    dkimDomains: ['gls-hungary.com'],
    subject: 'GLS csomag információ / GLS parcel information',
    bodyText,
  }).filter((row) => row.protocol_id === 'carrier.hu.gls');

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(evidence[0]?.identifiers.tracking_id, tracking);
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});
