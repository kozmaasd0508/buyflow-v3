import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from '../detect.js';
import { validateProtocolProfile } from '../profile-validator.js';
import { WOOCOMMERCE_RESEARCH_V1 } from './woocommerce-research-v1.js';

function detect(subject: string, bodyText: string) {
  return detectProtocolEvidence({
    senderDomains: ['shop.example'],
    subject,
    bodyText,
  }, [WOOCOMMERCE_RESEARCH_V1]);
}

test('WooCommerce research profile is valid but deliberately not production-active', () => {
  assert.deepEqual(validateProtocolProfile(WOOCOMMERCE_RESEARCH_V1), []);
  assert.equal(WOOCOMMERCE_RESEARCH_V1.status, 'research');
});

test('recognizes verified core processing-order defaults as lifecycle evidence', () => {
  const [evidence] = detect(
    'Your Demo Shop order has been received!',
    "Hi Alex, we've received your order #12345, and it is now being processed: [Order #12345] Product Quantity Price",
  );
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'ORDER_PROCESSING');
  assert.equal(evidence.identifiers.order_id, '12345');
  assert.equal(evidence.production_eligible, false);
  assert.ok(evidence.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
});

test('recognizes verified core failed-order defaults without creating a Purchase', () => {
  const [evidence] = detect(
    'Your order at Demo Shop was unsuccessful',
    'Sorry, your order was unsuccessful. Order #12345 Product Quantity Price',
  );
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'PAYMENT_FAILED');
  assert.equal(evidence.identifiers.order_id, '12345');
  assert.ok(evidence.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('recognizes verified customer cancellation with explicit order identity', () => {
  const [evidence] = detect(
    '[Demo Shop]: Your order #12345 has been cancelled',
    'Order cancelled: #12345. Order #12345 Product Quantity Price',
  );
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'CANCELLED');
  assert.equal(evidence.identifiers.order_id, '12345');
});

test('maps Woo historical invoice class only to payment action when payment copy is explicit', () => {
  const [evidence] = detect(
    'Details for order #12345 on Demo Shop',
    'An order has been created for you on Demo Shop. Your order details are below, with a link to make payment when you’re ready: Pay for this order. Order #12345',
  );
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'PAYMENT_ACTION_REQUIRED');
  assert.equal(evidence.identifiers.order_id, '12345');
  assert.equal(evidence.prohibitions.includes('DO_NOT_CREATE_PURCHASE'), true);
  assert.notEqual(evidence.event_candidate, 'INVOICE');
});

test('paid order-details email is not falsely treated as an invoice or payment request', () => {
  const evidence = detect(
    'Details for order #12345 on Demo Shop',
    'Here are the details of your order placed on August 16, 2026: Order #12345 Product Quantity Price',
  );
  assert.deepEqual(evidence, []);
});

test('full Woo refund email remains merchant refund evidence and cannot finalize REFUNDED', () => {
  const [evidence] = detect(
    'Your Demo Shop order #12345 has been refunded',
    'Order #12345',
  );
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'REFUNDED');
  assert.equal(evidence.identifiers.order_id, '12345');
  assert.ok(evidence.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('partial Woo refund remains distinct evidence through its rule id and cannot finalize REFUNDED', () => {
  const [evidence] = detect(
    'Your Demo Shop order #12345 has been partially refunded',
    'Order #12345',
  );
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'REFUNDED');
  assert.equal(evidence.evidence[0]?.rule_id, 'woo.refund.partial.default-subject');
  assert.ok(evidence.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('fulfillment-created default is shipped evidence, never delivered', () => {
  const [evidence] = detect(
    'An item from Demo Shop order 12345 has been fulfilled!',
    'Your item is on the way! Tracking Number: DHL123456789 Shipment Provider: DHL Tracking URL: https://example.test/track Order #12345',
  );
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'SHIPPED');
  assert.equal(evidence.identifiers.order_id, '12345');
  assert.equal(evidence.identifiers.tracking_id, 'DHL123456789');
  assert.ok(evidence.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('Woo Completed wording is deliberately not mapped to delivered or shipped in research v1', () => {
  assert.deepEqual(detect(
    'Your order from Demo Shop is on its way!',
    'Good things are heading your way! Order #12345',
  ), []);
  assert.deepEqual(detect(
    'Your Demo Shop order is now complete',
    'Thanks for shopping with us. Order #12345',
  ), []);
});

test('account, customer-note and reset-password noise do not become purchase lifecycle events', () => {
  assert.deepEqual(detect('Your Demo Shop account has been created!', 'Welcome to Demo Shop'), []);
  assert.deepEqual(detect('A note has been added to your order from Demo Shop', 'Order #12345 A note has been added'), []);
  assert.deepEqual(detect('Reset your password', 'Reset your password for Demo Shop'), []);
});

test('default-looking subject alone is insufficient without the verified Woo body structure', () => {
  assert.deepEqual(detect(
    'Your Demo Shop order has been received!',
    'Marketing newsletter: browse our latest products. Order #12345',
  ), []);
});
