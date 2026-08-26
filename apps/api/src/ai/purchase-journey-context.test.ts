import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';
import {
  buildPurchaseJourneyContext,
  buildStructuredEmailEvidence,
  summarizePurchaseJourneyContext,
  type PurchaseJourneyMemoryEvent,
} from './purchase-journey-context.js';

function document(
  bodyHtml: string,
  from = 'orders@example-shop.hu',
  subject = 'Csomag feladva #ORD-12345',
) {
  const email: NormalizedEmail = {
    provider: 'ses',
    providerMessageId: 'journey-context-test',
    subject,
    from: [{ email: from, name: 'Example Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-26T20:00:00.000Z',
    bodyHtml,
    folders: ['inbound'],
    attachments: [],
  };
  return buildEmailDocumentV1(email);
}

function snapshot(): PurchaseIdentitySnapshot {
  return {
    purchases: [
      { purchaseId: 'p1', userId: 'u1', canonicalMerchantId: null, primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p2', userId: 'u1', canonicalMerchantId: null, primaryOrderIdentityId: 'o2', state: 'open' },
    ],
    orders: [
      { orderIdentityId: 'o1', purchaseId: 'p1', merchantId: null, merchantNamespace: 'sender-domain:example-shop.hu', orderId: 'ORD-12345', relation: 'primary', parentOrderIdentityId: null },
      { orderIdentityId: 'o2', purchaseId: 'p2', merchantId: null, merchantNamespace: 'sender-domain:example-shop.hu', orderId: 'ORD-99999', relation: 'primary', parentOrderIdentityId: null },
    ],
    shipments: [
      { shipmentId: 's1', purchaseId: 'p1', carrierId: null, trackingId: 'TRACK-ABC-987', status: 'in_transit' },
    ],
    payments: [],
    invoices: [],
  };
}

function priorEvent(overrides: Partial<PurchaseJourneyMemoryEvent> = {}): PurchaseJourneyMemoryEvent {
  return {
    purchaseId: 'p1',
    eventType: 'shipment_created',
    receivedAt: '2026-08-26T19:00:00.000Z',
    sourceRole: 'merchant',
    merchantNamespace: 'sender-domain:example-shop.hu',
    orderId: 'ORD-12345',
    trackingId: 'TRACK-MEMORY-777',
    carrierId: null,
    invoiceId: null,
    paymentReference: null,
    amount: null,
    currency: null,
    ...overrides,
  };
}

test('structured evidence exposes parsed sections and hard signal candidates', () => {
  const doc = document('<p>Rendelés #ORD-12345</p><p>Végösszeg: 12 990 Ft</p><p>1x Teszt termék</p>');
  const value = JSON.parse(buildStructuredEmailEvidence(doc)) as any;
  assert.ok(value.signals.orderNumbers.includes('ORD-12345'));
  assert.ok(value.signals.amounts.some((item: any) => item.amount === 12990 && item.currency === 'HUF'));
  assert.ok(value.signals.products.some((item: any) => item.name === 'Teszt termék'));
});

test('exact tracking is ranked above same merchant namespace', () => {
  const doc = document('<p>Tracking number: TRACK-ABC-987</p>');
  const summary = summarizePurchaseJourneyContext(doc, snapshot());
  assert.equal(summary.candidates[0]?.purchaseId, 'p1');
  assert.ok(summary.candidates[0]?.matchReasons.includes('current_email_tracking_id_exact'));
});

test('same merchant namespace may provide read-only context but does not invent a hard match', () => {
  const doc = document(
    '<p>Rendelésed állapota frissült.</p>',
    'orders@example-shop.hu',
    'Rendelésed állapota frissült',
  );
  const summary = summarizePurchaseJourneyContext(doc, snapshot());
  assert.equal(summary.candidateCount, 2);
  assert.ok(summary.candidates.every((item) => item.matchReasons.includes('same_merchant_sender_namespace')));
  assert.ok(summary.candidates.every((item) => !item.matchReasons.some((reason) => reason.includes('_exact'))));
});

test('carrier sender never receives merchant namespace candidates without an exact id', () => {
  const doc = document(
    '<p>Kézbesítés folyamatban.</p>',
    'info@expressone.hu',
    'Kézbesítés folyamatban',
  );
  assert.equal(buildPurchaseJourneyContext(doc, snapshot()), null);
});

test('trusted prior lifecycle event remains visible even without a child identity record', () => {
  const base = snapshot();
  base.shipments = [];
  const doc = document(
    '<p>Rendelés #ORD-12345 állapota frissült.</p>',
    'orders@example-shop.hu',
    'Rendelés #ORD-12345 állapota frissült',
  );
  const summary = summarizePurchaseJourneyContext(doc, base, 5, [
    priorEvent({ eventType: 'payment_completed', trackingId: null, amount: 12990, currency: 'HUF' }),
  ]);
  assert.equal(summary.candidates[0]?.purchaseId, 'p1');
  assert.equal(summary.candidates[0]?.recentEvents[0]?.eventType, 'payment_completed');
  assert.equal(summary.candidates[0]?.recentEvents[0]?.amount, 12990);
});

test('carrier can recover read-only journey context from exact tracking kept only in trusted event memory', () => {
  const base = snapshot();
  base.shipments = [];
  const doc = document(
    '<p>Tracking number: TRACK-MEMORY-777</p><p>Kézbesítés folyamatban.</p>',
    'info@expressone.hu',
    'TRACK-MEMORY-777 kézbesítés alatt',
  );
  const summary = summarizePurchaseJourneyContext(doc, base, 5, [priorEvent()]);
  assert.equal(summary.candidates[0]?.purchaseId, 'p1');
  assert.ok(summary.candidates[0]?.matchReasons.includes('current_email_tracking_id_exact_prior_event'));
});
