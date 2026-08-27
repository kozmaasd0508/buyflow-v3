import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import type { ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { EvidenceClaim, EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from '../extraction-v2/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { canonicalEventFromExtractionV2 } from './extraction-v2-adapter.js';
import {
  evaluatePurchaseCreationAuthority,
  hasExplicitPurchaseAcceptance,
} from './purchase-creation-authority.js';

function emailDocument(input: {
  subject: string;
  body: string;
  from?: string;
  name?: string;
}) {
  const email: NormalizedEmail = {
    provider: 'ses',
    providerMessageId: 'purchase-anchor-rescue',
    subject: input.subject,
    from: [{
      email: input.from ?? 'orders@example-shop.hu',
      name: input.name ?? 'Example Shop',
    }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-27T18:00:00.000Z',
    bodyHtml: `<div>${input.body}</div>`,
    folders: ['inbound'],
    attachments: [],
  };
  return buildEmailDocumentV1(email);
}

test('explicit order confirmation plus one concrete amount can authorize a merchant Purchase anchor', () => {
  const document = emailDocument({
    subject: 'Megrendelés visszaigazolása #AB-778812',
    body: '<p>Rendelés #AB-778812</p><p>Végösszeg: 12 990 Ft</p>',
  });

  assert.equal(hasExplicitPurchaseAcceptance(document), true);
  const result = evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'authorized');
});

test('explicit accepted-order wording plus one concrete amount can authorize a merchant Purchase anchor', () => {
  const document = emailDocument({
    subject: 'Rendelési értesítés #AB-778812',
    body: '<p>Megrendelésedet elfogadtuk.</p><p>Rendelés #AB-778812</p><p>Összesen: 12 990 Ft</p>',
  });

  assert.equal(hasExplicitPurchaseAcceptance(document), true);
  assert.equal(evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  }).authority, 'authorized');
});

test('confirmation-looking wording without a substantive commerce signal remains REVIEW', () => {
  const document = emailDocument({
    subject: 'Megrendelés visszaigazolása #AB-778812',
    body: '<p>Rendelés #AB-778812</p>',
  });

  assert.equal(hasExplicitPurchaseAcceptance(document), true);
  assert.equal(evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  }).authority, 'review');
});

test('explicit non-acceptance overrides confirmation-looking subject and amount', () => {
  const document = emailDocument({
    subject: 'Megrendelés visszaigazolása #AB-778812',
    body: [
      '<p>Rendelés #AB-778812</p>',
      '<p>Végösszeg: 12 990 Ft</p>',
      '<p>Ez az automatikus visszaigazolás nem jelenti a szerződés létrejöttét.</p>',
    ].join(''),
  });

  const result = evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'review');
  assert.ok(result.reasons.includes('explicit_order_non_acceptance_or_contract_disclaimer'));
});

function claim<T>(
  field: EvidenceClaim<T>['field'],
  value: T,
  qualifier: string,
  source: EvidenceClaim<T>['source'] = 'body',
  confidence = 0.99,
): EvidenceClaim<T> {
  return {
    field,
    value,
    confidence,
    source,
    extractorId: source === 'sender' ? 'universal-merchant' : 'openai-semantic-shadow',
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

function extraction(resolvedEvent: ResolvedCommerceEvent, claims: EvidenceClaim[]): ExtractionEngineV2Result {
  return {
    engineVersion: 'extraction-engine-v2-shadow',
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: { bundle: { claims }, ranExtractors: [] },
    resolved: resolvedEvent,
    validation: { issues: [], reviewRequired: false },
    reviewRequired: false,
  };
}

test('matching deterministic sender evidence can recover merchant source authority hidden by a stronger semantic claim', () => {
  const document = emailDocument({
    subject: 'Order confirmation #AB-778812',
    body: '<p>Order #AB-778812</p><p>Total: 49.99 EUR</p>',
    from: 'orders@example-shop.hu',
    name: 'Example Shop',
  });
  const eventType = claim('event_type', 'order_created', 'ai_event');
  const aiMerchant = claim('merchant', 'Example Shop', 'ai_merchant', 'body', 0.99);
  const senderMerchant = claim('merchant', 'Example Shop', 'sender_commercial_identity', 'sender', 0.86);
  const order = claim('order_number', 'AB-778812', 'explicit_order_label');

  const event = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document,
    extraction: extraction(commerceEvent({
      eventType: resolved('order_created', [eventType]),
      merchant: resolved('Example Shop', [aiMerchant]),
      orderNumber: resolved('AB-778812', [order]),
    }), [eventType, aiMerchant, senderMerchant, order]),
  });

  assert.ok(event);
  assert.equal(event.sourceRole, 'merchant');
});

test('different sender merchant evidence cannot authorize the semantic merchant', () => {
  const document = emailDocument({
    subject: 'Order confirmation #AB-778812',
    body: '<p>Order #AB-778812</p><p>Total: 49.99 EUR</p>',
    from: 'orders@example-shop.hu',
    name: 'Example Shop',
  });
  const eventType = claim('event_type', 'order_created', 'ai_event');
  const aiMerchant = claim('merchant', 'Another Merchant', 'ai_merchant');
  const senderMerchant = claim('merchant', 'Example Shop', 'sender_commercial_identity', 'sender', 0.86);
  const order = claim('order_number', 'AB-778812', 'explicit_order_label');

  const event = canonicalEventFromExtractionV2({
    userId: 'user-1',
    document,
    extraction: extraction(commerceEvent({
      eventType: resolved('order_created', [eventType]),
      merchant: resolved('Another Merchant', [aiMerchant]),
      orderNumber: resolved('AB-778812', [order]),
    }), [eventType, aiMerchant, senderMerchant, order]),
  });

  assert.ok(event);
  assert.equal(event.sourceRole, 'unknown');
});

test('public mailbox and shared platform domains cannot gain merchant authority from matching sender claims', () => {
  for (const from of ['example-shop@gmail.com', 'merchant@shopifyemail.com']) {
    const document = emailDocument({
      subject: 'Order confirmation #AB-778812',
      body: '<p>Order #AB-778812</p><p>Total: 49.99 EUR</p>',
      from,
      name: 'Example Shop',
    });
    const eventType = claim('event_type', 'order_created', 'ai_event');
    const aiMerchant = claim('merchant', 'Example Shop', 'ai_merchant');
    const senderMerchant = claim('merchant', 'Example Shop', 'sender_commercial_identity', 'sender', 0.86);
    const order = claim('order_number', 'AB-778812', 'explicit_order_label');

    const event = canonicalEventFromExtractionV2({
      userId: 'user-1',
      document,
      extraction: extraction(commerceEvent({
        eventType: resolved('order_created', [eventType]),
        merchant: resolved('Example Shop', [aiMerchant]),
        orderNumber: resolved('AB-778812', [order]),
      }), [eventType, aiMerchant, senderMerchant, order]),
    });

    assert.ok(event);
    assert.equal(event.sourceRole, 'unknown');
  }
});
