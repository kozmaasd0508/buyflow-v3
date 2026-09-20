import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailExtraction } from './openai-email-extractor.js';
import {
  BUYFLOW_SOL_VERIFIER_MODEL,
  decideSolVerification,
  extractionsAgreeOnCoreIdentity,
} from './sol-verification-policy.js';

function extraction(overrides: Partial<EmailExtraction> = {}): EmailExtraction {
  return {
    event_type: 'shipment',
    shipment_phase: 'shipped',
    evidence_issues: [],
    merchant: null,
    merchant_legal_name: null,
    order_number: null,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: 'TRACK-1',
    carrier: 'Carrier',
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
    ...overrides,
  };
}

test('Sol verifier model is pinned', () => {
  assert.equal(BUYFLOW_SOL_VERIFIER_MODEL, 'gpt-5.6-sol');
});

test('high-confidence unambiguous Luna extraction stays Luna-only', () => {
  assert.deepEqual(decideSolVerification(extraction()), { verify: false, reasons: [] });
  assert.deepEqual(decideSolVerification(extraction({
    event_type: 'shipment', shipment_phase: 'out_for_delivery',
  })), { verify: false, reasons: [] });
});

test('semantic boundary cases request Sol verification', () => {
  const cases: Array<[Partial<EmailExtraction>, string]> = [
    [{ evidence_issues: ['conflicting_evidence'] }, 'evidence_issue'],
    [{ confidence: 0.7 }, 'low_confidence'],
    [{ event_type: 'order_updated', shipment_phase: null }, 'order_update_boundary'],
    [{ event_type: 'shipment', shipment_phase: null }, 'shipment_phase_missing'],
    [{
      event_type: 'shipment', shipment_phase: 'shipment_created',
      order_number: 'ORDER-1', tracking_number: 'TRACK-1',
    }, 'merchant_pre_handover_boundary'],
    [{ event_type: 'order_created', shipment_phase: null, confidence: 0.98 }, 'ambiguous_order_creation'],
  ];

  for (const [overrides, reason] of cases) {
    const decision = decideSolVerification(extraction(overrides));
    assert.equal(decision.verify, true);
    assert.ok(decision.reasons.includes(reason as any));
  }
});

test('receipts do not spend Sol solely for a missing order link', () => {
  for (const order_number of [null, 'ORDER-1']) {
    assert.equal(decideSolVerification(extraction({
      event_type: 'invoice_or_receipt',
      shipment_phase: null,
      invoice_number: 'INV-1',
      order_number,
    })).verify, false);
  }
});

test('core agreement includes event, phase and durable identifiers', () => {
  const a = extraction();
  assert.equal(extractionsAgreeOnCoreIdentity(a, { ...a }), true);
  assert.equal(extractionsAgreeOnCoreIdentity(a, { ...a, shipment_phase: 'in_transit' }), false);
  assert.equal(extractionsAgreeOnCoreIdentity(a, { ...a, tracking_number: 'TRACK-2' }), false);
});
