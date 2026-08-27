import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceIdentityGraph } from './evidence-identity-graph.js';
import {
  VerifiedIdentityObservationStore,
  verifiedIdentityObservationsFromEvent,
} from './verified-identity-observation.js';
import type { CanonicalEvent, EvidenceProvenance, PurchaseIdentitySnapshot } from './types.js';

function provenance(field: string, extractorId: string): EvidenceProvenance {
  return {
    field,
    source: 'body',
    parserVersion: 'test',
    extractorId,
    extractorVersion: 'test',
    confidence: 0.99,
    qualifiers: [],
  };
}

function event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: overrides.eventId ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'user-1',
    eventType: overrides.eventType ?? 'shipment_created',
    sourceProvider: overrides.sourceProvider ?? 'test',
    sourceMessageId: overrides.sourceMessageId ?? crypto.randomUUID(),
    senderDomain: overrides.senderDomain ?? 'shop.example',
    receivedAt: overrides.receivedAt ?? '2026-08-27T20:00:00Z',
    occurredAt: overrides.occurredAt ?? null,
    merchantRaw: overrides.merchantRaw ?? 'Shop',
    merchantId: overrides.merchantId ?? null,
    merchantNamespace: overrides.merchantNamespace ?? 'sender-domain:shop.example',
    purchaseCreationAuthority: overrides.purchaseCreationAuthority,
    purchaseCreationReasons: overrides.purchaseCreationReasons,
    orderRelation: overrides.orderRelation,
    orderIdRaw: overrides.orderIdRaw ?? null,
    orderIdNormalized: overrides.orderIdNormalized ?? null,
    trackingIdRaw: overrides.trackingIdRaw ?? null,
    trackingIdNormalized: overrides.trackingIdNormalized ?? null,
    invoiceIdRaw: overrides.invoiceIdRaw ?? null,
    invoiceIdNormalized: overrides.invoiceIdNormalized ?? null,
    paymentReference: overrides.paymentReference ?? null,
    amount: overrides.amount ?? null,
    currency: overrides.currency ?? null,
    orderUrl: overrides.orderUrl ?? null,
    trackingUrl: overrides.trackingUrl ?? null,
    productFingerprints: overrides.productFingerprints ?? [],
    provenance: overrides.provenance ?? [],
    sourceRole: overrides.sourceRole ?? 'merchant',
    carrierId: overrides.carrierId ?? null,
    paymentProviderId: overrides.paymentProviderId ?? null,
    invoiceIssuerId: overrides.invoiceIssuerId ?? null,
    platformMerchantId: overrides.platformMerchantId ?? null,
    sellerMerchantId: overrides.sellerMerchantId ?? null,
    conflicts: overrides.conflicts ?? [],
  };
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

test('AI-only hard identity never becomes VERIFIED observation', () => {
  const observations = verifiedIdentityObservationsFromEvent(event({
    orderIdRaw: 'ORDER-1',
    orderIdNormalized: 'ORDER1',
    provenance: [provenance('order_number', 'openai-semantic-shadow')],
  }));
  assert.deepEqual(observations, []);
});

test('deterministic merchant order identity becomes VERIFIED evidence without Purchase authority', () => {
  const observations = verifiedIdentityObservationsFromEvent(event({
    eventId: 'merchant-order-evidence',
    orderIdRaw: 'ORDER-1',
    orderIdNormalized: 'ORDER1',
    provenance: [provenance('order_number', 'universal-order-number')],
  }));
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.kind, 'order');
  assert.equal(observations[0]?.status, 'VERIFIED');
  assert.equal(observations[0]?.provenanceClass, 'deterministic');
});

test('merchant tracking requires deterministic carrier namespace support', () => {
  const withoutCarrierEvidence = verifiedIdentityObservationsFromEvent(event({
    trackingIdRaw: 'TRACK-1',
    trackingIdNormalized: 'TRACK1',
    carrierId: 'express-one',
    provenance: [provenance('tracking_number', 'universal-tracking')],
  }));
  assert.equal(withoutCarrierEvidence.some((item) => item.kind === 'tracking'), false);

  const withCarrierEvidence = verifiedIdentityObservationsFromEvent(event({
    trackingIdRaw: 'TRACK-1',
    trackingIdNormalized: 'TRACK1',
    carrierId: 'express-one',
    provenance: [
      provenance('tracking_number', 'universal-tracking'),
      provenance('carrier', 'universal-carrier'),
    ],
  }));
  assert.equal(withCarrierEvidence.some((item) => item.kind === 'tracking'), true);
});

