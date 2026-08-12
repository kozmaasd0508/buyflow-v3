import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEmailExtraction } from './email-extraction-validator.js';

const base = {
  event_type: 'shipment' as const,
  merchant: null,
  order_number: null,
  tracking_number: null,
  carrier: null,
  invoice_number: null,
  total: null,
  currency: null,
  confidence: 0.95,
};

test('carrier sender cannot create a purchase and order id is blocked', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'order_created',
      merchant: 'Express One Hungary Kft.',
      order_number: '769927',
      carrier: 'Express One',
      confidence: 0.86,
    },
    senderDomains: ['expressone.hu'],
    subject: 'Expressone értesítés #769927',
  });

  assert.equal(result.event_type, 'shipment');
  assert.equal(result.original_event_type, 'order_created');
  assert.equal(result.merchant, null);
  assert.equal(result.order_number, null);
  assert.equal(result.eligible_for_purchase_creation, false);
  assert.equal(result.validation_status, 'guardrailed');
});

test('carrier sender purchase amount is always blocked', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'delivery',
      tracking_number: '650925031807000013605231',
      carrier: 'Express One',
      total: 9.56,
      currency: 'HUF',
      confidence: 0.86,
    },
    senderDomains: ['mail.expressone.hu'],
    subject: 'Csomag kézbesítés ma – ETA és módosítás',
    bodyText: 'A futár várhatóan 9:56 körül érkezik.',
  });

  assert.equal(result.event_type, 'delivery');
  assert.equal(result.total, null);
  assert.equal(result.currency, null);
  assert.equal(result.tracking_number, '650925031807000013605231');
  assert.ok(result.blocked_fields.includes('total'));
});

test('strong merchant order can be eligible for purchase creation', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'order_created',
      merchant: 'Example Shop',
      order_number: 'ORD-123',
      total: 49.99,
      currency: 'EUR',
      confidence: 0.96,
    },
    senderDomains: ['example-shop.eu'],
    subject: 'Order ORD-123 confirmed',
    bodyText: 'Total: 49.99 EUR. Thank you for your order.',
  });

  assert.equal(result.event_type, 'order_created');
  assert.equal(result.total, 49.99);
  assert.equal(result.currency, 'EUR');
  assert.equal(result.eligible_for_purchase_creation, true);
  assert.equal(result.validation_status, 'validated');
});

test('amount without currency is blocked', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'invoice_or_receipt',
      merchant: 'Example',
      total: 25.4,
      currency: null,
    },
    senderDomains: ['stripe.com'],
    bodyText: 'Amount paid 25.40',
  });

  assert.equal(result.total, null);
  assert.equal(result.validation_status, 'guardrailed');
});

test('receipt amount with explicit currency and money context is retained', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'invoice_or_receipt',
      merchant: 'Replit',
      total: 25.4,
      currency: 'USD',
      confidence: 0.97,
    },
    senderDomains: ['stripe.com'],
    bodyText: 'Total paid: $25.40 USD',
  });

  assert.equal(result.total, 25.4);
  assert.equal(result.currency, 'USD');
  assert.equal(result.validation_status, 'validated');
});
