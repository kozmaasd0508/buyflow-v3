import type { DocumentResolutionCandidate } from '../resolution/document-resolution.js';
import type { PurchaseResolutionCandidate } from '../resolution/purchase-resolution.js';
import type { ShipmentResolutionCandidate } from '../resolution/shipment-resolution.js';

const TRUSTED_VALIDATION_STATUSES = new Set(['validated', 'guardrailed']);

export function isTrustedAutomaticEvidence(
  validationStatus: unknown,
  validatedResult: Record<string, unknown> | null,
): boolean {
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
): boolean {
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
): boolean {
  return (
    candidate.decision === 'linkable' &&
    Boolean(candidate.purchaseId) &&
    Boolean(candidate.trackingNumber) &&
    Boolean(candidate.carrierSlug) &&
    candidate.evidenceCount >= 3 &&
    candidate.merchantAnchorCount >= 1 &&
    candidate.carrierEvidenceCount >= 2
  );
}

export function canAutomaticallyWriteDocument(
  candidate: DocumentResolutionCandidate,
): boolean {
  return (
    candidate.decision === 'linkable' &&
    Boolean(candidate.purchaseId) &&
    candidate.documentType === 'invoice' &&
    candidate.confidence >= 0.85
  );
}
