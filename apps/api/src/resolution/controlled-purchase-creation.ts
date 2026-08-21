import type { PurchaseResolutionCandidate } from './purchase-resolution.js';

export function selectControlledPurchaseCandidate(
  candidates: PurchaseResolutionCandidate[],
): PurchaseResolutionCandidate {
  const controlledCandidates = candidates.filter(
    (candidate) => candidate.decision === 'create_corroborated',
  );

  if (controlledCandidates.length !== 1) {
    throw new Error(
      `Controlled purchase creation requires exactly one corroborated candidate; found ${controlledCandidates.length}`,
    );
  }

  const candidate = controlledCandidates[0];
  if (!candidate) {
    throw new Error('Controlled purchase candidate is missing');
  }

  if (
    !candidate.userId ||
    !candidate.senderDomain ||
    !candidate.merchant ||
    !candidate.orderNumber
  ) {
    throw new Error('Controlled purchase candidate identity is incomplete');
  }

  if (
    candidate.evidenceCount < 3 ||
    candidate.orderCreatedEvidenceCount < 1 ||
    candidate.corroboratingEvidenceCount < 2
  ) {
    throw new Error('Controlled purchase candidate lacks required corroboration');
  }

  return candidate;
}
