import type {
  CanonicalEvent,
  CorrelationDecision,
  EvidenceEdge,
  EvidenceType,
} from './types.js';

export const PROMOTION_READINESS_V1_VERSION = 'purchase-identity-promotion-readiness-v1';

export type PromotionReadinessAction = 'CREATE_PURCHASE' | 'LINK_EVENT' | null;

export type PromotionReadinessReason =
  | 'NO_CANONICAL_EVENT'
  | 'NO_CORRELATION_DECISION'
  | 'DECISION_REVIEW'
  | 'DECISION_PENDING'
  | 'DECISION_UNLINKED'
  | 'HARD_CONFLICT_PRESENT'
  | 'NEW_PURCHASE_EVENT_NOT_ORDER_CREATED'
  | 'NEW_PURCHASE_MISSING_ORDER_ID'
  | 'NEW_PURCHASE_AUTHORITY_NOT_AUTHORIZED'
  | 'NEW_PURCHASE_MERCHANT_SCOPE_UNPROVEN'
  | 'NEW_PURCHASE_EXPLICIT_RELATION_PRESENT'
  | 'LINK_MISSING_HARD_EVIDENCE'
  | 'LINK_HARD_EVIDENCE_TARGET_MISMATCH'
  | 'LINK_UNSUPPORTED_HARD_EVIDENCE'
  | 'LINK_HARD_ORDER_SCOPE_UNPROVEN'
  | 'LINK_HARD_TRACKING_SCOPE_UNPROVEN'
  | 'LINK_HARD_PAYMENT_SCOPE_UNPROVEN'
  | 'LINK_HARD_INVOICE_SCOPE_UNPROVEN'
  | 'LINK_HARD_PARENT_CHILD_SCOPE_UNPROVEN'
  | 'REVIEW_ONLY_ALIAS_PRESENT'
  | 'ATTACHED_TRACKING_SCOPE_UNPROVEN'
  | 'ATTACHED_PAYMENT_SCOPE_UNPROVEN'
  | 'ATTACHED_INVOICE_SCOPE_UNPROVEN'
  | 'ELIGIBLE_NEW_PURCHASE'
  | 'ELIGIBLE_HARD_LINK';

export interface PromotionReadinessDecision {
  version: typeof PROMOTION_READINESS_V1_VERSION;
  mode: 'audit_only';
  productionWrites: 0;
  eligible: boolean;
  action: PromotionReadinessAction;
  reasons: PromotionReadinessReason[];
}

const SUPPORTED_HARD_LINK_EVIDENCE = new Set<EvidenceType>([
  'ORDER_ID_EXACT',
  'TRACKING_ID_EXACT',
  'PAYMENT_REFERENCE_EXACT',
  'INVOICE_ORDER_ID_EXACT',
  'PARENT_CHILD_ORDER',
]);

function result(
  eligible: boolean,
  action: PromotionReadinessAction,
  reasons: PromotionReadinessReason[],
): PromotionReadinessDecision {
  return {
    version: PROMOTION_READINESS_V1_VERSION,
    mode: 'audit_only',
    productionWrites: 0,
    eligible,
    action: eligible ? action : null,
    reasons: [...new Set(reasons)],
  };
}

function hasMerchantScope(event: CanonicalEvent): boolean {
  return event.sourceRole === 'merchant' && Boolean(event.merchantId || event.merchantNamespace);
}

function attachmentScopeReasons(event: CanonicalEvent): PromotionReadinessReason[] {
  const reasons: PromotionReadinessReason[] = [];
  const trackingId = event.trackingIdNormalized ?? event.trackingIdRaw;
  const invoiceId = event.invoiceIdNormalized ?? event.invoiceIdRaw;

  if (trackingId && !event.carrierId) reasons.push('ATTACHED_TRACKING_SCOPE_UNPROVEN');
  if (event.paymentReference && !event.paymentProviderId) reasons.push('ATTACHED_PAYMENT_SCOPE_UNPROVEN');
  if ((invoiceId || event.eventType === 'invoice_created') && !event.invoiceIssuerId) {
    reasons.push('ATTACHED_INVOICE_SCOPE_UNPROVEN');
  }

  return reasons;
}

