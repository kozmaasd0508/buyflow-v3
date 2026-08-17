import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicCommerceEmail } from '../ingestion/deterministic-commerce-parser.js';
import { detectShadowProtocolEvidence } from './shadow.js';

test('reviewed Express One pre-advice stays SHIPMENT_CREATED despite future delivery wording', () => {
  const tracking = '669695091305000013605231';
  const bodyText = [
    'Értesítjük, hogy a(z) Example Merchant partnerünk az Ön részére kézbesítendő, 1 darab csomagból álló küldemény feladását jelezte felénk.',
    'A küldemény átadása futárszolgálatunk részére még nem történt meg.',
    'Amennyiben a feladó átadja a csomagot, a kézbesítés a következő munkanapon belül várható.',
    'A TÉNYLEGES SZÁLLÍTÁS REGGELÉN ÉRTESÍTŐ E-MAILT KÜLDÜNK ÖNNEK.',
    'A kiszállítás napján reggel újabb értesítést küldünk, amely tartalmazza:',
    '- a kézbesítés várható időpontját, szűkítve azt, 2 órás időablakra',
    `Küldeményszám: ${tracking}`,
  ].join('\n');

  const shadow = detectShadowProtocolEvidence({
    senderDomains: ['expressone.hu'],
    senderAddresses: ['ertesites@expressone.hu'],
    dkimDomains: ['expressone.hu'],
    subject: 'Előzetes értesítés csomag érkezéséről',
    bodyText,
  }).filter((row) => row.protocol_id === 'carrier.hu.expressone');

  assert.equal(shadow.length, 1);
  assert.equal(shadow[0]?.event_candidate, 'SHIPMENT_CREATED');
  assert.equal(shadow[0]?.identifiers.tracking_id, tracking);
  assert.equal(shadow[0]?.production_eligible, false);
  assert.ok(shadow[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(shadow[0]?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(shadow[0]?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));

  const legacy = parseDeterministicCommerceEmail({
    senderDomains: ['expressone.hu'],
    subject: 'Előzetes értesítés csomag érkezéséről',
    bodyText,
  });

  assert.ok(legacy);
  assert.equal(legacy.shipmentPhase, 'out_for_delivery');
});
