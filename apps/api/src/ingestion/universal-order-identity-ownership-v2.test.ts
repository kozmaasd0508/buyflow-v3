import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { composeUniversalCommerceV11 } from './universal-commerce-composition-v1-1.js';
import { evaluateUniversalCommerceOwnershipV1 } from './universal-commerce-ownership-gate-v1.js';

function email(input: {
  subject: string;
  html: string;
  from?: string;
  attachments?: NormalizedEmail['attachments'];
}): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'identity-v2-ownership-test',
    subject: input.subject,
    from: [{ email: input.from ?? 'billing@never-seen-shop.example', name: 'Never Seen Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-24T20:30:00.000Z',
    bodyHtml: input.html,
    folders: ['inbound'],
    attachments: input.attachments ?? [],
  };
}

const invoicePdf = [{
  id: 'invoice-pdf',
  filename: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 42000,
  isInline: false,
}];

function invoiceOwnership(input: { subject: string; html: string }) {
  const document = buildEmailDocumentV1(email({ ...input, attachments: invoicePdf }));
  const invoice = composeUniversalCommerceV11(document).observations.find((item) => item.lifecycle === 'invoice');
  assert.ok(invoice);
  return evaluateUniversalCommerceOwnershipV1(document, invoice!);
}

test('identifier-before-order invoice can attach through universal identity v2', () => {
  const ownership = invoiceOwnership({
    subject: '#1000579244 számú rendeléshez tartozó számla',
    html: '<p>A csatolmányként találod a kiállított számlát.</p>',
  });
  assert.equal(ownership.purchaseAuthority, 'attach');
  assert.equal(ownership.canAttachToPurchase, true);
  assert.equal(ownership.canCreatePurchase, false);
});

test('numeric order id before inflected Hungarian order noun can attach', () => {
  const ownership = invoiceOwnership({
    subject: 'Számla a 90458062 számú megrendeléshez',
    html: '<p>A mellékletben küldjük a kiállított számlát.</p>',
  });
  assert.equal(ownership.purchaseAuthority, 'attach');
});

test('order noun before hash identity can attach', () => {
  const ownership = invoiceOwnership({
    subject: 'Rendelésed #63937 számlája',
    html: '<p>A számlát csatolmányként küldjük.</p>',
  });
  assert.equal(ownership.purchaseAuthority, 'attach');
});

test('service invoice number alone never becomes a hard Purchase anchor', () => {
  const ownership = invoiceOwnership({
    subject: 'Számlád elkészült',
    html: '<p>Számlaszám: 8021932478</p><p>Az elkészült számlát csatolmányként küldjük.</p>',
  });
  assert.equal(ownership.purchaseAuthority, 'review');
  assert.equal(ownership.canAttachToPurchase, false);
  assert.equal(ownership.canCreatePurchase, false);
});

test('account and payment identifiers alone never become a hard Purchase anchor', () => {
  const ownership = invoiceOwnership({
    subject: 'Elektronikus számla érkezett',
    html: '<p>Ügyfélazonosító: 690000194345</p><p>Tranzakció azonosító: 1234567890</p><p>A számlát csatolmányként küldjük.</p>',
  });
  assert.equal(ownership.purchaseAuthority, 'review');
  assert.equal(ownership.canAttachToPurchase, false);
});
