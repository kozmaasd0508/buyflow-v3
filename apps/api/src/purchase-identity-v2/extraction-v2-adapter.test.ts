import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { EvidenceClaim, EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from '../extraction-v2/types.js';
import { decideCorrelation } from './decision-engine.js';
import { canonicalEventFromExtractionV2 } from './extraction-v2-adapter.js';
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

function commerceEvent(overrides: Partial<ResolvedCommerceEvent> = {}): ResolvedCommerceEvent {
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

function document(): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas',
    providerMessageId: 'msg-1',
    receivedAt: '2026-08-23T18:00:00.000Z',
    sender: {
      addresses: [{ email: 'notify@gls-hungary.com', name: 'GLS' }],
      domains: ['gls-hungary.com'],
      primaryEmail: 'notify@gls-hungary.com',
      primaryDomain: 'gls-hungary.com',
      primaryName: 'GLS',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Csomag értesítés',
    text: 'A csomag úton van.',
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

function extraction(resolvedEvent: ResolvedCommerceEvent, claims: EvidenceClaim[] = [], reviewIssues: ExtractionEngineV2Result['validation']['issues'] = []): ExtractionEngineV2Result {
  return {
    engineVersion: 'extraction-engine-v2-shadow',
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: { bundle: { claims }, ranExtractors: [] },
    resolved: resolvedEvent,
    validation: { issues: reviewIssues, reviewRequired: reviewIssues.some((issue) => issue.severity === 'review') },
    reviewRequired: resolvedEvent.reviewRequired || reviewIssues.some((issue) => issue.severity === 'review'),
  };
}

test('maps resolved Extraction v2 fields and preserves field-level provenance', () => {
  const eventType = claim('event_type', 'shipment', 'direct_carrier_shipment_event', 'provider_adapter');
  const carrier = claim('carrier', 'GLS', 'authenticated_direct_carrier_sender', 'provider_adapter');
  const order = claim('order_number', 'ABC-123', 'explicit_order_label');
  const tracking = claim('tracking_number', 'GLS-77', 'explicit_tracking_label');
  const merchant = claim('merchant', 'Example Shop', 'explicit_merchant_label');

  const result = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extraction(commerceEvent({
      eventType: resolved('shipment', [eventType]),
      carrier: resolved('GLS', [carrier]),
      orderNumber: resolved('ABC-123', [order]),
      trackingNumber: resolved('GLS-77', [tracking]),
      merchant: resolved('Example Shop', [merchant]),
    }), [eventType, carrier, order, tracking, merchant]),
    merchantResolver: {
      resolve: ({ merchantRaw }) => merchantRaw === 'Example Shop' ? 'merchant:example-shop' : null,
    },
  });

  assert.ok(result);
  assert.equal(result.eventType, 'shipment_created');
  assert.equal(result.orderIdNormalized, 'ABC123');
  assert.equal(result.trackingIdNormalized, 'GLS77');
  assert.equal(result.merchantId, 'merchant:example-shop');
  assert.equal(result.carrierId, 'gls');
  assert.equal(result.sourceRole, 'carrier');
  assert.ok(result.provenance.some((item) => item.field === 'tracking_number' && item.extractorId === 'test-tracking_number'));
  assert.equal(result.conflicts?.length, 0);
});

test('does not invent canonical merchant identity without a resolver', () => {
  const eventType = claim('event_type', 'order_created', 'explicit_order_created_event');
  const merchant = claim('merchant', 'Marketplace Seller Display', 'sender_commercial_identity', 'sender');
  const order = claim('order_number', 'ORDER-9', 'explicit_order_label');

  const result = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extraction(commerceEvent({
      eventType: resolved('order_created', [eventType]),
      merchant: resolved('Marketplace Seller Display', [merchant]),
      orderNumber: resolved('ORDER-9', [order]),
    }), [eventType, merchant, order]),
  });

  assert.ok(result);
  assert.equal(result.merchantRaw, 'Marketplace Seller Display');
  assert.equal(result.merchantId, null);
  assert.equal(result.sourceRole, 'merchant');
});

