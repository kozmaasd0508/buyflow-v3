import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericHuTransactionAnchor } from './generic-hu-transaction-anchor.js';

test('parses strict merchant shipment subject without creating an order-created event', () => {
  const parsed = parseGenericHuTransactionAnchor({
    senderDomains: ['allinpackaging.com'],
    subject: 'All In Packaging: #148810 Rendelés elküldve.',
  });
  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'shipment');
  assert.equal(parsed.extraction.merchant, 'All In Packaging');
  assert.equal(parsed.extraction.order_number, '148810');
  assert.equal(parsed.extraction.tracking_number, null);
  assert.equal(parsed.shipmentPhase, 'shipped');
});

test('parses strict invoice subject as an invoice anchor for the same order identity', () => {
  const parsed = parseGenericHuTransactionAnchor({
    senderDomains: ['allinpackaging.com'],
    subject: 'SZÁMLA All In Packaging (148810) számú webrendeléshez',
  });
  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'invoice_or_receipt');
  assert.equal(parsed.extraction.merchant, 'All In Packaging');
  assert.equal(parsed.extraction.order_number, '148810');
  assert.equal(parsed.extraction.invoice_number, null);
});

test('rejects public mailbox senders', () => {
  assert.equal(parseGenericHuTransactionAnchor({
    senderDomains: ['gmail.com'],
    subject: 'Example Shop: #123456 Rendelés elküldve.',
  }), null);
});

test('rejects shared platform senders', () => {
  assert.equal(parseGenericHuTransactionAnchor({
    senderDomains: ['shopifyemail.com'],
    subject: 'Example Shop: #123456 Rendelés elküldve.',
  }), null);
});

test('rejects merchant labels that do not match the sender brand domain', () => {
  assert.equal(parseGenericHuTransactionAnchor({
    senderDomains: ['shared-notify.example'],
    subject: 'Example Shop: #123456 Rendelés elküldve.',
  }), null);
});

test('rejects merely processing or packing subjects', () => {
  assert.equal(parseGenericHuTransactionAnchor({
    senderDomains: ['exampleshop.hu'],
    subject: 'Example Shop: #123456 Rendelés feldolgozás alatt.',
  }), null);
});

test('rejects short receipt-like identities', () => {
  assert.equal(parseGenericHuTransactionAnchor({
    senderDomains: ['exampleshop.hu'],
    subject: 'Example Shop: #6383 Rendelés elküldve.',
  }), null);
});
