import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { EvidenceClaim, EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from '../extraction-v2/types.js';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import {
  deriveTrustedProviderSenderAuthorityProvenance,
  PROVIDER_SENDER_AUTHORITY_V1,
} from './provider-sender-authority.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from './types.js';

function gmailDocument(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'gmail-msg-1',
    receivedAt: '2026-09-02T18:00:00.000Z',
    sender: {
      addresses: [{ email: 'orders@shop.example', name: 'Shop' }],
      domains: ['shop.example'],
      primaryEmail: 'orders@shop.example',
      primaryDomain: 'shop.example',
      primaryName: 'Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Köszönjük a rendelésed #ORDER-1',
    text: 'Köszönjük a rendelésed. Rendelés #ORDER-1\nFizetési mód: utánvét',
    html: null,
    headers: [{
      name: 'Authentication-Results',
      value: 'mx.google.com; dkim=pass header.i=@shop.example; spf=pass smtp.mailfrom=shop.example; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=shop.example',
    }],
    attachments: [],
    sections: [{ type: 'order_summary', text: 'Rendelés #ORDER-1' }],
    signals: {
      orderNumbers: ['ORDER-1'],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: ['utánvét'],
      shippingMethods: [],
      trackingNumbers: [],
    },
    ...overrides,
  };
}

function claim<T>(
  field: EvidenceClaim<T>['field'],
  value: T,
  qualifier: string,
  source: EvidenceClaim<T>['source'] = 'body',
): EvidenceClaim<T> {
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

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function orderRootExtraction(): ExtractionEngineV2Result {
  const eventType = claim('event_type', 'order_created', 'explicit_order_created_event');
  const merchant = claim('merchant', 'Shop', 'sender_commercial_identity', 'sender');
  const order = claim('order_number', 'ORDER-1', 'explicit_order_label');
  return extraction(event({
    eventType: resolved('order_created', [eventType]),
    merchant: resolved('Shop', [merchant]),
    orderNumber: resolved('ORDER-1', [order]),
  }), [eventType, merchant, order]);
}

test('Gmail mx.google.com DMARC pass with exact header.from creates trusted sender authority', () => {
  const provenance = deriveTrustedProviderSenderAuthorityProvenance(gmailDocument());
  assert.equal(provenance.length, 1);
  assert.equal(provenance[0]?.field, 'sender_authority');
  assert.equal(provenance[0]?.source, 'provider_adapter');
  assert.equal(provenance[0]?.parserVersion, PROVIDER_SENDER_AUTHORITY_V1);
  assert.ok(provenance[0]?.qualifiers?.includes('trusted_sender_authority'));
  assert.ok(provenance[0]?.qualifiers?.includes('dmarc:pass'));
  assert.ok(provenance[0]?.qualifiers?.includes('header_from:shop.example'));
});

test('non-Gmail source never receives Gmail sender authority', () => {
  const provenance = deriveTrustedProviderSenderAuthorityProvenance(gmailDocument({ provider: 'nylas' }));
  assert.deepEqual(provenance, []);
});

test('spoofed or non-Google authserv-id fails closed', () => {
  const doc = gmailDocument({
    headers: [{
      name: 'Authentication-Results',
      value: 'attacker.example; dmarc=pass header.from=shop.example',
    }],
  });
  assert.deepEqual(deriveTrustedProviderSenderAuthorityProvenance(doc), []);
});

test('DMARC failure fails closed', () => {
  const doc = gmailDocument({
    headers: [{
      name: 'Authentication-Results',
      value: 'mx.google.com; dmarc=fail (p=REJECT sp=REJECT dis=REJECT) header.from=shop.example',
    }],
  });
  assert.deepEqual(deriveTrustedProviderSenderAuthorityProvenance(doc), []);
});

test('authenticated header.from mismatch fails closed', () => {
  const doc = gmailDocument({
    headers: [{
      name: 'Authentication-Results',
      value: 'mx.google.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=attacker.example',
    }],
  });
  assert.deepEqual(deriveTrustedProviderSenderAuthorityProvenance(doc), []);
});

test('only the first Authentication-Results header can grant Gmail authority', () => {
  const doc = gmailDocument({
    headers: [
      {
        name: 'Authentication-Results',
        value: 'untrusted.example; dmarc=pass header.from=shop.example',
      },
      {
        name: 'Authentication-Results',
        value: 'mx.google.com; dmarc=pass header.from=shop.example',
      },
    ],
  });
  assert.deepEqual(deriveTrustedProviderSenderAuthorityProvenance(doc), []);
});

test('trusted Gmail sender authority flows into TrustLink promotion readiness without enabling writes', () => {
  const result = runPurchaseIdentityShadow({
    userId: 'user-1',
    document: gmailDocument(),
    snapshot: emptySnapshot(),
    merchantResolver: { resolve: () => 'merchant:shop' },
    runExtraction: () => orderRootExtraction(),
  });

  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.decision?.kind, 'NEW_PURCHASE');
  assert.equal(result.promotionReadiness.eligible, true);
  assert.equal(result.promotionReadiness.action, 'CREATE_PURCHASE');
  assert.ok(result.canonicalEvent?.provenance.some((item) =>
    item.field === 'sender_authority'
    && item.source === 'provider_adapter'
    && item.qualifiers?.includes('trusted_sender_authority')
  ));
});

test('domain mismatch remains merchant-scope blocked in TrustLink', () => {
  const doc = gmailDocument({
    headers: [{
      name: 'Authentication-Results',
      value: 'mx.google.com; dmarc=pass header.from=other.example',
    }],
  });
  const result = runPurchaseIdentityShadow({
    userId: 'user-1',
    document: doc,
    snapshot: emptySnapshot(),
    merchantResolver: { resolve: () => 'merchant:shop' },
    runExtraction: () => orderRootExtraction(),
  });

  assert.equal(result.productionWrites, 0);
  assert.equal(result.promotionReadiness.eligible, false);
  assert.ok(result.promotionReadiness.reasons.includes('NEW_PURCHASE_MERCHANT_SCOPE_UNPROVEN'));
});
