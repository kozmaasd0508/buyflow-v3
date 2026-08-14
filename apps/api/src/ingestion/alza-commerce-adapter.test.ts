import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAlzaCommerceEmail } from './alza-commerce-adapter.js';

test('parses AlzaBox arrival as ready for pickup, not a new order', () => {
  const parsed = parseAlzaCommerceEmail({
    senderDomains: ['alza.hu'],
    subject: 'Vedd át 602385238 sz. megrendelésed',
    bodyText: 'Megrendelés 602385238\n602385238 sz. megrendelésed megérkezett a Törökszentmiklós AlzaBoxba.',
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'shipment');
  assert.equal(parsed.extraction.order_number, '602385238');
  assert.equal(parsed.shipmentPhase, 'ready_for_pickup');
  assert.equal(parsed.extraction.merchant, 'Alza.hu');
});

test('rejects Alza pickup wording without matching order identity', () => {
  const parsed = parseAlzaCommerceEmail({
    senderDomains: ['alza.hu'],
    subject: 'Vedd át 602385238 sz. megrendelésed',
    bodyText: 'Megrendelés 999999999\nA megrendelésed megérkezett az AlzaBoxba.',
  });
  assert.equal(parsed, null);
});

test('rejects lookalike Alza sender', () => {
  const parsed = parseAlzaCommerceEmail({
    senderDomains: ['alza-example.hu'],
    subject: 'Vedd át 602385238 sz. megrendelésed',
    bodyText: 'Megrendelés 602385238\n602385238 sz. megrendelésed megérkezett az AlzaBoxba.',
  });
  assert.equal(parsed, null);
});
