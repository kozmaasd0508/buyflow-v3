import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { EvidenceClaim, EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from '../extraction-v2/types.js';
import { decideCorrelation } from './decision-engine.js';
import { canonicalEventFromExtractionV2 } from './extraction-v2-adapter.js';
import { semanticEventOverrideFromV9 } from './v9-semantic-overlay.js';

function claim<T>(field: EvidenceClaim<T>['field'], value: T): EvidenceClaim<T> {
  return {
    field,
    value,
    confidence: 0.99,
    source: 'body',
    extractorId: `identity-boundary-${field}`,
    extractorVersion: '1',
    qualifiers: ['deterministic-test-evidence'],
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
    provider: 'gmail',
    providerMessageId: 'semantic-overlay-boundary',
    receivedAt: '2026-08-29T18:30:00.000Z',
    sender: {
      addresses: [{ email: 'orders@example-shop.test', name: 'Example Shop' }],
      domains: ['example-shop.test'],
      primaryEmail: 'orders@example-shop.test',
      primaryDomain: 'example-shop.test',
      primaryName: 'Example Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Csomag frissítés',
    text: 'Rendelés ORDER-778812. Nyomkövetési szám: TRACK-12345678.',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: ['ORDER-778812'],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: ['TRACK-12345678'],
    },
  };
}

test('V9 semantic override can supply missing primary semantics but identity remains Extraction v2-only', () => {
  const order = claim('order_number', 'ORDER-778812');
  const tracking = claim('tracking_number', 'TRACK-12345678');
  const merchant = claim('merchant', 'Example Shop');
  const extracted = extraction(event({
    orderNumber: resolved('ORDER-778812', [order]),
    trackingNumber: resolved('TRACK-12345678', [tracking]),
    merchant: resolved('Example Shop', [merchant]),
  }), [order, tracking, merchant]);
  const semantic = semanticEventOverrideFromV9({ eventType: 'SHIPPED', isCommerce: true });
  assert.equal(semantic.ok, true);
  if (!semantic.ok) return;

  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extracted,
    semanticEventOverride: semantic.override,
  });

  assert.ok(adapted);
  assert.equal(adapted.eventType, 'shipment_created');
  assert.equal(adapted.orderIdRaw, 'ORDER-778812');
  assert.equal(adapted.orderIdNormalized, 'ORDER778812');
  assert.equal(adapted.trackingIdRaw, 'TRACK-12345678');
  assert.equal(adapted.trackingIdNormalized, 'TRACK12345678');
  assert.equal(adapted.merchantRaw, 'Example Shop');
  assert.ok(adapted.provenance.some((item) =>
    item.field === 'semantic_event_type'
    && item.qualifiers?.includes('semantic_only')
    && item.qualifiers?.includes('non_authoritative')
    && item.qualifiers?.includes('no_identity_evidence_from_ai')
  ));
});

test('changing V9 semantic label changes only eventType, never extracted identity fields', () => {
  const deterministicEvent = claim('event_type', 'shipment');
  const order = claim('order_number', 'ORDER-778812');
  const tracking = claim('tracking_number', 'TRACK-12345678');
  const extracted = extraction(event({
    eventType: resolved('shipment', [deterministicEvent]),
    orderNumber: resolved('ORDER-778812', [order]),
    trackingNumber: resolved('TRACK-12345678', [tracking]),
  }), [deterministicEvent, order, tracking]);

  const baseline = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extracted,
  });
  const semantic = semanticEventOverrideFromV9({ eventType: 'DELIVERED', isCommerce: true });
  assert.equal(semantic.ok, true);
  if (!semantic.ok) return;
  const overlaid = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extracted,
    semanticEventOverride: semantic.override,
  });

  assert.ok(baseline);
  assert.ok(overlaid);
  assert.equal(baseline.eventType, 'shipment_created');
  assert.equal(overlaid.eventType, 'delivered');
  for (const field of [
    'orderIdRaw', 'orderIdNormalized', 'trackingIdRaw', 'trackingIdNormalized',
    'invoiceIdRaw', 'invoiceIdNormalized', 'paymentReference', 'merchantRaw',
    'merchantId', 'carrierId', 'amount', 'currency',
  ] as const) {
    assert.deepEqual(overlaid[field], baseline[field], field);
  }
});

test('V9 semantics cannot override a hard Extraction v2 identity conflict', () => {
  const orderA = claim('order_number', 'ORDER-111111');
  const orderB = claim('order_number', 'ORDER-222222');
  const extracted = extraction(event({
    orderNumber: {
      value: null,
      confidence: null,
      status: 'conflict',
      provenance: [orderA, orderB],
    },
    reviewRequired: true,
    conflictFields: ['order_number'],
  }), [orderA, orderB]);
  const semantic = semanticEventOverrideFromV9({ eventType: 'ORDER_CREATED', isCommerce: true });
  assert.equal(semantic.ok, true);
  if (!semantic.ok) return;

  const adapted = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document: document(),
    extraction: extracted,
    semanticEventOverride: semantic.override,
  });

  assert.ok(adapted);
  assert.equal(adapted.eventType, 'order_created');
  assert.ok(adapted.conflicts?.some((item) => item.field === 'order_number' && item.severity === 'hard'));
  const decision = decideCorrelation(adapted, { purchases: [], orders: [], shipments: [], payments: [], invoices: [] });
  assert.equal(decision.kind, 'PENDING');
});
