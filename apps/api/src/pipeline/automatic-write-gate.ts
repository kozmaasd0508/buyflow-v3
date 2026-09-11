import type { DocumentResolutionCandidate } from '../resolution/document-resolution.js';
import type { PurchaseResolutionCandidate } from '../resolution/purchase-resolution.js';
import type { ShipmentResolutionCandidate } from '../resolution/shipment-resolution.js';

const TRUSTED_VALIDATION_STATUSES = new Set(['validated', 'guardrailed']);
const SHADOW_ONLY_PARSER_VERSION_PATTERNS = [
  /^generic-order-confirmation-v\d+(?:\.\d+)*$/,
  /^generic-lifecycle-v\d+(?:\.\d+)*$/,
] as const;

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

// Old AI V2 rows have original_event_type but no deterministic provenance.
// Fail closed for these rows too: an old observation must not gain authority
// merely because it predates the durable shadow marker.
export function isObservationOnlyEvidence(result: Record<string, unknown> | null): boolean {
  return Boolean(result && (
    result.shadow_only === true
    || result.would_write === false
    || result.extraction_source === 'ai'
    || result.extraction_source === 'ai_shadow'
    || isShadowOnlyParserVersion(result.parser_version)
    || (typeof result.original_event_type === 'string'
      && !result.parser_version && !result.extraction_source)
  ));
}

export function automaticValidationStatus(
  validationStatus: unknown,
  result: Record<string, unknown> | null,
): string | null {
  if (isObservationOnlyEvidence(result)) return 'review';
  return typeof result?.validation_status === 'string'
    ? result.validation_status
    : typeof validationStatus === 'string' ? validationStatus : null;
}

export function asAiObservation<T extends Record<string, unknown>>(result: T) {
  return {
    ...result,
    extraction_source: 'ai_shadow',
    shadow_only: true,
    would_write: false,
    semantic_validation_status: result.validation_status ?? null,
    validation_status: 'review',
    eligible_for_purchase_creation: false,
  };
}

export function isTrustedAutomaticEvidence(
  validationStatus: unknown,
  validatedResult: Record<string, unknown> | null,
): boolean {
  const status = automaticValidationStatus(validationStatus, validatedResult);
  return status !== null && TRUSTED_VALIDATION_STATUSES.has(status);
}

export function canAutomaticallyWritePurchase(
  candidate: PurchaseResolutionCandidate,
): candidate is WritablePurchaseCandidate {
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
