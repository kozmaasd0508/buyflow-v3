import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { composeUniversalCommerceEventV1 } from './universal-commerce-composition-v1.js';

function email(input: {
  subject: string;
  html: string;
  attachments?: NormalizedEmail['attachments'];
}): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'composition-test-1',
    subject: input.subject,
    from: [{ email: 'orders@unseen-shop.example', name: 'Unseen Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-24T19:55:00.000Z',
    bodyHtml: input.html,
    folders: ['inbound'],
    attachments: input.attachments ?? [],
  };
}

const pdf = [{
  id: 'att-1',
  filename: 'document.pdf',
  contentType: 'application/pdf',
  size: 12345,
  isInline: false,
}];

test('unknown merchant Hungarian invoice + attached PDF composes to invoice event', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Számla az e-mailben',
    html: '<p>A mellékelt PDF fájlban küldjük a számlát. Kérjük, őrizze meg.</p>',
    attachments: pdf,
  })));

  assert.equal(result.lifecycle, 'invoice');
  assert.equal(result.eventType, 'invoice_or_receipt');
  assert.equal(result.decision, 'actionable');
  assert.ok(result.evidence.includes('invoice_object'));
  assert.ok(result.evidence.includes('pdf_attachment'));
  assert.ok(result.evidence.includes('invoice_available_or_sent_language'));
});

test('unknown merchant English invoice + attached PDF maps to same canonical event', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Your invoice is attached',
    html: '<p>Please find your invoice attached as a PDF.</p>',
    attachments: pdf,
  })));

  assert.equal(result.lifecycle, 'invoice');
  assert.equal(result.decision, 'actionable');
});

test('invoice-looking technical HTML and PDF without visible invoice meaning cannot auto-promote', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Heti ajánlatok',
    html: '<style>.invoice-id{display:none}</style><p>Nézd meg új ajánlatainkat!</p>',
    attachments: pdf,
  })));

  assert.equal(result.lifecycle, 'unknown');
  assert.equal(result.decision, 'review');
});

test('proforma or payment request stays review even with PDF attachment', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Proforma számla',
    html: '<p>A mellékelt PDF-ben küldjük a proforma számlát / díjbekérőt.</p>',
    attachments: pdf,
  })));

  assert.equal(result.lifecycle, 'unknown');
  assert.equal(result.decision, 'review');
  assert.ok(result.negativeEvidence.includes('invoice_non_final_or_correction_language'));
});

test('future carrier handoff composes to processing, never shipped', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Rendelésed összekészítés alatt #A-7821',
    html: '<div class="order-summary shipping_method"><p>Rendelésedet összekészítjük, hamarosan átadjuk a futárnak.</p></div>',
  })));

  assert.equal(result.lifecycle, 'order_processing');
  assert.notEqual(result.lifecycle, 'shipped');
  assert.ok(result.negativeEvidence.includes('future_handoff'));
});

test('completed carrier handoff with generic order identity composes to shipped', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Megrendelés #A7821',
    html: '<div class="order-summary shipping_method"><p>Megrendelés #A7821 csomagját átadtuk a futárnak.</p></div>',
  })));

  assert.equal(result.lifecycle, 'shipped');
  assert.equal(result.eventType, 'shipment');
  assert.equal(result.decision, 'actionable');
});

test('payment failure is composed from meaning, not merchant identity', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Order #ZX9918 - payment failed',
    html: '<div data-order-id="ZX9918"><p>Your payment failed for order #ZX9918.</p></div>',
  })));

  assert.equal(result.lifecycle, 'payment_issue');
  assert.equal(result.eventType, 'order_updated');
  assert.equal(result.decision, 'actionable');
});

test('composition result never exposes raw identifiers', () => {
  const result = composeUniversalCommerceEventV1(buildEmailDocumentV1(email({
    subject: 'Order confirmation #SECRET9918',
    html: '<div data-order-id="SECRET9918" class="order-summary"><p>Your order is confirmed.</p><p>1 x Product</p><p>Total: 12 990 HUF</p></div>',
  })));

  assert.equal(JSON.stringify(result).includes('SECRET9918'), false);
});
