import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { EvidenceClaim, EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from '../extraction-v2/types.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import { UnresolvedEventPool } from './unresolved-event-pool.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';

function claim<T>(field: EvidenceClaim<T>['field'], value: T, qualifier: string): EvidenceClaim<T> {
  return {
    field,
    value,
    confidence: 0.99,
    source: 'body',
    extractorId: `integration-${field}`,
    extractorVersion: 'test-v1',
    qualifiers: [qualifier],
  };
}

function resolved<T>(value: T, provenance: EvidenceClaim<T>[]): ResolvedField<T> {
  return { value, confidence: 0.99, status: 'resolved', provenance };
}

function missing<T>(): ResolvedField<T> {
  return { value: null, confidence: null, status: 'missing', provenance: [] };
}

function extraction(): ExtractionEngineV2Result {
  const eventType = claim('event_type', 'shipment', 'explicit_shipment_event');
  const merchant = claim('merchant', 'Example Shop', 'sender_commercial_identity');
  const order = claim('order_number', 'ORDER-1', 'explicit_order_label');
  const carrier = claim('carrier', 'GLS', 'explicit_carrier_label');
  const tracking = claim('tracking_number', 'TRACK-99', 'explicit_tracking_label');
  const resolvedEvent: ResolvedCommerceEvent = {
    eventType: resolved('shipment', [eventType]),
    merchant: resolved('Example Shop', [merchant]),
    orderNumber: resolved('ORDER-1', [order]),
    total: missing<number>(),
    currency: missing<string>(),
    carrier: resolved('GLS', [carrier]),
    trackingNumber: resolved('TRACK-99', [tracking]),
    paymentStatus: missing<string>(),
    invoiceNumber: missing<string>(),
    paymentReference: missing<string>(),
    products: missing<EvidenceProduct[]>(),
    reviewRequired: false,
    conflictFields: [],
  };
  return {
    engineVersion: 'extraction-engine-v2-shadow',
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: { bundle: { claims: [eventType, merchant, order, carrier, tracking] }, ranExtractors: [] },
    resolved: resolvedEvent,
    validation: { issues: [], reviewRequired: false },
    reviewRequired: false,
  };
}

function document(): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'current-hidden-message-id',
    receivedAt: '2026-08-27T18:00:00.000Z',
    sender: {
      addresses: [{ email: 'orders@example-shop.test', name: 'Example Shop' }],
      domains: ['example-shop.test'],
      primaryEmail: 'orders@example-shop.test',
      primaryDomain: 'example-shop.test',
      primaryName: 'Example Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Shipment update',
    text: 'Your shipment is on the way.',
    html: '<p>Your shipment is on the way.</p>',
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: ['ORDER-1'],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: ['GLS'],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: ['TRACK-99'],
    },
  };
}

function graphSnapshot(): PurchaseIdentitySnapshot {
  return {
    purchases: [{
      purchaseId: 'p1',
      userId: 'user-1',
      canonicalMerchantId: 'merchant:example-shop',
      primaryOrderIdentityId: 'o1',
      state: 'open',
    }],
    orders: [{
      orderIdentityId: 'o1',
      purchaseId: 'p1',
      merchantId: 'merchant:example-shop',
      orderId: 'ORDER-1',
      relation: 'primary',
      parentOrderIdentityId: null,
    }],
    shipments: [],
    payments: [],
    invoices: [],
  };
}

function unresolvedDelivery(): CanonicalEvent {
  return {
    eventId: 'persisted-unlinked-delivery',
    userId: 'user-1',
    eventType: 'delivered',
    sourceProvider: 'persisted-source-email',
    sourceMessageId: 'older-hidden-message-id',
    senderDomain: 'gls.hu',
    receivedAt: '2026-08-27T17:00:00.000Z',
    occurredAt: null,
    merchantRaw: null,
    merchantId: null,
    merchantNamespace: null,
    purchaseCreationAuthority: 'none',
    purchaseCreationReasons: ['persisted_unlinked_lifecycle'],
    orderIdRaw: null,
    orderIdNormalized: null,
    trackingIdRaw: 'TRACK-99',
    trackingIdNormalized: 'TRACK-99',
    invoiceIdRaw: null,
    invoiceIdNormalized: null,
    paymentReference: null,
    amount: null,
    currency: null,
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: [],
    sourceRole: 'carrier',
    carrierId: 'gls',
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
  };
}

test('shadow runtime replays only exact durable unresolved identity after a safe bridge', () => {
  const pool = new UnresolvedEventPool();
  assert.equal(pool.remember(unresolvedDelivery(), { kind: 'UNLINKED', reasons: [] }), true);

  const result = runPurchaseIdentityShadow({
    userId: 'user-1',
    document: document(),
    snapshot: graphSnapshot(),
    unresolvedSnapshot: pool.snapshot(),
    merchantResolver: { resolve: () => 'merchant:example-shop' },
    carrierResolver: { resolve: () => 'gls' },
    runExtraction: () => extraction(),
  });

  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.decision?.kind, 'LINKED');
  assert.equal(result.deferredResolution.initialUnresolvedCount, 1);
  assert.equal(result.deferredResolution.recoveredEventCount, 1);
  assert.equal(result.deferredResolution.unresolvedRemainingCount, 0);
  assert.equal(result.simulatedGraphMutated, true);
  assert.equal(result.simulatedSnapshot.purchases[0]?.state, 'fulfilled');
  assert.equal(result.evidencePacketSummary.unresolvedCount, 1);
  assert.equal(JSON.stringify(result.evidencePacketSummary).includes('TRACK-99'), false);
});
