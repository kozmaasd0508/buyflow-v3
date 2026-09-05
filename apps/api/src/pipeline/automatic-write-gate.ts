import type { DocumentResolutionCandidate } from '../resolution/document-resolution.js';
import type { PurchaseResolutionCandidate } from '../resolution/purchase-resolution.js';
import type { ShipmentResolutionCandidate } from '../resolution/shipment-resolution.js';

const TRUSTED_VALIDATION_STATUSES = new Set(['validated', 'guardrailed']);
const SHADOW_ONLY_PARSER_VERSION_PATTERNS = [
  /^generic-order-confirmation-v\d+(?:\.\d+)*$/,
  /^generic-lifecycle-v\d+(?:\.\d+)*$/,
  /^generic-commerce-v\d+(?:\.\d+)*-shadow$/,
  /^provider-lifecycle-v\d+(?:\.\d+)*-shadow$/,
] as const;

// The legacy automatic Purchase/payment lane predates the current TrustLink
// trusted-sender authority contract. It must remain fail-closed until a new
// Core write contract can prove the same authority at the database boundary.
export const LEGACY_CORE_PURCHASE_WRITES_ENABLED = false;

type WritablePurchaseCandidate = PurchaseResolutionCandidate & {
  userId: string;
  senderDomain: string;
  merchant: string;
  orderNumber: string;
  decision: 'create_direct' | 'create_corroborated';
};

type WritableShipmentCandidate = ShipmentResolutionCandidate & {
  purchaseId: string;
  trackingNumber: string;
  carrierSlug: string;
  decision: 'linkable';
  recommendedStatus: 'in_transit' | 'delivered';
};

type WritableDocumentCandidate = DocumentResolutionCandidate & {
  purchaseId: string;
  documentType: 'invoice';
  decision: 'linkable';
};

export function isShadowOnlyParserVersion(value: unknown): boolean {
  return typeof value === 'string' && SHADOW_ONLY_PARSER_VERSION_PATTERNS.some(
    (pattern) => pattern.test(value),
  );
}

export function isTrustedAutomaticEvidence(
  validationStatus: unknown,
  validatedResult: Record<string, unknown> | null,
): boolean {
  if (isShadowOnlyParserVersion(validatedResult?.parser_version)) {
    return false;
  }

  // Payment evidence previously fed a legacy Core mutator that accepted
  // caller-supplied financial JSON. Keep that automatic lane disabled rather
  // than allowing a validated source to become a bearer token for arbitrary
  // Purchase financial changes.
  if (
    validatedResult?.event_type === 'payment_completed' &&
    !LEGACY_CORE_PURCHASE_WRITES_ENABLED
  ) {
    return false;
  }

  const nestedStatus = validatedResult?.validation_status;
  const effectiveStatus =
    typeof nestedStatus === 'string'
      ? nestedStatus
      : typeof validationStatus === 'string'
        ? validationStatus
        : null;

  return effectiveStatus !== null && TRUSTED_VALIDATION_STATUSES.has(effectiveStatus);
}

export function canAutomaticallyWritePurchase(
  candidate: PurchaseResolutionCandidate,
): candidate is WritablePurchaseCandidate {
  if (!LEGACY_CORE_PURCHASE_WRITES_ENABLED) {
    return false;
  }

  if (
    !candidate.userId ||
    !candidate.senderDomain ||
    !candidate.merchant ||
    !candidate.orderNumber ||
    candidate.orderCreatedEvidenceCount < 1
  ) {
    return false;
  }

  if (candidate.decision === 'create_direct') {
    return candidate.confidence >= 0.9;
  }

  if (candidate.decision === 'create_corroborated') {
    return (
      candidate.confidence >= 0.88 &&
      candidate.evidenceCount >= 3 &&
      candidate.corroboratingEvidenceCount >= 2
    );
  }

  return false;
}

export function canAutomaticallyWriteShipment(
  candidate: ShipmentResolutionCandidate,
): candidate is WritableShipmentCandidate {
  return (
    candidate.decision === 'linkable' &&
    Boolean(candidate.purchaseId) &&
    Boolean(candidate.trackingNumber) &&
    Boolean(candidate.carrierSlug) &&
    candidate.recommendedStatus !== 'shipment_created' &&
    candidate.physicalShipmentEvidenceCount >= 1 &&
    candidate.evidenceCount >= 3 &&
    candidate.merchantAnchorCount >= 1 &&
    candidate.carrierEvidenceCount >= 2
  );
}

export function canAutomaticallyWriteDocument(
  candidate: DocumentResolutionCandidate,
): candidate is WritableDocumentCandidate {
  return (
    candidate.decision === 'linkable' &&
    Boolean(candidate.purchaseId) &&
    candidate.documentType === 'invoice' &&
    candidate.confidence >= 0.85
  );
}
