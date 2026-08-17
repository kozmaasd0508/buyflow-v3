import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import {
  emitGenericCommerceShadowEmailObservation,
  observeGenericCommerceShadowEmail,
} from './generic-commerce-shadow.js';

const ORDER_ID = 'DEMO-2026-8871';
const RAW_DOMAIN = 'orders.unknown-demo-store.eu';

function unknownMerchantEmail(): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'private-message-id-must-not-leak',
    subject: 'Order confirmation',
    from: [{ email: `receipts@${RAW_DOMAIN}`, name: 'Unknown Demo Store' }],
    to: [{ email: 'private-customer@example.test' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-17T10:00:00.000Z',
    folders: ['INBOX'],
    headers: [],
    bodyHtml: [
      '<p>Thanks for your order</p>',
      `<p>Order ID: ${ORDER_ID}</p>`,
      '<p>Order summary</p>',
      '<p>Private Desk Lamp | Qty 1 | 39.90 EUR</p>',
      '<p>Order total: 44.90 EUR</p>',
      '<p>Payment method: Visa</p>',
      '<p>Shipping method: Standard delivery</p>',
    ].join(''),
    attachments: [],
  };
}

test('true generic fall-through becomes read-only review diagnostic', () => {
  const row = observeGenericCommerceShadowEmail(unknownMerchantEmail());
  assert.ok(row);
  assert.equal(row.mode, 'generic-commerce-shadow');
  assert.equal(row.would_write, false);
  assert.equal(row.validation_status, 'review');
  assert.equal(row.eligible_for_purchase_creation, false);
  assert.equal(row.parser_version, 'generic-order-confirmation-v1.4');
  assert.equal(row.event_type, 'order_created');
  assert.equal(row.evidence_present.order_number, true);
  assert.equal(row.evidence_present.total, true);
  assert.equal(row.evidence_present.payment_method, true);
  assert.equal(row.evidence_present.shipping_method, true);
  assert.ok(row.evidence_present.product_rows >= 1);
  assert.match(row.sender_domain_fingerprint, /^[a-f0-9]{24}$/);
});

test('generic shadow log contains no raw purchase or identity values', () => {
  const captured: Array<{ label: string; payload: string }> = [];
  const row = emitGenericCommerceShadowEmailObservation(
    unknownMerchantEmail(),
    (label, payload) => captured.push({ label, payload }),
  );

  assert.ok(row);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.label, '[generic-commerce-shadow]');

  const payload = captured[0]?.payload ?? '';
  assert.match(payload, /"would_write":false/);
  assert.match(payload, /"validation_status":"review"/);
  assert.doesNotMatch(payload, new RegExp(ORDER_ID));
  assert.doesNotMatch(payload, new RegExp(RAW_DOMAIN.replace(/\./g, '\\.')));
  assert.doesNotMatch(payload, /receipts@/);
  assert.doesNotMatch(payload, /private-customer@example\.test/);
  assert.doesNotMatch(payload, /private-message-id-must-not-leak/);
  assert.doesNotMatch(payload, /Order confirmation/);
  assert.doesNotMatch(payload, /Private Desk Lamp/);
  assert.doesNotMatch(payload, /Unknown Demo Store/);
});

test('carrier mail is not an unknown-merchant generic candidate', () => {
  const email: NormalizedEmail = {
    ...unknownMerchantEmail(),
    providerMessageId: 'carrier-message',
    from: [{ email: 'updates@dhl.com', name: 'DHL' }],
  };
  assert.equal(observeGenericCommerceShadowEmail(email), null);
});
