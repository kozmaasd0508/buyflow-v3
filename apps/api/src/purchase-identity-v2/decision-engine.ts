import type { CanonicalEvent, CorrelationDecision, EvidenceEdge, PurchaseIdentitySnapshot } from './types.js';
import { buildCandidateIndex, candidatePurchaseIds } from './candidate-index.js';
import { buildEvidenceForCandidate } from './evidence.js';
import { evaluateHardConflictGate } from './hard-conflict-gate.js';

function hardEdges(edges: EvidenceEdge[]) {
  return edges.filter((edge) => edge.strength === 'hard');
}

export function decideCorrelation(
  event: CanonicalEvent,
  snapshot: PurchaseIdentitySnapshot,
): CorrelationDecision {
  const index = buildCandidateIndex(snapshot);
  const candidates = [...candidatePurchaseIds(event, index)];
  const evidenceByPurchase = new Map<string, EvidenceEdge[]>();

  for (const purchaseId of candidates) {
    evidenceByPurchase.set(purchaseId, buildEvidenceForCandidate(event, purchaseId, snapshot));
  }

  const conflictGate = evaluateHardConflictGate(event);
  if (conflictGate.blocked) {
    return {
      kind: 'PENDING',
      candidatePurchaseIds: candidates.sort(),
      reasons: candidates.flatMap((purchaseId) => evidenceByPurchase.get(purchaseId) ?? []),
      conflicts: conflictGate.conflicts,
    };
  }

  const hardCandidateIds = candidates.filter((purchaseId) => hardEdges(evidenceByPurchase.get(purchaseId) ?? []).length > 0);

  if (hardCandidateIds.length === 1) {
    const purchaseId = hardCandidateIds[0]!;
    return {
      kind: 'LINKED',
      purchaseId,
      reasons: evidenceByPurchase.get(purchaseId) ?? [],
    };
  }

  if (hardCandidateIds.length > 1) {
    return {
      kind: 'REVIEW',
      candidatePurchaseIds: hardCandidateIds.sort(),
      reasons: hardCandidateIds.flatMap((purchaseId) => evidenceByPurchase.get(purchaseId) ?? []),
    };
  }

  const hasSafeNewPurchaseAnchor =
    event.eventType === 'order_created' &&
    Boolean(event.orderIdNormalized ?? event.orderIdRaw) &&
    Boolean(event.merchantId);

  if (hasSafeNewPurchaseAnchor && candidates.length === 0) {
    return { kind: 'NEW_PURCHASE', reasons: [] };
  }

  if (candidates.length > 0) {
    return {
      kind: 'REVIEW',
      candidatePurchaseIds: candidates.sort(),
      reasons: candidates.flatMap((purchaseId) => evidenceByPurchase.get(purchaseId) ?? []),
    };
  }

  return { kind: 'UNLINKED', reasons: [] };
}
