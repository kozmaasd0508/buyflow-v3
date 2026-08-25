import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { universalEventTypeExtractor } from '../extraction-v2/event-type-extractor.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { PurchaseIdentityGraph } from './graph.js';
import { deriveMerchantSenderNamespace } from './merchant-sender-namespace.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';

function doc(subject: string, text: string) {
  const email: NormalizedEmail = {
    provider: 'gmail',
    providerMessageId: `m-${subject}`,
    subject,
    from: [{ email: 'orders@unknown-shop.example', name: 'Unknown Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-25T18:00:00.000Z',
    snippet: text,
    folders: [],
    attachments: [],
  };
  return buildEmailDocumentV1(email);
}

function eventTypes(subject: string, text: string): string[] {
  return universalEventTypeExtractor.extract(doc(subject, text)).map((claim) => String(claim.value));
}

test('generic successful order-recorded wording resolves order creation', () => {
  const values = eventTypes(
    'Rendelés 57119',
    'Megrendelésedet sikeresen felvettük! Rendelésszám: 57119. Köszönjük a vásárlást.',
  );
  assert.ok(values.includes('order_created'));
});

test('generic completed courier-service handoff resolves shipment', () => {
  const values = eventTypes(
    'Rendelés állapota megváltozott',
    'Rendelésszám: 15191. A megrendelés frissítésre került, jelenlegi állapot: Futárszolgálatnak átadva.',
  );
  assert.ok(values.includes('shipment'));
});

test('future courier handoff remains non-shipment', () => {
  const values = eventTypes(
    'Rendelés feldolgozás alatt',
    'Rendelésszám: 15191. A megrendelést csomagoljuk, hamarosan átadjuk a futárszolgálatnak.',
  );
  assert.equal(values.includes('shipment'), false);
});

test('generic cancelled order status resolves cancellation', () => {
  const values = eventTypes(
    'Rendelés állapota megváltozott',
    'A rendelésed frissítésre került, jelenlegi állapota: Törölve. Rendelésszám: 57119.',
  );
  assert.ok(values.includes('cancellation'));
});

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
  creationAuthority?: CanonicalEvent['purchaseCreationAuthority'];
}): CanonicalEvent {
  const event: CanonicalEvent = {
    eventId: input.id,
    userId: 'user-1',
    eventType: input.type,
    sourceProvider: 'gmail',
    sourceMessageId: input.id,
    senderDomain: input.senderDomain,
    receivedAt: '2026-08-25T18:00:00.000Z',
    occurredAt: null,
    merchantRaw: 'Unknown Shop',
    merchantId: null,
    purchaseCreationAuthority: input.creationAuthority ?? 'none',
    orderIdRaw: input.orderId,
    orderIdNormalized: input.orderId,
    trackingIdRaw: null,
    trackingIdNormalized: null,
    invoiceIdRaw: null,
    invoiceIdNormalized: null,
    paymentReference: null,
    amount: null,
    currency: null,
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: [],
    sourceRole: 'merchant',
    conflicts: [],
  };
  event.merchantNamespace = deriveMerchantSenderNamespace(event);
  return event;
}

test('merchant-prefixed order id becomes REVIEW candidate, never automatic link', () => {
  const graph = new PurchaseIdentityGraph(EMPTY);
  const created = graph.applyEvent(commerceEvent({
    id: 'order',
    type: 'order_created',
    senderDomain: 'orders.unknown-shop.example',
    orderId: '9160-675123',
    creationAuthority: 'authorized',
  }));
  assert.equal(created.decision.kind, 'NEW_PURCHASE');

  const later = graph.applyEvent(commerceEvent({
    id: 'processing',
    type: 'order_updated',
    senderDomain: 'orders.unknown-shop.example',
    orderId: 'KB9160-675123',
  }));
  assert.equal(later.decision.kind, 'REVIEW');
  assert.equal(later.mutated, false);
});

test('decorated id discovery never crosses merchant sender namespaces', () => {
  const graph = new PurchaseIdentityGraph(EMPTY);
  graph.applyEvent(commerceEvent({
    id: 'order',
    type: 'order_created',
    senderDomain: 'orders.shop-a.example',
    orderId: '9160-675123',
    creationAuthority: 'authorized',
  }));

  const wrongShop = graph.applyEvent(commerceEvent({
    id: 'later',
    type: 'order_updated',
    senderDomain: 'orders.shop-b.example',
    orderId: 'KB9160-675123',
  }));
  assert.equal(wrongShop.decision.kind, 'UNLINKED');
  assert.equal(wrongShop.mutated, false);
});
