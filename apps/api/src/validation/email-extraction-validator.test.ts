import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEmailExtraction } from './email-extraction-validator.js';

const base = {
  event_type: 'shipment' as const,
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
  tracking_number: null,
  carrier: null,
  parcel_sender: null,
  cod_amount: null,
  cod_currency: null,
  invoice_number: null,
  products: [],
  confidence: 0.95,
};

test('carrier sender cannot create a purchase and purchase fields are blocked', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'order_created',
      merchant: 'Express One Hungary Kft.',
      merchant_legal_name: 'Express One Hungary Kft.',
      order_number: '769927',
      carrier: 'Express One',
      total: 9990,
      currency: 'HUF',
      payment_status: 'paid',
      products: [{
        name: 'Fake product',
        brand: null,
        model: null,
        variant: null,
        sku: null,
        gtin: null,
        category: null,
        quantity: 1,
        unit_price: 9990,
        total_price: 9990,
        currency: 'HUF',
        product_url: null,
        image_url: null,
        confidence: 0.9,
      }],
      confidence: 0.86,
    },
    senderDomains: ['expressone.hu'],
    subject: 'Expressone értesítés #769927',
  });

  assert.equal(result.event_type, 'shipment');
  assert.equal(result.original_event_type, 'order_created');
  assert.equal(result.merchant, null);
  assert.equal(result.merchant_legal_name, null);
  assert.equal(result.order_number, null);
  assert.equal(result.total, null);
  assert.equal(result.payment_status, null);
  assert.deepEqual(result.products, []);
  assert.equal(result.eligible_for_purchase_creation, false);
  assert.equal(result.validation_status, 'guardrailed');
  assert.equal(result.schema_version, 2);
});

test('carrier sender keeps explicit parcel sender, tracking and zero COD evidence', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'delivery',
      tracking_number: '3412842135',
      carrier: 'GLS',
      parcel_sender: 'Gyerekjatekbolt.com játék webáruház Faközpont Kft.',
      cod_amount: 0,
      cod_currency: null,
      confidence: 0.98,
    },
    senderDomains: ['gls-hungary.com'],
    subject: 'GLS mai kézbesítés',
    bodyText: 'Feladó: Gyerekjatekbolt.com játék webáruház Faközpont Kft. Utánvét összeg: 0',
  });

  assert.equal(result.event_type, 'delivery');
  assert.equal(result.parcel_sender, 'Gyerekjatekbolt.com játék webáruház Faközpont Kft.');
  assert.equal(result.cod_amount, 0);
  assert.equal(result.tracking_number, '3412842135');
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

test('strong merchant order can be eligible and keep purchased products', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'order_created',
      merchant: 'Example Shop',
      order_number: 'ORD-123',
      total: 49.99,
      currency: 'EUR',
      products: [{
        name: 'Example Product',
        brand: null,
        model: null,
        variant: null,
        sku: 'SKU-1',
        gtin: null,
        category: null,
        quantity: 1,
        unit_price: 49.99,
        total_price: 49.99,
        currency: 'EUR',
        product_url: null,
        image_url: null,
        confidence: 0.98,
      }],
      confidence: 0.96,
    },
    senderDomains: ['example-shop.eu'],
    subject: 'Order ORD-123 confirmed',
    bodyText: 'Total: 49.99 EUR. Example Product SKU-1. Thank you for your order.',
  });

  assert.equal(result.event_type, 'order_created');
  assert.equal(result.total, 49.99);
  assert.equal(result.currency, 'EUR');
  assert.equal(result.products.length, 1);
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

test('payment completed requires explicit paid status before automatic trust', () => {
  const result = validateEmailExtraction({
    extraction: {
      ...base,
      event_type: 'payment_completed',
      merchant: 'Example Shop',
      order_number: 'ORD-1',
      paid_amount: 100,
      paid_currency: 'HUF',
      payment_status: null,
    },
    senderDomains: ['example-shop.hu'],
    bodyText: 'A rendelés összege 100 HUF.',
  });

  assert.equal(result.validation_status, 'review');
  assert.ok(result.reasons.includes('payment_completed_without_explicit_paid_status'));
});