function hardEvidenceScopeReason(
  event: CanonicalEvent,
  edge: EvidenceEdge,
): PromotionReadinessReason | null {
  if (!SUPPORTED_HARD_LINK_EVIDENCE.has(edge.evidenceType)) return 'LINK_UNSUPPORTED_HARD_EVIDENCE';

  switch (edge.evidenceType) {
    case 'ORDER_ID_EXACT':
      return hasMerchantScope(event) ? null : 'LINK_HARD_ORDER_SCOPE_UNPROVEN';
    case 'TRACKING_ID_EXACT':
      return event.carrierId ? null : 'LINK_HARD_TRACKING_SCOPE_UNPROVEN';
    case 'PAYMENT_REFERENCE_EXACT':
      return event.paymentProviderId ? null : 'LINK_HARD_PAYMENT_SCOPE_UNPROVEN';
    case 'INVOICE_ORDER_ID_EXACT':
      return event.invoiceIssuerId || hasMerchantScope(event) ? null : 'LINK_HARD_INVOICE_SCOPE_UNPROVEN';
    case 'PARENT_CHILD_ORDER':
      return event.orderRelation
        && event.orderRelation.provenance.length > 0
        && hasMerchantScope(event)
        ? null
        : 'LINK_HARD_PARENT_CHILD_SCOPE_UNPROVEN';
    default:
      return 'LINK_UNSUPPORTED_HARD_EVIDENCE';
  }
}

/**
 * Phase E audit-only gate.
 *
 * This function never performs a write. It answers a narrower question than
 * correlation: whether the already-produced Identity Graph v2 decision is
 * sufficiently scoped and conflict-free to be considered for a future
 * controlled-write path. Any uncertainty fails closed.
 */
export function evaluatePromotionReadiness(input: {
  event: CanonicalEvent | null;
  decision: CorrelationDecision | null;
}): PromotionReadinessDecision {
  const { event, decision } = input;
  if (!event) return result(false, null, ['NO_CANONICAL_EVENT']);
  if (!decision) return result(false, null, ['NO_CORRELATION_DECISION']);

  if (event.conflicts?.some((conflict) => conflict.severity === 'hard')) {
    return result(false, null, ['HARD_CONFLICT_PRESENT']);
  }

  if (decision.kind === 'REVIEW') return result(false, null, ['DECISION_REVIEW']);
  if (decision.kind === 'PENDING') return result(false, null, ['DECISION_PENDING']);
  if (decision.kind === 'UNLINKED') return result(false, null, ['DECISION_UNLINKED']);

  const attachedScopeReasons = attachmentScopeReasons(event);

  if (decision.kind === 'NEW_PURCHASE') {
    const reasons: PromotionReadinessReason[] = [...attachedScopeReasons];
    if (event.eventType !== 'order_created') reasons.push('NEW_PURCHASE_EVENT_NOT_ORDER_CREATED');
    if (!(event.orderIdNormalized ?? event.orderIdRaw)) reasons.push('NEW_PURCHASE_MISSING_ORDER_ID');
    if (event.purchaseCreationAuthority !== 'authorized') reasons.push('NEW_PURCHASE_AUTHORITY_NOT_AUTHORIZED');
    if (!hasMerchantScope(event)) reasons.push('NEW_PURCHASE_MERCHANT_SCOPE_UNPROVEN');
    if (event.orderRelation) reasons.push('NEW_PURCHASE_EXPLICIT_RELATION_PRESENT');

    if (reasons.length > 0) return result(false, null, reasons);
    return result(true, 'CREATE_PURCHASE', ['ELIGIBLE_NEW_PURCHASE']);
  }

  const hardReasons = decision.reasons.filter((edge) => edge.strength === 'hard');
  const reasons: PromotionReadinessReason[] = [...attachedScopeReasons];

  if (hardReasons.length === 0) reasons.push('LINK_MISSING_HARD_EVIDENCE');
  if (decision.reasons.some((edge) => edge.evidenceType === 'ORDER_ID_DECORATED_REVIEW_ALIAS')) {
    reasons.push('REVIEW_ONLY_ALIAS_PRESENT');
  }
  if (hardReasons.some((edge) => edge.candidatePurchaseId !== decision.purchaseId)) {
    reasons.push('LINK_HARD_EVIDENCE_TARGET_MISMATCH');
  }

  for (const edge of hardReasons) {
    const scopeReason = hardEvidenceScopeReason(event, edge);
    if (scopeReason) reasons.push(scopeReason);
  }

  if (reasons.length > 0) return result(false, null, reasons);
  return result(true, 'LINK_EVENT', ['ELIGIBLE_HARD_LINK']);
}
