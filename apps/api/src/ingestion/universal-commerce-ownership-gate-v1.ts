import type { EmailDocumentV1 } from './email-document.js';
import type { UniversalCommerceObservationV11 } from './universal-commerce-composition-v1-1.js';

export const UNIVERSAL_COMMERCE_OWNERSHIP_GATE_V1_VERSION = 'universal-commerce-ownership-gate-v1';

export type PurchaseAuthorityV1 = 'create' | 'attach' | 'review' | 'none';

export interface UniversalCommerceOwnershipDecisionV1 {
  version: typeof UNIVERSAL_COMMERCE_OWNERSHIP_GATE_V1_VERSION;
  lifecycle: UniversalCommerceObservationV11['lifecycle'];
  semanticDecision: UniversalCommerceObservationV11['decision'];
  purchaseAuthority: PurchaseAuthorityV1;
  reasons: string[];
  canCreatePurchase: boolean;
  canAttachToPurchase: boolean;
}

const PUBLIC_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
]);

function hasCommerceStructure(document: EmailDocumentV1): boolean {
  return [
    document.sections.some((section) => section.type === 'order_summary'),
    document.signals.products.length > 0,
    document.signals.amounts.length > 0,
    document.signals.paymentMethods.length > 0,
    document.signals.shippingMethods.length > 0,
  ].filter(Boolean).length >= 2;
}

function decision(
  observation: UniversalCommerceObservationV11,
  purchaseAuthority: PurchaseAuthorityV1,
  reasons: string[],
): UniversalCommerceOwnershipDecisionV1 {
  return {
    version: UNIVERSAL_COMMERCE_OWNERSHIP_GATE_V1_VERSION,
    lifecycle: observation.lifecycle,
    semanticDecision: observation.decision,
    purchaseAuthority,
    reasons: [...new Set(reasons)],
    canCreatePurchase: purchaseAuthority === 'create',
    canAttachToPurchase: purchaseAuthority === 'attach' || purchaseAuthority === 'create',
  };
}

/**
 * Semantic truth and Purchase ownership are deliberately separate.
 * A real invoice/payment/shipment can be recognized while still having no
 * authority to create or mutate a Purchase until a hard purchase anchor exists.
 */
export function evaluateUniversalCommerceOwnershipV1(
  document: EmailDocumentV1,
  observation: UniversalCommerceObservationV11,
): UniversalCommerceOwnershipDecisionV1 {
  if (observation.decision === 'blocked' || observation.lifecycle === 'unknown') {
    return decision(observation, 'none', ['semantic_event_not_authoritative']);
  }

  if (observation.decision === 'review') {
    return decision(observation, 'review', ['semantic_event_requires_review']);
  }

  const hasOrderIdentity = document.signals.orderNumbers.length > 0;
  const hasTrackingIdentity = document.signals.trackingNumbers.length > 0;
  const senderDomain = document.sender.primaryDomain?.toLowerCase() ?? null;
  const senderIsPublicMailbox = senderDomain ? PUBLIC_MAILBOX_DOMAINS.has(senderDomain) : true;

  if (observation.lifecycle === 'order_created') {
    if (!hasOrderIdentity) {
      return decision(observation, 'review', ['missing_hard_order_identity']);
    }
    if (!hasCommerceStructure(document)) {
      return decision(observation, 'review', ['insufficient_independent_commerce_structure']);
    }
    if (senderIsPublicMailbox) {
      return decision(observation, 'review', ['public_or_unknown_sender_domain']);
    }
    return decision(observation, 'create', [
      'hard_order_identity',
      'independent_commerce_structure',
      'merchant_owned_sender_candidate',
    ]);
  }

  if (['shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(observation.lifecycle)) {
    if (hasTrackingIdentity || hasOrderIdentity) {
      return decision(observation, 'attach', [
        hasTrackingIdentity ? 'hard_tracking_identity' : 'hard_order_identity',
        'lifecycle_cannot_create_purchase',
      ]);
    }
    return decision(observation, 'review', ['lifecycle_without_hard_purchase_anchor']);
  }

  if (['order_processing', 'order_cancelled'].includes(observation.lifecycle)) {
    if (hasOrderIdentity) {
      return decision(observation, 'attach', ['hard_order_identity', 'lifecycle_cannot_create_purchase']);
    }
    return decision(observation, 'review', ['order_lifecycle_without_hard_order_identity']);
  }

  if (['invoice', 'payment_completed', 'payment_issue', 'refund'].includes(observation.lifecycle)) {
    if (hasOrderIdentity) {
      return decision(observation, 'attach', ['hard_order_identity', 'document_or_payment_cannot_create_purchase']);
    }
    return decision(observation, 'review', [
      'semantic_event_valid_but_purchase_ownership_unproven',
      'missing_hard_order_identity',
    ]);
  }

  if (observation.lifecycle === 'return') {
    if (hasOrderIdentity || hasTrackingIdentity) {
      return decision(observation, 'attach', [
        hasOrderIdentity ? 'hard_order_identity' : 'hard_tracking_identity',
        'return_cannot_create_purchase',
      ]);
    }
    return decision(observation, 'review', ['return_without_hard_purchase_anchor']);
  }

  return decision(observation, 'review', ['unhandled_purchase_ownership_case']);
}
