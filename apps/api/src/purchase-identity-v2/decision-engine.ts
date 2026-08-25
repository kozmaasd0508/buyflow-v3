import type { CanonicalEvent, CorrelationDecision, EvidenceEdge, PurchaseIdentitySnapshot } from './types.js';
import { buildCandidateIndex, candidatePurchaseIds } from './candidate-index.js';
import { buildEvidenceForCandidate } from './evidence.js';
import { evaluateHardConflictGate } from './hard-conflict-gate.js';

function hardEdges(edges: EvidenceEdge[]) {
  return edges.filter((edge) => edge.strength === 'hard');
}

function onlyUnscopedOrderDiscovery(edges: EvidenceEdge[]): boolean {
  return edges.length > 0 && edges.every((edge) =>
    edge.strength === 'soft' && edge.evidenceType === 'ORDER_ID_EXACT'
  );
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

  // An explicit parent/child relation must never override another candidate for
  // the same event. If the child id, tracking id or another hard/soft identifier
  // points elsewhere, keep the event in REVIEW instead of mutating the graph.
  if (event.orderRelation && hardCandidateIds.length === 1) {
    const hardPurchaseId = hardCandidateIds[0]!;
    const otherCandidates = candidates.filter((purchaseId) => purchaseId !== hardPurchaseId);
    if (otherCandidates.length > 0) {
      return {
        kind: 'REVIEW',
        candidatePurchaseIds: candidates.sort(),
        reasons: candidates.flatMap((purchaseId) => evidenceByPurchase.get(purchaseId) ?? []),
      };
    }
  }

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

  const knownMerchantCreationAuthorized = Boolean(event.merchantId);
  const unknownMerchantCreationAuthorized =
    event.sourceRole === 'merchant' &&
    Boolean(event.merchantNamespace) &&
    event.purchaseCreationAuthority === 'authorized';

  const hasSafeNewPurchaseAnchor =
    !event.orderRelation &&
    event.eventType === 'order_created' &&
    Boolean(event.orderIdNormalized ?? event.orderIdRaw) &&
    (knownMerchantCreationAuthorized || unknownMerchantCreationAuthorized);

  const onlySameNumberOtherNamespaces =
    candidates.length > 0 &&
    candidates.every((purchaseId) => onlyUnscopedOrderDiscovery(evidenceByPurchase.get(purchaseId) ?? []));

  if (hasSafeNewPurchaseAnchor && (candidates.length === 0 || onlySameNumberOtherNamespaces)) {
    return { kind: 'NEW_PURCHASE', reasons: [] };
  }

  if (event.eventType === 'order_created' && event.purchaseCreationAuthority === 'review') {
    return {
      kind: 'REVIEW',
      candidatePurchaseIds: candidates.sort(),
      reasons: candidates.flatMap((purchaseId) => evidenceByPurchase.get(purchaseId) ?? []),
    };
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
