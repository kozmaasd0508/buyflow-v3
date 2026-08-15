import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicCommerceEmail } from './deterministic-commerce-parser.js';

test('carrier pickup from sender is shipped and never delivered', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.dpd.com'],
    subject: 'Csomagod átvettük – DPD-1184209473',
    bodyText: 'A küldeményt a futár átvette a feladótól. Csomagszám: DPD-1184209473 A csomag elindult a címzett felé.',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'shipped');
});

test('carrier pre-advice stays shipment_created and is not physical progress', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.expressone.hu'],
    subject: 'Küldemény előkészítve a szállításhoz – EXO-739441820',
    bodyText: 'A feladó elektronikusan rögzítette a küldeményt. Csomagszám: EXO-739441820. A címke elkészült, de a csomag fizikailag még nem érkezett be a futár hálózatába.',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'shipment_created');
});

test('delivery-today wording gets out_for_delivery phase, never delivered', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.dpd.com'],
    subject: 'Ma érkezik a csomagod – 16380124268888',
    bodyText: 'Tracking number: 16380124268888. A küldemény kézbesítőnél van, a futár ma megkísérli a kézbesítést.',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'out_for_delivery');
});

test('explicit successful delivery remains delivered', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.dhl.com'],
    subject: 'Sikeresen kézbesítettük a csomagot',
    bodyText: 'Tracking number: 00340434161094000123. A küldeményt sikeresen kézbesítettük. Átvette: címzett.',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'delivery');
  assert.equal(result.shipmentPhase, 'delivered');
});
