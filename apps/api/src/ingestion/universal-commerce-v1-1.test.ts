import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { composeUniversalCommerceV11 } from './universal-commerce-composition-v1-1.js';
import { evaluateUniversalCommerceOwnershipV1 } from './universal-commerce-ownership-gate-v1.js';
import { evaluateUniversalCommerceSemanticsV11 } from './universal-commerce-semantics-v1-1.js';

function email(input: {
  subject: string;
  html: string;
  from?: string;
  attachments?: NormalizedEmail['attachments'];
}): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'universal-v11-test',
    subject: input.subject,
    from: [{ email: input.from ?? 'orders@never-seen-shop.example', name: 'Never Seen Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-24T20:05:00.000Z',
    bodyHtml: input.html,
    folders: ['inbound'],
    attachments: input.attachments ?? [],
  };
}

const invoicePdf = [{
  id: 'invoice-pdf',
  filename: 'invoice-unknown.pdf',
  contentType: 'application/pdf',
  size: 42000,
  isInline: false,
}];

test('e-invoice arrived is normalized to RECEIVE without merchant knowledge', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'E-számla érkezett',
    html: '<p>Új elektronikus számlája érkezett.</p><p>Fizetendő: 12 990 Ft</p>',
  }));
  const semantics = evaluateUniversalCommerceSemanticsV11(document);
  assert.ok(semantics.objects.includes('INVOICE'));
  assert.ok(semantics.actions.includes('RECEIVE'));

  const composition = composeUniversalCommerceV11(document, semantics);
  assert.ok(composition.observations.some((item) => item.lifecycle === 'invoice' && item.decision === 'actionable'));
});

test('attachment-container and issued variants compose a PDF invoice generically', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Rendelés #AB7821 számlája',
    html: '<p>A csatolmányként található, kiállított számlát mellékeltük.</p><p>Rendelés #AB7821</p>',
    attachments: invoicePdf,
  }));
  const semantics = evaluateUniversalCommerceSemanticsV11(document);
  assert.ok(semantics.actions.includes('ATTACH'));
  assert.ok(semantics.actions.includes('ISSUE'));
  const composition = composeUniversalCommerceV11(document, semantics);
  assert.ok(composition.observations.some((item) => item.lifecycle === 'invoice' && item.decision === 'actionable'));
});

test('invoice portal download can compose without attached PDF', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Számla | invoice',
    html: '<p>Az elektronikus számla letölthető és megtekinthető.</p><a href="https://docs.example/eSzamla/download/token">Letöltés</a>',
  }));
  const semantics = evaluateUniversalCommerceSemanticsV11(document);
  assert.ok(semantics.actions.includes('MAKE_AVAILABLE'));
  assert.ok(semantics.technicalEvidence.includes('url_invoice_document'));
  const composition = composeUniversalCommerceV11(document, semantics);
  assert.ok(composition.observations.some((item) => item.lifecycle === 'invoice' && item.decision === 'actionable'));
});

test('one email can emit invoice and shipped observations independently', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Rendelés #AB7821 frissítés',
    html: '<p>Új elektronikus számlád érkezett, a számlát a mellékletben találod.</p><p>Rendelés #AB7821 csomagját átadtuk a futárnak.</p>',
    attachments: invoicePdf,
  }));
  const composition = composeUniversalCommerceV11(document);
  const lifecycles = composition.observations.map((item) => item.lifecycle);
  assert.ok(lifecycles.includes('invoice'));
  assert.ok(lifecycles.includes('shipped'));
});

test('real service invoice can be semantically valid but has no Purchase authority', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Számlád elkészült',
    html: '<p>Az elkészült számlát megtekintheted. Fizetendő: 8 990 Ft.</p>',
    attachments: invoicePdf,
  }));
  const composition = composeUniversalCommerceV11(document);
  const invoice = composition.observations.find((item) => item.lifecycle === 'invoice');
  assert.ok(invoice);
  assert.equal(invoice?.decision, 'actionable');

  const ownership = evaluateUniversalCommerceOwnershipV1(document, invoice!);
  assert.equal(ownership.purchaseAuthority, 'review');
  assert.equal(ownership.canCreatePurchase, false);
  assert.equal(ownership.canAttachToPurchase, false);
});