test('maps Extraction v2 field conflicts to hard correlation conflicts', () => {
  const eventType = claim('event_type', 'shipment', 'explicit_shipment_event');
  const orderA = claim('order_number', 'A-1', 'explicit_order_label');
  const orderB = claim('order_number', 'B-2', 'explicit_order_label');
  const resolvedEvent = commerceEvent({
    eventType: resolved('shipment', [eventType]),
    orderNumber: {
      value: null,
      confidence: null,
      status: 'conflict',
      provenance: [orderA, orderB],
    },
    reviewRequired: true,
    conflictFields: ['order_number'],
  });

  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extraction(resolvedEvent, [eventType, orderA, orderB]),
  });

  assert.ok(adapted);
  assert.equal(adapted.orderIdRaw, null);
  assert.equal(adapted.conflicts?.[0]?.field, 'order_number');
  assert.equal(adapted.conflicts?.[0]?.severity, 'hard');
  assert.deepEqual(adapted.conflicts?.[0]?.values, ['A-1', 'B-2']);

  const decision = decideCorrelation(adapted, { purchases: [], orders: [], shipments: [], payments: [], invoices: [] });
  assert.equal(decision.kind, 'PENDING');
});

test('maps review-level cross-field contradictions to hard correlation conflicts', () => {
  const eventType = claim('event_type', 'payment_completed', 'explicit_payment_completed_event');
  const paymentStatus = claim('payment_status', 'failed', 'explicit_payment_failure');
  const resolvedEvent = commerceEvent({
    eventType: resolved('payment_completed', [eventType]),
    paymentStatus: resolved('failed', [paymentStatus]),
  });

  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extraction(resolvedEvent, [eventType, paymentStatus], [{
      code: 'payment_completed_status_contradiction',
      severity: 'review',
      fields: ['event_type', 'payment_status'],
      message: 'payment_completed conflicts with a non-paid payment status.',
    }]),
  });

  assert.ok(adapted);
  assert.equal(adapted.conflicts?.length, 1);
  assert.match(adapted.conflicts?.[0]?.explanation ?? '', /payment_completed_status_contradiction/);
});

test('does not infer payment provider or invoice issuer from identifiers alone', () => {
  const eventType = claim('event_type', 'invoice_or_receipt', 'explicit_invoice_event');
  const invoice = claim('invoice_number', 'INV-42', 'explicit_invoice_label');
  const paymentReference = claim('payment_reference', 'PAY-55', 'explicit_payment_reference_label');

  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extraction(commerceEvent({
      eventType: resolved('invoice_or_receipt', [eventType]),
      invoiceNumber: resolved('INV-42', [invoice]),
      paymentReference: resolved('PAY-55', [paymentReference]),
    }), [eventType, invoice, paymentReference]),
  });

  assert.ok(adapted);
  assert.equal(adapted.invoiceIdNormalized, 'INV42');
  assert.equal(adapted.paymentReference, 'PAY55');
  assert.equal(adapted.invoiceIssuerId, null);
  assert.equal(adapted.paymentProviderId, null);
});

test('bridges explicit current-message replacement relation into CanonicalEvent provenance', () => {
  const eventType = claim('event_type', 'shipment', 'explicit_shipment_event');
  const order = claim('order_number', 'NEW-200', 'explicit_order_label');
  const doc = document();
  doc.text = 'Original order: OLD-100\nReplacement order: NEW-200';

  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: doc,
    extraction: extraction(commerceEvent({
      eventType: resolved('shipment', [eventType]),
      orderNumber: resolved('NEW-200', [order]),
    }), [eventType, order]),
  });

  assert.ok(adapted);
  assert.equal(adapted.orderRelation?.relation, 'replacement');
  assert.equal(adapted.orderRelation?.parentOrderIdNormalized, 'OLD100');
  assert.equal(adapted.orderRelation?.childOrderIdNormalized, 'NEW200');
  assert.ok(adapted.provenance.some((item) => item.field === 'order_relation' && item.extractorId === 'explicit-order-relation'));
});

test('bridges conflicting explicit relation evidence into hard correlation PENDING', () => {
  const eventType = claim('event_type', 'shipment', 'explicit_shipment_event');
  const order = claim('order_number', 'NEW-200', 'explicit_order_label');
  const doc = document();
  doc.text = [
    'Original order: OLD-100',
    'Replacement order: NEW-200',
    'Original order: OLD-999',
    'Replacement order: NEW-200',
  ].join('\n');

  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: doc,
    extraction: extraction(commerceEvent({
      eventType: resolved('shipment', [eventType]),
      orderNumber: resolved('NEW-200', [order]),
    }), [eventType, order]),
  });

  assert.ok(adapted);
  assert.equal(adapted.orderRelation, null);
  assert.ok(adapted.conflicts?.some((item) => item.field === 'order_relation' && item.severity === 'hard'));

  const snapshot: PurchaseIdentitySnapshot = { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
  const decision = decideCorrelation(adapted, snapshot);
  assert.equal(decision.kind, 'PENDING');
});

test('returns null for non-commerce extraction with no resolved or conflicting event type', () => {
  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extraction(commerceEvent()),
  });
  assert.equal(adapted, null);
});
