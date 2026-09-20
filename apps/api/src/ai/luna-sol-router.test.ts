import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldEscalateLunaToSol } from './luna-sol-router.js';
import type { EmailExtraction } from './openai-email-extractor.js';

function extraction(overrides: Partial<EmailExtraction> = {}): EmailExtraction {
  return {
    event_type:'other', shipment_phase:null, evidence_issues:[],
    merchant:null, merchant_legal_name:null, order_number:null,
    subtotal:null, shipping_amount:null, discount_amount:null, total:null, currency:null,
    payment_status:null, payment_method:null, paid_amount:null, paid_currency:null,
    shipping_method:null, tracking_number:null, carrier:null, parcel_sender:null,
    cod_amount:null, cod_currency:null, invoice_number:null, products:[], confidence:0.99,
    ...overrides,
  };
}

test('does not escalate a clean low-risk observation', () => {
  assert.deepEqual(shouldEscalateLunaToSol(extraction()), { escalate:false, reasons:[] });
});

test('escalates order semantics even when Luna is highly confident', () => {
  const d=shouldEscalateLunaToSol(extraction({event_type:'order_created',order_number:'A-1',confidence:0.99}));
  assert.equal(d.escalate,true);
  assert.ok(d.reasons.includes('order_semantics'));
});

test('escalates incomplete shipment phase', () => {
  const d=shouldEscalateLunaToSol(extraction({event_type:'shipment',tracking_number:'T-1'}));
  assert.equal(d.escalate,true);
  assert.ok(d.reasons.includes('shipment_phase_missing'));
});

test('escalates merchant pre-advice boundary', () => {
  const d=shouldEscalateLunaToSol(extraction({
    event_type:'shipment',shipment_phase:'shipment_created',order_number:'O-1',tracking_number:'T-1',
  }));
  assert.equal(d.escalate,true);
  assert.ok(d.reasons.includes('merchant_pre_advice_boundary'));
});

test('escalates receipt missing order link', () => {
  const d=shouldEscalateLunaToSol(extraction({event_type:'invoice_or_receipt',invoice_number:'R-1'}));
  assert.equal(d.escalate,true);
  assert.ok(d.reasons.includes('receipt_missing_order_link'));
});

test('escalates explicit evidence issues and very low confidence', () => {
  const d=shouldEscalateLunaToSol(extraction({evidence_issues:['conflicting_evidence'],confidence:0.5}));
  assert.equal(d.escalate,true);
  assert.ok(d.reasons.includes('evidence_issue'));
  assert.ok(d.reasons.includes('low_confidence'));
});
