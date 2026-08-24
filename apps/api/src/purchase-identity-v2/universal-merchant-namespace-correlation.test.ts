import assert from 'node:assert/strict';
import test from 'node:test';
import { PurchaseIdentityGraph } from './graph.js';
import { deriveMerchantSenderNamespace } from './merchant-sender-namespace.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';

const EMPTY: PurchaseIdentitySnapshot = {
  purchases: [],
  orders: [],
  shipments: [],
  payments: [],
  invoices: [],
};

function commerceEvent(input: {
  id: string;
  type: CanonicalEvent['eventType'];
  senderDomain: string;
  orderId: string;
  sourceRole?: CanonicalEvent['sourceRole'];
  invoiceId?: string | null;
}): CanonicalEvent {
  const event: CanonicalEvent = {
    eventId: input.id,
    userId: 'user-1',
    eventType: input.type,
    sourceProvider: 'gmail',
    sourceMessageId: input.id,
    senderDomain: input.senderDomain,
    receivedAt: '2026-08-24T20:00:00.000Z',
    occurredAt: null,
    merchantRaw: 'Never Seen Shop',
    merchantId: null,
    orderIdRaw: input.orderId,
    orderIdNormalized: input.orderId.toLowerCase(),
    trackingIdRaw: null,
    trackingIdNormalized: null,
    invoiceIdRaw: input.invoiceId ?? null,
    invoiceIdNormalized: input.invoiceId?.toLowerCase() ?? null,
    paymentReference: null,
    amount: null,
    currency: null,
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: [],
    sourceRole: input.sourceRole ?? 'merchant',
    carrierId: null,
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
  };
  event.merchantNamespace = deriveMerchantSenderNamespace(event);
  return event;
}

test('unknown merchant order creates Purchase inside exact safe sender namespace', () => {
  const graph = new PurchaseIdentityGraph(EMPTY);
  const created = graph.applyEvent(commerceEvent({
    id: 'order-a',
    type: 'order_created',
    senderDomain: 'orders.never-seen-shop.hu',
    orderId: 'AB-9918274',
  }));

  assert.equal(created.decision.kind, 'NEW_PURCHASE');
  assert.equal(created.snapshot.purchases.length, 1);
  assert.equal(created.snapshot.purchases[0]?.canonicalMerchantId, null);
  assert.equal(created.snapshot.orders[0]?.merchantNamespace, 'sender-domain:orders.never-seen-shop.hu');
});

test('same unknown merchant plus same order id links invoice to the existing Purchase', () => {
  const graph = new PurchaseIdentityGraph(EMPTY);
  const created = graph.applyEvent(commerceEvent({
    id: 'order-a',
    type: 'order_created',
    senderDomain: 'orders.never-seen-shop.hu',
    orderId: 'AB-9918274',
  }));
  assert.equal(created.decision.kind, 'NEW_PURCHASE');

  const invoice = graph.applyEvent(commerceEvent({
    id: 'invoice-a',
    type: 'invoice_created',
    senderDomain: 'orders.never-seen-shop.hu',
    orderId: 'AB-9918274',
    invoiceId: 'INV-2026-77',
  }));

  assert.equal(invoice.decision.kind, 'LINKED');
  if (invoice.decision.kind === 'LINKED') {
    assert.equal(invoice.decision.purchaseId, created.snapshot.purchases[0]?.purchaseId);
  }
  assert.equal(invoice.snapshot.invoices.length, 1);
});

test('same order number at two different unknown shops remains two Purchases', () => {
  const graph = new PurchaseIdentityGraph(EMPTY);
  const first = graph.applyEvent(commerceEvent({
    id: 'shop-a-order',
    type: 'order_created',
    senderDomain: 'orders.shop-a.hu',
    orderId: '12345',
  }));
  const second = graph.applyEvent(commerceEvent({
    id: 'shop-b-order',
    type: 'order_created',
    senderDomain: 'orders.shop-b.hu',
    orderId: '12345',
  }));

  assert.equal(first.decision.kind, 'NEW_PURCHASE');
  assert.equal(second.decision.kind, 'NEW_PURCHASE');
  assert.equal(second.snapshot.purchases.length, 2);

  const invoiceA = graph.applyEvent(commerceEvent({
    id: 'shop-a-invoice',
    type: 'invoice_created',
    senderDomain: 'orders.shop-a.hu',
    orderId: '12345',
    invoiceId: 'A-INV-1',
  }));
  assert.equal(invoiceA.decision.kind, 'LINKED');
  if (invoiceA.decision.kind === 'LINKED') {
    assert.equal(invoiceA.decision.purchaseId, first.snapshot.purchases[0]?.purchaseId);
  }
});

test('different merchant namespace with same order id cannot attach lifecycle to another shop', () => {
  const graph = new PurchaseIdentityGraph(EMPTY);
  graph.applyEvent(commerceEvent({
    id: 'order-a',
    type: 'order_created',
    senderDomain: 'orders.shop-a.hu',
    orderId: '99881',
  }));

  const wrongShopInvoice = graph.applyEvent(commerceEvent({
    id: 'invoice-b',
    type: 'invoice_created',
    senderDomain: 'orders.shop-b.hu',
    orderId: '99881',
    invoiceId: 'B-1',
  }));

  assert.equal(wrongShopInvoice.decision.kind, 'REVIEW');
  assert.equal(wrongShopInvoice.mutated, false);
  assert.equal(wrongShopInvoice.snapshot.invoices.length, 0);
});

test('provider, public mailbox, shared platform and carrier domains never become merchant namespaces', () => {
  assert.equal(deriveMerchantSenderNamespace({ sourceRole: 'invoice_issuer', senderDomain: 'billing-provider.example' }), null);
  assert.equal(deriveMerchantSenderNamespace({ sourceRole: 'merchant', senderDomain: 'gmail.com' }), null);
  assert.equal(deriveMerchantSenderNamespace({ sourceRole: 'merchant', senderDomain: 'shopifyemail.com' }), null);
  assert.equal(deriveMerchantSenderNamespace({ sourceRole: 'merchant', senderDomain: 'gls-hungary.com' }), null);
  assert.equal(deriveMerchantSenderNamespace({ sourceRole: 'merchant', senderDomain: 'orders.real-shop.hu' }), 'sender-domain:orders.real-shop.hu');
});

test('invoice provider with matching order number stays REVIEW without merchant namespace', () => {
  const graph = new PurchaseIdentityGraph(EMPTY);
  graph.applyEvent(commerceEvent({
    id: 'order-a',
    type: 'order_created',
    senderDomain: 'orders.shop-a.hu',
    orderId: '556677',
  }));

  const providerInvoice = graph.applyEvent(commerceEvent({
    id: 'provider-invoice',
    type: 'invoice_created',
    senderDomain: 'billing-provider.example',
    orderId: '556677',
    invoiceId: 'INV-556677',
    sourceRole: 'invoice_issuer',
  }));

  assert.equal(providerInvoice.decision.kind, 'REVIEW');
  assert.equal(providerInvoice.mutated, false);
});
