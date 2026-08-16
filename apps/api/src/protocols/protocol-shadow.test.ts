import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { registeredProtocolProfiles } from './registry.js';
import { detectShadowProtocolEvidence } from './shadow.js';
import { registeredTestProtocolProfiles } from './test-registry.js';

test('production registry stays empty while test registry contains WooCommerce', () => {
  assert.deepEqual(registeredProtocolProfiles(), []);
  const woo = registeredTestProtocolProfiles()
    .find((profile) => profile.protocol_id === 'commerce.woocommerce');
  assert.ok(woo);
  assert.equal(woo.protocol_version, '1.0.0-test.1');
  assert.equal(woo.status, 'test');
});

test('same WooCommerce processing email is invisible to production registry but visible in shadow', () => {
  const input = {
    senderDomains: ['shop.example'],
    subject: 'Your Demo Shop order has been received!',
    bodyText: "Hi Alex, we've received your order #12345, and it is now being processed: [Order #12345] Product Quantity Price",
  };

  assert.deepEqual(detectProtocolEvidence(input), []);

  const [shadow] = detectShadowProtocolEvidence(input);
  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'ORDER_PROCESSING');
  assert.equal(shadow.identifiers.order_id, '12345');
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(shadow.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
});

test('WooCommerce failed payment remains lifecycle-only shadow evidence', () => {
  const [shadow] = detectShadowProtocolEvidence({
    senderDomains: ['shop.example'],
    subject: 'Your order at Demo Shop was unsuccessful',
    bodyText: 'Sorry, your order was unsuccessful. Order #12345 Product Quantity Price',
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'PAYMENT_FAILED');
  assert.equal(shadow.identifiers.order_id, '12345');
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('WooCommerce refund cannot become a settled refund in shadow mode', () => {
  const [shadow] = detectShadowProtocolEvidence({
    senderDomains: ['shop.example'],
    subject: 'Your Demo Shop order #12345 has been refunded',
    bodyText: 'Order #12345',
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'REFUNDED');
  assert.equal(shadow.production_eligible, false);
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('WooCommerce fulfillment is shipped evidence and never delivered', () => {
  const [shadow] = detectShadowProtocolEvidence({
    senderDomains: ['shop.example'],
    subject: 'An item from Demo Shop order 12345 has been fulfilled!',
    bodyText: 'Your item is on the way! Tracking Number: DHL123456789 Shipment Provider: DHL Tracking URL: https://example.test/track Order #12345',
  });

  assert.ok(shadow);
  assert.equal(shadow.event_candidate, 'SHIPPED');
  assert.equal(shadow.identifiers.order_id, '12345');
  assert.equal(shadow.identifiers.tracking_id, 'DHL123456789');
  assert.notEqual(shadow.event_candidate, 'DELIVERED');
  assert.ok(shadow.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
});

test('default-looking WooCommerce subject alone does not trigger shadow evidence', () => {
  const shadow = detectShadowProtocolEvidence({
    senderDomains: ['shop.example'],
    subject: 'Your Demo Shop order has been received!',
    bodyText: 'Marketing newsletter: browse our latest products. Order #12345',
  });

  assert.deepEqual(shadow, []);
});
