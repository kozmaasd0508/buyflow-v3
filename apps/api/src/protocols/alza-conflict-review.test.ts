import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicCommerceEmail } from '../ingestion/deterministic-commerce-parser.js';
import { detectShadowProtocolEvidence } from './shadow.js';

const AUTH = {
  senderDomains: ['alza.hu'],
  senderAddresses: ['segito@alza.hu'],
  dkimDomains: ['alza.hu'],
};

test('reviewed Alza finalization mail keeps logistics and invoice as independent evidence', () => {
  const orderNumber = '602385238';
  const bodyText = [
    `Megrendelés ${orderNumber}`,
    'Vedd át a megrendelésed az AlzaBoxból',
    `${orderNumber} sz. megrendelésed megérkezett a Törökszentmiklós AlzaBoxba.`,
    'Kód az átvételhez',
    'A fizetendő összeg 3350,00 Ft',
    'Kifizetem online',
    'Számla letöltése https://www.alza.hu/Apps/pdfdoc.asp?d=AHUW261747843&x=SAFE',
    'Az Alza ezzel az üzenettel elfogadta a megrendelésed, és így közöttetek szerződés jött létre az Alza Általános Szerződési Feltételei szerint.',
  ].join('\n');

  const shadow = detectShadowProtocolEvidence({
    ...AUTH,
    subject: `Vedd át ${orderNumber} sz. megrendelésed`,
    bodyText,
  }).filter((row) => row.protocol_id === 'merchant.hu.alza');

  assert.deepEqual(
    shadow.map((row) => row.event_candidate).sort(),
    ['INVOICE', 'READY_FOR_PICKUP'],
  );

  const legacy = parseDeterministicCommerceEmail({
    senderDomains: ['alza.hu'],
    subject: `Vedd át ${orderNumber} sz. megrendelésed`,
    bodyText,
  });

  assert.ok(legacy);
  assert.equal(legacy.shipmentPhase, 'ready_for_pickup');
  assert.equal(legacy.extraction.event_type, 'shipment');
  assert.notEqual(legacy.extraction.event_type, 'invoice_or_receipt');
});