test('verified multi-identity evidence can expose exactly one existing Purchase owner read-only', () => {
  const snapshot: PurchaseIdentitySnapshot = {
    purchases: [
      { purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'shop', primaryOrderIdentityId: null, state: 'open' },
    ],
    orders: [],
    shipments: [
      { shipmentId: 's1', purchaseId: 'p1', carrierId: 'express-one', trackingId: 'TRACK1', status: 'in_transit' },
    ],
    payments: [],
    invoices: [],
  };

  const store = new VerifiedIdentityObservationStore();
  store.observe(event({
    eventId: 'merchant-bridge',
    orderIdRaw: 'ORDER-NEW',
    orderIdNormalized: 'ORDERNEW',
    trackingIdRaw: 'TRACK-1',
    trackingIdNormalized: 'TRACK1',
    carrierId: 'express-one',
    provenance: [
      provenance('order_number', 'universal-order-number'),
      provenance('tracking_number', 'universal-tracking'),
      provenance('carrier', 'universal-carrier'),
    ],
  }));

  const graph = new EvidenceIdentityGraph(snapshot, store.snapshot());
  const laterOrderEvent = event({
    eventId: 'later-order-lifecycle',
    eventType: 'invoice_created',
    orderIdRaw: 'ORDER-NEW',
    orderIdNormalized: 'ORDERNEW',
    provenance: [provenance('order_number', 'universal-order-number')],
  });

  assert.deepEqual(graph.resolveEvent(laterOrderEvent), {
    kind: 'UNIQUE_OWNER',
    candidatePurchaseIds: ['p1'],
    purchaseId: 'p1',
  });
  assert.equal(snapshot.orders.length, 0);
});

test('evidence component touching two Purchases becomes AMBIGUOUS instead of selecting one', () => {
  const snapshot: PurchaseIdentitySnapshot = {
    purchases: [
      { purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'shop', primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p2', userId: 'user-1', canonicalMerchantId: 'other', primaryOrderIdentityId: null, state: 'open' },
    ],
    orders: [
      {
        orderIdentityId: 'o1', purchaseId: 'p1', merchantId: null,
        merchantNamespace: 'sender-domain:shop.example', orderId: 'ORDER1',
        relation: 'primary', parentOrderIdentityId: null,
      },
    ],
    shipments: [
      { shipmentId: 's2', purchaseId: 'p2', carrierId: 'express-one', trackingId: 'TRACK2', status: 'in_transit' },
    ],
    payments: [],
    invoices: [],
  };

  const store = new VerifiedIdentityObservationStore();
  store.observe(event({
    eventId: 'conflicting-bridge-component',
    orderIdRaw: 'ORDER-1',
    orderIdNormalized: 'ORDER1',
    trackingIdRaw: 'TRACK-2',
    trackingIdNormalized: 'TRACK2',
    carrierId: 'express-one',
    provenance: [
      provenance('order_number', 'universal-order-number'),
      provenance('tracking_number', 'universal-tracking'),
      provenance('carrier', 'universal-carrier'),
    ],
  }));

  const graph = new EvidenceIdentityGraph(snapshot, store.snapshot());
  const result = graph.resolveEvent(event({
    eventId: 'same-order-later',
    orderIdRaw: 'ORDER-1',
    orderIdNormalized: 'ORDER1',
    provenance: [provenance('order_number', 'universal-order-number')],
  }));

  assert.equal(result.kind, 'AMBIGUOUS');
  assert.deepEqual(result.candidatePurchaseIds, ['p1', 'p2']);
});

test('verified evidence remains user-scoped', () => {
  const store = new VerifiedIdentityObservationStore();
  store.observe(event({
    eventId: 'u1', userId: 'user-1', orderIdRaw: 'X1', orderIdNormalized: 'X1',
    provenance: [provenance('order_number', 'universal-order-number')],
  }));
  assert.equal(store.forUser('user-1').length, 1);
  assert.equal(store.forUser('user-2').length, 0);
  assert.deepEqual(new EvidenceIdentityGraph(emptySnapshot(), store.snapshot()).resolveEvent(event({
    userId: 'user-2', orderIdRaw: 'X1', orderIdNormalized: 'X1',
    provenance: [provenance('order_number', 'universal-order-number')],
  })), { kind: 'WAITING', candidatePurchaseIds: [] });
});
