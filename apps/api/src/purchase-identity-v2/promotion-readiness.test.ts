import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePromotionReadiness } from './promotion-readiness.js';
import type { CanonicalEvent, CorrelationDecision, EvidenceEdge } from './types.js';

function trustedSenderAuthority() {
  return [{
    field: 'sender_authority',
    source: 'provider_adapter' as const,
    parserVersion: 'test-provider-auth-v1',
    qualifiers: ['trusted_sender_authority'],
  }];
}

function event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: 'event-1',
    userId: 'user-1',
    eventType: 'order_updated',
    sourceProvider: 'test',
    sourceMessageId: 'message-1',
    senderDomain: 'shop.example',
    receivedAt: '2026-08-25T12:00:00.000Z',
    occurredAt: null,
    merchantRaw: null,
    merchantId: null,
    merchantNamespace: null,
    purchaseCreationAuthority: 'none',
    purchaseCreationReasons: [],
    orderRelation: null,
    orderIdRaw: null,
    orderIdNormalized: null,
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
    provenance: trustedSenderAuthority(),
    sourceRole: 'unknown',
    carrierId: null,
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
    ...overrides,
  };
}

function edge(overrides: Partial<EvidenceEdge> = {}): EvidenceEdge {
  return {
    sourceEventId: 'event-1',
    candidatePurchaseId: 'purchase-1',
    evidenceType: 'ORDER_ID_EXACT',
    strength: 'hard',
    score: 100,
    explanation: 'test hard evidence',
    ...overrides,
  };
}

function linked(reasons: EvidenceEdge[]): CorrelationDecision {
  return { kind: 'LINKED', purchaseId: 'purchase-1', reasons };
}

test('authorized merchant order creation is promotion eligible with trusted sender authority', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      eventType: 'order_created',
      sourceRole: 'merchant',
      merchantNamespace: 'sender:shop.example',
      orderIdRaw: 'ORDER-1',
      orderIdNormalized: 'ORDER-1',
      purchaseCreationAuthority: 'authorized',
    }),
    decision: { kind: 'NEW_PURCHASE', reasons: [] },
  });

  assert.equal(result.mode, 'audit_only');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.eligible, true);
  assert.equal(result.action, 'CREATE_PURCHASE');
  assert.deepEqual(result.reasons, ['ELIGIBLE_NEW_PURCHASE']);
});

test('new purchase is blocked when merchant sender authority is not trusted', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      eventType: 'order_created',
      sourceRole: 'merchant',
      merchantNamespace: 'sender:shop.example',
      orderIdRaw: 'ORDER-1',
      orderIdNormalized: 'ORDER-1',
      purchaseCreationAuthority: 'authorized',
      provenance: [],
    }),
    decision: { kind: 'NEW_PURCHASE', reasons: [] },
  });

  assert.equal(result.eligible, false);
  assert.equal(result.action, null);
  assert.ok(result.reasons.includes('NEW_PURCHASE_MERCHANT_SCOPE_UNPROVEN'));
});

test('new purchase is blocked when creation authority is review', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      eventType: 'order_created',
      sourceRole: 'merchant',
      merchantId: 'merchant:shop',
      orderIdRaw: 'ORDER-1',
      purchaseCreationAuthority: 'review',
    }),
    decision: { kind: 'NEW_PURCHASE', reasons: [] },
  });

  assert.equal(result.eligible, false);
  assert.equal(result.action, null);
  assert.ok(result.reasons.includes('NEW_PURCHASE_AUTHORITY_NOT_AUTHORIZED'));
});

test('hard merchant-scoped order link is promotion eligible with trusted sender authority', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      sourceRole: 'merchant',
      merchantId: 'merchant:shop',
      orderIdRaw: 'ORDER-1',
    }),
    decision: linked([edge()]),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.action, 'LINK_EVENT');
  assert.deepEqual(result.reasons, ['ELIGIBLE_HARD_LINK']);
});

