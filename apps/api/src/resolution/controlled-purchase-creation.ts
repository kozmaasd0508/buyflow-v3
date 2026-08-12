import type { PurchaseResolutionCandidate } from './purchase-resolution.js';

export function selectControlledPurchaseCandidate(
  candidates: PurchaseResolutionCandidate[],
): PurchaseResolutionCandidate {
  const createCandidates = candidates.filter(
    (candidate) =>
      candidate.decision === 'create_direct' ||
      candidate.decision === 'create_corroborated',
  );

  if (createCandidates.length !== 1) {
    throw new Error(
      `Controlled purchase creation requires exactly one create candidate; found ${createCandidates.length}`,
    );
  }

  const candidate = createCandidates[0];
  if (!candidate) {
    throw new Error('Controlled purchase candidate is missing');
  }

  if (candidate.decision !== 'create_corroborated') {
    throw new Error('First controlled purchase must be corroborated');
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