test('invoice with hard order identity may attach but never create Purchase', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Rendelés #AB7821 számlája',
    html: '<p>Rendelés #AB7821 számláját csatolmányként küldjük.</p>',
    attachments: invoicePdf,
  }));
  const invoice = composeUniversalCommerceV11(document).observations.find((item) => item.lifecycle === 'invoice');
  assert.ok(invoice);
  const ownership = evaluateUniversalCommerceOwnershipV1(document, invoice!);
  assert.equal(ownership.purchaseAuthority, 'attach');
  assert.equal(ownership.canCreatePurchase, false);
  assert.equal(ownership.canAttachToPurchase, true);
});

test('unknown merchant order confirmation can create Purchase with hard identity and independent structure', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Megrendelés visszaigazolása #AB7821',
    html: '<div class="order-summary"><p>Megrendelés visszaigazolása #AB7821</p><p>1 x Teszt termék</p><p>Végösszeg: 12 990 Ft</p><p>Fizetési mód: bankkártya</p><p>Szállítási mód: futár</p></div>',
  }));
  const created = composeUniversalCommerceV11(document).observations.find((item) => item.lifecycle === 'order_created');
  assert.ok(created);
  const ownership = evaluateUniversalCommerceOwnershipV1(document, created!);
  assert.equal(ownership.purchaseAuthority, 'create');
});

test('public mailbox sender cannot auto-create a Purchase even with order-looking content', () => {
  const document = buildEmailDocumentV1(email({
    from: 'seller@gmail.com',
    subject: 'Megrendelés visszaigazolása #AB7821',
    html: '<div class="order-summary"><p>Megrendelés visszaigazolása #AB7821</p><p>1 x Teszt termék</p><p>Végösszeg: 12 990 Ft</p><p>Fizetési mód: bankkártya</p><p>Szállítási mód: futár</p></div>',
  }));
  const created = composeUniversalCommerceV11(document).observations.find((item) => item.lifecycle === 'order_created');
  assert.ok(created);
  const ownership = evaluateUniversalCommerceOwnershipV1(document, created!);
  assert.equal(ownership.purchaseAuthority, 'review');
  assert.equal(ownership.canCreatePurchase, false);
});

test('future handoff remains processing and cannot become shipped', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Rendelés #AB7821 feldolgozás alatt',
    html: '<p>Rendelés #AB7821 összekészítés alatt, hamarosan átadjuk a futárnak.</p>',
  }));
  const lifecycles = composeUniversalCommerceV11(document).observations.map((item) => item.lifecycle);
  assert.ok(lifecycles.includes('order_processing'));
  assert.equal(lifecycles.includes('shipped'), false);
});

test('proforma with PDF remains review and never becomes final invoice', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Proforma számla',
    html: '<p>A mellékletben találod a proforma számlát / díjbekérőt.</p>',
    attachments: invoicePdf,
  }));
  const composition = composeUniversalCommerceV11(document);
  assert.equal(composition.observations.some((item) => item.lifecycle === 'invoice' && item.decision === 'actionable'), false);
  assert.ok(composition.observations.some((item) => item.lifecycle === 'unknown' && item.decision === 'review'));
});

test('v1.1 observations and ownership do not expose raw order identity', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Megrendelés visszaigazolása #SECRET7821',
    html: '<div class="order-summary"><p>Megrendelés visszaigazolása #SECRET7821</p><p>1 x Termék</p><p>Végösszeg: 12 990 Ft</p><p>Fizetési mód: kártya</p></div>',
  }));
  const composition = composeUniversalCommerceV11(document);
  const created = composition.observations.find((item) => item.lifecycle === 'order_created');
  assert.ok(created);
  const ownership = evaluateUniversalCommerceOwnershipV1(document, created!);
  assert.equal(JSON.stringify({ composition, ownership }).includes('SECRET7821'), false);
});
