import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicCommerceEmail } from './deterministic-commerce-parser.js';
import { parseGenericOrderConfirmationEmail } from './generic-order-confirmation-adapter.js';

test('Spanish order id is found in body even when subject contains pedido without an id', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['pedidos.casa-roja.es'],
    subject: 'Confirmacion de pedido',
    bodyText: [
      'Gracias por tu pedido',
      'Numero de pedido: ES-50005',
      'Total del pedido: 63,90 EUR',
      'Metodo de pago: Mastercard',
      'Metodo de envio: Standard',
    ].join('\n'),
  });
  assert.ok(parsed);
  assert.equal(parsed.extraction.order_number, 'ES-50005');
  assert.equal(parsed.extraction.event_type, 'order_created');
});

test('carrier lookalike domain cannot enter deterministic carrier parsing', () => {
  const parsed = parseDeterministicCommerceEmail({
    senderDomains: ['gls-security.example'],
    subject: 'Csomagod úton van',
    bodyText: 'Tracking number: DEMOGLS123456789. Kattints ide a cím megerősítéséhez.',
  });
  assert.equal(parsed, null);
});
