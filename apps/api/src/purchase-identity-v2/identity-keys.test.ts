import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invoiceIdentityKey,
  orderIdentityKey,
  paymentIdentityKey,
  shipmentIdentityKey,
} from './identity-keys.js';

test('order identity is scoped by canonical merchant', () => {
  assert.notEqual(
    orderIdentityKey('user-1', 'merchant-a', '12345'),
    orderIdentityKey('user-1', 'merchant-b', '12345'),
  );
  assert.equal(
    orderIdentityKey('user-1', 'MERCHANT-A', '12-345'),
    orderIdentityKey('user-1', 'merchant-a', '12345'),
  );
});

test('shipment identity is scoped by carrier', () => {
  assert.notEqual(
    shipmentIdentityKey('user-1', 'gls', 'AB-123'),
    shipmentIdentityKey('user-1', 'dpd', 'AB-123'),
  );
});

test('invoice identity is scoped by issuer', () => {
  assert.notEqual(
    invoiceIdentityKey('user-1', 'billingo', 'INV-42'),
    invoiceIdentityKey('user-1', 'szamlazzhu', 'INV-42'),
  );
});

test('payment identity is scoped by provider', () => {
  assert.notEqual(
    paymentIdentityKey('user-1', 'barion', 'PAY-555'),
    paymentIdentityKey('user-1', 'stripe', 'PAY-555'),
  );
});

test('identity keys are user scoped', () => {
  assert.notEqual(
    orderIdentityKey('user-1', 'merchant-a', 'ABC-123'),
    orderIdentityKey('user-2', 'merchant-a', 'ABC-123'),
  );
});

test('missing namespace never produces an exact identity key', () => {
  assert.equal(orderIdentityKey('user-1', null, 'ABC-123'), null);
  assert.equal(shipmentIdentityKey('user-1', null, 'GLS-77'), null);
  assert.equal(invoiceIdentityKey('user-1', null, 'INV-42'), null);
  assert.equal(paymentIdentityKey('user-1', null, 'PAY-555'), null);
});

test('missing stable identifier never produces an exact identity key', () => {
  assert.equal(orderIdentityKey('user-1', 'merchant-a', null), null);
  assert.equal(shipmentIdentityKey('user-1', 'gls', ''), null);
  assert.equal(invoiceIdentityKey('user-1', 'billingo', '---'), null);
  assert.equal(paymentIdentityKey('user-1', 'barion', undefined), null);
});