test('merchant order link is blocked when visible sender scope is not independently trusted', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      sourceRole: 'merchant',
      merchantId: 'merchant:shop',
      orderIdRaw: 'ORDER-1',
      provenance: [],
    }),
    decision: linked([edge()]),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.action, null);
  assert.ok(result.reasons.includes('LINK_HARD_ORDER_SCOPE_UNPROVEN'));
});

test('raw header provenance cannot impersonate trusted sender authority', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      sourceRole: 'merchant',
      merchantId: 'merchant:shop',
      orderIdRaw: 'ORDER-1',
      provenance: [{
        field: 'sender_authority',
        source: 'header',
        parserVersion: 'raw-auth-results-v1',
        qualifiers: ['trusted_sender_authority'],
      }],
    }),
    decision: linked([edge()]),
  });

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('LINK_HARD_ORDER_SCOPE_UNPROVEN'));
});

test('soft-only link is blocked even if a LINKED decision is supplied', () => {
  const result = evaluatePromotionReadiness({
    event: event({ sourceRole: 'merchant', merchantId: 'merchant:shop', orderIdRaw: 'ORDER-1' }),
    decision: linked([edge({ strength: 'soft', score: 35 })]),
  });

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('LINK_MISSING_HARD_EVIDENCE'));
});

test('review-only decorated alias blocks promotion even beside hard evidence', () => {
  const result = evaluatePromotionReadiness({
    event: event({ sourceRole: 'merchant', merchantId: 'merchant:shop', orderIdRaw: 'ORDER-1' }),
    decision: linked([
      edge(),
      edge({
        evidenceType: 'ORDER_ID_DECORATED_REVIEW_ALIAS',
        strength: 'soft',
        score: 15,
      }),
    ]),
  });

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('REVIEW_ONLY_ALIAS_PRESENT'));
});

test('hard tracking link requires carrier namespace', () => {
  const result = evaluatePromotionReadiness({
    event: event({ trackingIdRaw: 'TRACK-1', carrierId: null, provenance: [] }),
    decision: linked([edge({ evidenceType: 'TRACKING_ID_EXACT' })]),
  });

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('LINK_HARD_TRACKING_SCOPE_UNPROVEN'));
  assert.ok(result.reasons.includes('ATTACHED_TRACKING_SCOPE_UNPROVEN'));
});

test('hard carrier-scoped tracking link does not depend on merchant sender authority', () => {
  const result = evaluatePromotionReadiness({
    event: event({ trackingIdRaw: 'TRACK-1', carrierId: 'carrier:test', provenance: [] }),
    decision: linked([edge({ evidenceType: 'TRACKING_ID_EXACT' })]),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.action, 'LINK_EVENT');
});

test('hard extraction conflict blocks promotion regardless of decision', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      sourceRole: 'merchant',
      merchantId: 'merchant:shop',
      orderIdRaw: 'ORDER-1',
      conflicts: [{
        field: 'order_number',
        values: ['ORDER-1', 'ORDER-2'],
        evidence: [],
        severity: 'hard',
        explanation: 'conflicting hard order ids',
      }],
    }),
    decision: linked([edge()]),
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ['HARD_CONFLICT_PRESENT']);
});

test('REVIEW, PENDING and UNLINKED decisions always remain blocked', () => {
  const base = event();
  const decisions: CorrelationDecision[] = [
    { kind: 'REVIEW', candidatePurchaseIds: ['purchase-1'], reasons: [] },
    { kind: 'PENDING', candidatePurchaseIds: ['purchase-1'], reasons: [], conflicts: [] },
    { kind: 'UNLINKED', reasons: [] },
  ];

  for (const decision of decisions) {
    const result = evaluatePromotionReadiness({ event: base, decision });
    assert.equal(result.eligible, false);
    assert.equal(result.action, null);
  }
});

test('unscoped entity attachment blocks an otherwise hard order link', () => {
  const result = evaluatePromotionReadiness({
    event: event({
      sourceRole: 'merchant',
      merchantId: 'merchant:shop',
      orderIdRaw: 'ORDER-1',
      trackingIdRaw: 'TRACK-1',
      carrierId: null,
    }),
    decision: linked([edge()]),
  });

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('ATTACHED_TRACKING_SCOPE_UNPROVEN'));
});
