import assert from 'node:assert/strict';
import test from 'node:test';
import { EMAG_HU_RESEARCH_V1 } from './emag-hu-research-v1.js';

test('eMAG HU research remains non-executable until customer email fingerprints are verified', () => {
  assert.equal(EMAG_HU_RESEARCH_V1.status, 'research');
  assert.equal(EMAG_HU_RESEARCH_V1.executable_raw_email_profile, false);
});

test('eMAG AWB generation is shipment-created evidence and never physical delivery', () => {
  const row = EMAG_HU_RESEARCH_V1.events.find((entry) => entry.source_event.startsWith('AWB generated'));
  assert.ok(row);
  assert.equal(row.event_candidate, 'SHIPMENT_CREATED');
  assert.ok(row.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('eMAG easybox notification is ready for pickup and not delivered', () => {
  const row = EMAG_HU_RESEARCH_V1.events.find((entry) => entry.source_event.includes('easybox pickup'));
  assert.ok(row);
  assert.equal(row.event_candidate, 'READY_FOR_PICKUP');
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('eMAG return request and approval never finalize refund settlement', () => {
  const rows = EMAG_HU_RESEARCH_V1.events.filter((entry) => entry.event_candidate === 'RETURN');
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.ok(row.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
  }
});

test('eMAG merchant refund evidence remains weaker than final payment settlement', () => {
  const row = EMAG_HU_RESEARCH_V1.events.find((entry) => entry.source_event.includes('refund initiated'));
  assert.ok(row);
  assert.equal(row.event_candidate, 'REFUNDED');
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('eMAG cancellation and refund remain separate facts', () => {
  const row = EMAG_HU_RESEARCH_V1.events.find((entry) => entry.event_candidate === 'CANCELLED');
  assert.ok(row);
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('eMAG failed payment cannot fabricate a Purchase', () => {
  const row = EMAG_HU_RESEARCH_V1.events.find((entry) => entry.event_candidate === 'PAYMENT_FAILED');
  assert.ok(row);
  assert.ok(row.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(row.prohibitions.includes('DO_NOT_AUTO_LINK'));
});

test('eMAG research preserves one-to-many shipment identity under one order', () => {
  const awb = EMAG_HU_RESEARCH_V1.structural_signals.find((entry) => entry.name === 'carrier + AWB');
  assert.ok(awb);
  assert.match(awb.meaning, /multiple parcels\/AWBs/i);
  const event = EMAG_HU_RESEARCH_V1.events.find((entry) => entry.source_event.startsWith('AWB generated'));
  assert.ok(event?.requirements.some((item) => item.includes('multiple AWBs')));
});

test('invoice and warranty document availability does not imply an active warranty event', () => {
  const docs = EMAG_HU_RESEARCH_V1.structural_signals.find((entry) => entry.name === 'invoice / warranty attachment types');
  const warranty = EMAG_HU_RESEARCH_V1.events.find((entry) => entry.event_candidate === 'WARRANTY');
  assert.ok(docs);
  assert.ok(warranty);
  assert.ok(warranty.requirements.some((item) => item.includes('distinguish warranty document')));
});
