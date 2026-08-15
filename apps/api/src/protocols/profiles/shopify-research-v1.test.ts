import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from '../detect.js';
import { validateProtocolProfile } from '../profile-validator.js';
import {
  SHOPIFY_NOTIFICATION_RESEARCH_V1,
  SHOPIFY_RESEARCH_V1,
} from './shopify-research-v1.js';

test('Shopify research profile is valid but deliberately not production-active', () => {
  assert.deepEqual(validateProtocolProfile(SHOPIFY_RESEARCH_V1), []);
  assert.equal(SHOPIFY_RESEARCH_V1.status, 'research');
});

test('official Shopify rewritten sender establishes only shared platform evidence', () => {
  const [evidence] = detectProtocolEvidence({
    senderDomains: ['shopifyemail.com'],
    senderAddresses: ['store+123@shopifyemail.com'],
    subject: 'Store notification',
    bodyText: 'Order #1004',
  }, [SHOPIFY_RESEARCH_V1]);

  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'OTHER');
  assert.equal(evidence.production_eligible, false);
  assert.deepEqual(evidence.prohibitions, ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK']);
  assert.equal(evidence.identifiers.order_id, null);
});

test('Shopify shared sender matching rejects attacker lookalikes', () => {
  assert.deepEqual(detectProtocolEvidence({
    senderDomains: ['shopifyemail.com.attacker.example'],
    subject: 'Store notification',
  }, [SHOPIFY_RESEARCH_V1]), []);
});

test('merchant custom sender domain is not falsely identified as Shopify from a subject alone', () => {
  assert.deepEqual(detectProtocolEvidence({
    senderDomains: ['merchant.example'],
    subject: 'Order #1004 confirmed',
    bodyText: 'Thank you for your order.',
  }, [SHOPIFY_RESEARCH_V1]), []);
});

test('Shopify research catalog keeps fulfillment confirmation before physical shipment', () => {
  const row = SHOPIFY_NOTIFICATION_RESEARCH_V1.find((entry) => entry.notification === 'Shipping confirmation');
  assert.ok(row);
  assert.equal(row.event_candidate, 'SHIPMENT_CREATED');
  assert.ok(row.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('Shopify ready-for-pickup remains distinct from delivery', () => {
  const row = SHOPIFY_NOTIFICATION_RESEARCH_V1.find((entry) => entry.notification === 'Ready for pickup');
  assert.ok(row);
  assert.equal(row.event_candidate, 'READY_FOR_PICKUP');
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('Shopify merchant refund evidence cannot finalize settled REFUNDED', () => {
  const row = SHOPIFY_NOTIFICATION_RESEARCH_V1.find((entry) => entry.notification === 'Order refund');
  assert.ok(row);
  assert.equal(row.event_candidate, 'REFUNDED');
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('Shopify pending-payment success and failure remain separate payment evidence', () => {
  const success = SHOPIFY_NOTIFICATION_RESEARCH_V1.find((entry) => entry.notification === 'Pending payment success');
  const failed = SHOPIFY_NOTIFICATION_RESEARCH_V1.find((entry) => entry.notification === 'Pending payment error');
  assert.equal(success?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(failed?.event_candidate, 'PAYMENT_FAILED');
});

test('Shopify picked-up evidence is not silently aliased to delivered before taxonomy supports it', () => {
  const row = SHOPIFY_NOTIFICATION_RESEARCH_V1.find((entry) => entry.notification === 'Picked up by customer');
  assert.ok(row);
  assert.equal(row.event_candidate, 'OTHER');
});

test('Shopify return approval is return evidence, not refund evidence', () => {
  const row = SHOPIFY_NOTIFICATION_RESEARCH_V1.find((entry) => entry.notification === 'Return request approved');
  assert.ok(row);
  assert.equal(row.event_candidate, 'RETURN');
  assert.ok(row.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});
