import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { evaluatePurchaseCreationAuthority } from '../purchase-identity-v2/purchase-creation-authority.js';

function makeEmail(bodyHtml: string): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'opaque-hu-order-structure-test',
    subject: 'Köszönjük a vásárlást',
    from: [{ email: 'orders@example-shop.hu', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.test' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-26T00:00:00.000Z',
    bodyHtml,
    folders: ['CATEGORY_PURCHASES'],
    attachments: [],
  };
}

test('Hungarian rendelés részletei is a generic order-summary structure signal', () => {
  const document = buildEmailDocumentV1(makeEmail(`
    <p>Köszönjük, hogy nálunk vásárolt.</p>
    <p>AB-845721 számú megrendelését fogadtuk.</p>
    <h2>Rendelés részletei</h2>
    <p>Végösszeg: 12 990 Ft</p>
  `));

  assert.equal(document.sections.some((section) => section.type === 'order_summary'), true);
  assert.ok(document.signals.amounts.length > 0);

  const authority = evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB845721',
  });

  assert.equal(authority.authority, 'authorized');
});

test('Hungarian vásárlás részletei is generic order-summary signal', () => {
  const document = buildEmailDocumentV1(makeEmail(`
    <p>AB-845722 számú megrendelését fogadtuk.</p>
    <p>Az alábbiakban megtekintheti Vásárlás részleteit.</p>
    <p>Összesen: 8 490 Ft</p>
  `));

  assert.equal(document.sections.some((section) => section.type === 'order_summary'), true);
});

test('order-detail structure alone still cannot authorize without hard order identity', () => {
  const document = buildEmailDocumentV1(makeEmail(`
    <p>Rendelés részletei</p>
    <p>Összesen: 8 490 Ft</p>
  `));

  const authority = evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: null,
  });

  assert.equal(authority.authority, 'review');
  assert.deepEqual(authority.reasons, ['missing_hard_order_identity']);
});
