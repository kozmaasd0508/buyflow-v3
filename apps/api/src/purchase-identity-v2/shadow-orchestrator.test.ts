import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { EvidenceClaim, EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from '../extraction-v2/types.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from './types.js';

function claim<T>(field: EvidenceClaim<T>['field'], value: T, qualifier: string, source: EvidenceClaim<T>['source'] = 'body'): EvidenceClaim<T> {
  return {
    field,
    value,
    confidence: 0.99,
    source,
    extractorId: `test-${field}`,
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

function event(overrides: Partial<ResolvedCommerceEvent> = {}): ResolvedCommerceEvent {
  return {
    eventType: overrides.eventType ?? missing<string>(),
    merchant: overrides.merchant ?? missing<string>(),
    orderNumber: overrides.orderNumber ?? missing<string>(),
    total: overrides.total ?? missing<number>(),
    currency: overrides.currency ?? missing<string>(),
    carrier: overrides.carrier ?? missing<string>(),
    trackingNumber: overrides.trackingNumber ?? missing<string>(),
    paymentStatus: overrides.paymentStatus ?? missing<string>(),
    invoiceNumber: overrides.invoiceNumber ?? missing<string>(),
    paymentReference: overrides.paymentReference ?? missing<string>(),
    products: overrides.products ?? missing<EvidenceProduct[]>(),
    reviewRequired: overrides.reviewRequired ?? false,
    conflictFields: overrides.conflictFields ?? [],
  };
}

function extraction(resolvedEvent: ResolvedCommerceEvent, claims: EvidenceClaim[] = []): ExtractionEngineV2Result {
  return {
    engineVersion: 'extraction-engine-v2-shadow',
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: { bundle: { claims }, ranExtractors: [] },
    resolved: resolvedEvent,
    validation: { issues: [], reviewRequired: false },
    reviewRequired: resolvedEvent.reviewRequired,
  };
}

function document(): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas',
    providerMessageId: 'msg-shadow-1',
    receivedAt: '2026-08-23T18:00:00.000Z',
    sender: {
      addresses: [{ email: 'notify@example.com', name: 'Example' }],
      domains: ['example.com'],
      primaryEmail: 'notify@example.com',
      primaryDomain: 'example.com',
      primaryName: 'Example',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Shadow fixture',
    text: 'Shadow fixture',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: [],
    },
  };
}

function purchaseRootDocument(): EmailDocumentV1 {
  const doc = document();
  doc.subject = 'Megrendelés visszaigazolása #ORDER-1';
  doc.text = [
    'Köszönjük a rendelésed.',
    'Rendelés #ORDER-1',
    '1x Teszt termék',
    'Végösszeg: 12 990 Ft',
    'Fizetési mód: utánvét',
  ].join('\n');
  doc.sections = [{ type: 'order_summary', text: 'Rendelés #ORDER-1' }];
  doc.signals.amounts = [{ amount: 12990, currency: 'HUF', raw: '12 990 Ft' }];
  doc.signals.paymentMethods = ['utánvét'];
  return doc;
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

test('simulates a safe new purchase without mutating the caller snapshot', () => {
  const eventType = claim('event_type', 'order_created', 'explicit_order_created_event');
  const merchant = claim('merchant', 'Example Shop', 'sender_commercial_identity', 'sender');
  const order = claim('order_number', 'ORDER-1', 'explicit_order_label');
  const inputSnapshot = emptySnapshot();
  const before = structuredClone(inputSnapshot);

  const result = runPurchaseIdentityShadow({
    userId: 'user-1',
    document: purchaseRootDocument(),
    snapshot: inputSnapshot,
    merchantResolver: { resolve: () => 'merchant:example-shop' },
    runExtraction: () => extraction(event({
      eventType: resolved('order_created', [eventType]),
      merchant: resolved('Example Shop', [merchant]),
      orderNumber: resolved('ORDER-1', [order]),
    }), [eventType, merchant, order]),
  });

  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.decision?.kind, 'NEW_PURCHASE');
  assert.equal(result.simulatedGraphMutated, true);
  assert.equal(result.simulatedSnapshot.purchases.length, 1);
  assert.deepEqual(inputSnapshot, before);
});

test('simulates namespace-qualified lifecycle linking', () => {
  const eventType = claim('event_type', 'delivery', 'direct_carrier_delivery_event', 'provider_adapter');
  const carrier = claim('carrier', 'GLS', 'authenticated_direct_carrier_sender', 'provider_adapter');
  const tracking = claim('tracking_number', 'TRACK-77', 'explicit_tracking_label');
  const snapshot: PurchaseIdentitySnapshot = {
    purchases: [{ purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'merchant:shop', primaryOrderIdentityId: 'o1', state: 'open' }],
    orders: [{ orderIdentityId: 'o1', purchaseId: 'p1', merchantId: 'merchant:shop', orderId: 'ORDER-1', relation: 'primary', parentOrderIdentityId: null }],
    shipments: [{ shipmentId: 's1', purchaseId: 'p1', carrierId: 'gls', trackingId: 'TRACK-77', status: 'in_transit' }],
    payments: [],
    invoices: [],
  };

  const result = runPurchaseIdentityShadow({
    userId: 'user-1',
    document: document(),
    snapshot,
    runExtraction: () => extraction(event({
      eventType: resolved('delivery', [eventType]),
      carrier: resolved('GLS', [carrier]),
      trackingNumber: resolved('TRACK-77', [tracking]),
    }), [eventType, carrier, tracking]),
  });

  assert.equal(result.decision?.kind, 'LINKED');
  if (result.decision?.kind === 'LINKED') assert.equal(result.decision.purchaseId, 'p1');
  assert.equal(result.simulatedSnapshot.purchases[0]?.state, 'fulfilled');
  assert.equal(result.simulatedSnapshot.shipments[0]?.status, 'delivered');
});

test('hard extraction conflict stays pending and leaves simulated graph unchanged', () => {
  const eventType = claim('event_type', 'shipment', 'explicit_shipment_event');
  const orderA = claim('order_number', 'ORDER-1', 'explicit_order_label');
  const orderB = claim('order_number', 'ORDER-2', 'explicit_order_label');
  const snapshot: PurchaseIdentitySnapshot = {
    purchases: [{ purchaseId: 'p1', userId: 'user-1', canonicalMerchantId: 'merchant:shop', primaryOrderIdentityId: 'o1', state: 'open' }],
    orders: [{ orderIdentityId: 'o1', purchaseId: 'p1', merchantId: 'merchant:shop', orderId: 'ORDER-1', relation: 'primary', parentOrderIdentityId: null }],
    shipments: [],
    payments: [],
    invoices: [],
  };

  const result = runPurchaseIdentityShadow({
    userId: 'user-1',
    document: document(),
    snapshot,
    runExtraction: () => extraction(event({
      eventType: resolved('shipment', [eventType]),
      orderNumber: { value: null, confidence: null, status: 'conflict', provenance: [orderA, orderB] },
      reviewRequired: true,
      conflictFields: ['order_number'],
    }), [eventType, orderA, orderB]),
  });

  assert.equal(result.decision?.kind, 'PENDING');
  assert.equal(result.simulatedGraphMutated, false);
  assert.deepEqual(result.simulatedSnapshot, snapshot);
});

test('non-commerce extraction produces no correlation decision', () => {
  const snapshot = emptySnapshot();
  const result = runPurchaseIdentityShadow({
    userId: 'user-1',
    document: document(),
    snapshot,
    runExtraction: () => extraction(event()),
  });

  assert.equal(result.canonicalEvent, null);
  assert.equal(result.decision, null);
  assert.equal(result.simulatedGraphMutated, false);
  assert.deepEqual(result.simulatedSnapshot, snapshot);
});
