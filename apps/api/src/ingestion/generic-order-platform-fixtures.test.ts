import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSharedPlatformSenderDomain,
  parseGenericOrderConfirmationEmail,
} from './generic-order-confirmation-adapter.js';

test('recognizes a PrestaShop-like confirmation from a merchant-owned domain', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.atelier-demo.fr'],
    subject: 'Order confirmation #PS-81042',
    bodyText: [
      'Thank you for your order',
      'Order number: PS-81042',
      'Order details',
      'Canvas Bag | Qty 1 | 42.00 EUR',
      'Order total: 47.00 EUR',
      'Payment method: Credit card',
      'Shipping method: Colissimo',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.order_number, 'PS-81042');
  assert.equal(parsed.extraction.total, 47);
});

test('recognizes a BigCommerce-like confirmation from a merchant-owned domain', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['sales.ocean-outfitters.com'],
    subject: 'Order confirmation',
    bodyText: [
      'Your order is confirmed',
      'Order #: BC-991208',
      'Order summary',
      'Beach Towel | Qty 2 | 38.00 USD',
      'Grand total: 45.50 USD',
      'Payment method: Mastercard',
      'Shipping method: Ground',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.order_number, 'BC-991208');
  assert.equal(parsed.extraction.currency, 'USD');
});

test('recognizes a Squarespace-like order when the shop uses its own sender domain', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.cedar-studio.co.uk'],
    subject: 'Order confirmed',
    bodyText: [
      'Thanks for your order',
      'Order number: SQ-33017',
      'Order summary',
      'Ceramic Vase | Qty 1 | 55.00 GBP',
      'Order total: 61.00 GBP',
      'Payment method: Visa',
      'Shipping method: Standard',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.merchant, 'Cedar Studio');
  assert.equal(parsed.extraction.order_number, 'SQ-33017');
  assert.equal(parsed.extraction.currency, 'GBP');
});

test('holds Shopify rewritten shared sender for review instead of inventing a merchant', () => {
  assert.equal(isSharedPlatformSenderDomain('shopifyemail.com'), true);
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['shopifyemail.com'],
    subject: 'Order #SH-55192 confirmed',
    bodyText: [
      'Thanks for your order',
      'Order #: SH-55192',
      'Order summary',
      'Running Socks | Qty 2 | 18.00 EUR',
      'Order total: 23.00 EUR',
      'Payment method: Visa',
    ].join('\n'),
  });
  assert.equal(parsed, null);
});

test('holds Wix shared notification sender for review instead of grouping different shops together', () => {
  assert.equal(isSharedPlatformSenderDomain('my.store-emails.com'), true);
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['my.store-emails.com'],
    subject: 'Your order is confirmed',
    bodyText: [
      'Thanks for your order',
      'Order ID: WX-88821',
      'Order total: 39.00 EUR',
      'Payment method: Visa',
      'Shipping method: Standard',
    ].join('\n'),
  });
  assert.equal(parsed, null);
});

test('holds Squarespace default shared sender for review until merchant identity is independently known', () => {
  assert.equal(isSharedPlatformSenderDomain('squarespace.info'), true);
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['squarespace.info'],
    subject: 'Order confirmed',
    bodyText: [
      'Thanks for your order',
      'Order number: SQ-00081',
      'Order total: 62.00 GBP',
      'Payment method: Visa',
      'Shipping method: Standard',
    ].join('\n'),
  });
  assert.equal(parsed, null);
});
