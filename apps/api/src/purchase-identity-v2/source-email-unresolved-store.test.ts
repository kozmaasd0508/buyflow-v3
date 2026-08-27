import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDurableUnresolvedSnapshotFromSourceRows,
  persistedSourceEmailToCanonicalEvent,
  planRecoveryAgainstDurableSnapshot,
  type PersistedUnlinkedSourceEmail,
} from './source-email-unresolved-store.js';
import type { CanonicalEvent } from './types.js';

function row(overrides: Partial<PersistedUnlinkedSourceEmail> = {}): PersistedUnlinkedSourceEmail {
  return {
    id: 'source-1',
    user_id: 'user-1',
    provider_message_id: 'provider-message-1',
    from_address: 'Express One <notice@expressone.hu>',
    received_at: '2026-08-27T18:00:00Z',
    processing_status: 'unlinked',
    validation_status: 'validated',
    validated_result: {
      event_type: 'delivery',
      shipment_phase: 'delivered',
      tracking_number: 'ABC-123456',
      carrier: 'Express One',
      confidence: 0.98,
    },
    ...overrides,
  };
}

function trigger(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: 'trigger',
    userId: 'user-1',
    eventType: 'shipment_created',
    sourceProvider: 'gmail',
    sourceMessageId: 'merchant-message',
    senderDomain: 'shop.example',
    receivedAt: '2026-08-27T20:00:00Z',
    occurredAt: null,
    merchantRaw: 'Example Shop',
    merchantId: null,
    merchantNamespace: 'sender-domain:shop.example',
    orderIdRaw: 'ORDER-1',
    orderIdNormalized: 'ORDER1',
    trackingIdRaw: 'ABC-123456',
    trackingIdNormalized: 'ABC123456',
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
    carrierId: 'express-one',
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
    ...overrides,
  };
}

test('rehydrates trusted carrier unlinked source as exact namespaced unresolved event', () => {
  const event = persistedSourceEmailToCanonicalEvent(row());
  assert.ok(event);
  assert.equal(event.eventType, 'delivered');
  assert.equal(event.sourceRole, 'carrier');
  assert.equal(event.carrierId, 'express-one');
  assert.equal(event.trackingIdNormalized, 'ABC123456');
  assert.equal(event.merchantNamespace, null);
  assert.equal(event.purchaseCreationAuthority, 'none');
});

test('durable snapshot stays user-scoped and rejects untrusted or non-actionable rows', () => {
  const result = buildDurableUnresolvedSnapshotFromSourceRows([
    row(),
    row({ id: 'other-user', user_id: 'user-2' }),
    row({ id: 'review-only', validation_status: 'review' }),
    row({ id: 'order-root', from_address: 'orders@shop.example', validated_result: {
      event_type: 'order_created',
      merchant: 'Example Shop',
      order_number: 'ORDER-1',
      confidence: 0.99,
    } }),
  ], 'user-1');

  assert.equal(result.sourceRowsRead, 4);
  assert.equal(result.eventsAccepted, 1);
  assert.equal(result.eventsRejected, 3);
  assert.deepEqual(result.snapshot.records.map((item) => item.eventId), ['source-email:source-1']);
});

test('merchant event with same carrier namespace and tracking targets the durable carrier-first event', () => {
  const durable = buildDurableUnresolvedSnapshotFromSourceRows([row()], 'user-1');
  const plan = planRecoveryAgainstDurableSnapshot(trigger(), durable.snapshot);
  assert.deepEqual(plan.unresolvedEventIds, ['source-email:source-1']);
  assert.equal(plan.sharedIdentityKeys.length, 1);
});

test('same tracking under another carrier or another user cannot target durable unresolved evidence', () => {
  const durable = buildDurableUnresolvedSnapshotFromSourceRows([row()], 'user-1');
  assert.deepEqual(
    planRecoveryAgainstDurableSnapshot(trigger({ carrierId: 'gls' }), durable.snapshot).unresolvedEventIds,
    [],
  );
  assert.deepEqual(
    planRecoveryAgainstDurableSnapshot(trigger({ userId: 'user-2' }), durable.snapshot).unresolvedEventIds,
    [],
  );
});

test('merchant unlinked source gets a sender-domain order namespace only when source is non-public and merchant is explicit', () => {
  const merchant = persistedSourceEmailToCanonicalEvent(row({
    from_address: 'Shop <orders@shop.example>',
    validated_result: {
      event_type: 'invoice_or_receipt',
      merchant: 'Example Shop',
      order_number: '#9876',
      invoice_number: 'INV-44',
      confidence: 0.96,
    },
  }));
  assert.ok(merchant);
  assert.equal(merchant.sourceRole, 'merchant');
  assert.equal(merchant.merchantNamespace, 'sender-domain:shop.example');
  assert.equal(merchant.orderIdNormalized, '9876');

  const publicMailbox = persistedSourceEmailToCanonicalEvent(row({
    from_address: 'Shop <orders@gmail.com>',
    validated_result: {
      event_type: 'invoice_or_receipt',
      merchant: 'Example Shop',
      order_number: '#9876',
      confidence: 0.96,
    },
  }));
  assert.ok(publicMailbox);
  assert.equal(publicMailbox.sourceRole, 'unknown');
  assert.equal(publicMailbox.merchantNamespace, null);
});

test('delivery-family persistence is conservative when final phase is not proven', () => {
  const out = persistedSourceEmailToCanonicalEvent(row({
    validated_result: {
      event_type: 'delivery',
      shipment_phase: 'out_for_delivery',
      tracking_number: 'ABC-123456',
      carrier: 'Express One',
      confidence: 0.98,
    },
  }));
  assert.equal(out?.eventType, 'out_for_delivery');

  const ambiguous = persistedSourceEmailToCanonicalEvent(row({
    validated_result: {
      event_type: 'delivery',
      tracking_number: 'ABC-123456',
      carrier: 'Express One',
      confidence: 0.98,
    },
  }));
  assert.equal(ambiguous?.eventType, 'shipment_created');
});
