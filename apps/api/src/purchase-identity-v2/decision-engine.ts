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

  // Existing identity always wins before considering new-Purchase authority.
  // The semantic lifecycle label therefore cannot fork a second Purchase when
  // hard evidence already points to exactly one existing Purchase.
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

  // Purchase-root authority is a separate deterministic channel from the
  // primary lifecycle event. ORDER_PROCESSING/ORDER_PACKING may be the current
  // state of the very first merchant email while the same message independently
  // proves the order root. AI semantics alone cannot authorize creation because
  // purchaseCreationAuthority must already be `authorized` upstream.
  const knownMerchantCreationAuthorized =
    Boolean(event.merchantId) && event.purchaseCreationAuthority === 'authorized';
  const unknownMerchantCreationAuthorized =
    event.sourceRole === 'merchant' &&
    Boolean(event.merchantNamespace) &&
    event.purchaseCreationAuthority === 'authorized';

  const hasSafeNewPurchaseAnchor =
    !event.orderRelation &&
    Boolean(event.orderIdNormalized ?? event.orderIdRaw) &&
    (knownMerchantCreationAuthorized || unknownMerchantCreationAuthorized);

  const onlySameNumberOtherNamespaces =
    candidates.length > 0 &&
    candidates.every((purchaseId) => onlyUnscopedOrderDiscovery(evidenceByPurchase.get(purchaseId) ?? []));

  if (hasSafeNewPurchaseAnchor && (candidates.length === 0 || onlySameNumberOtherNamespaces)) {
    return { kind: 'NEW_PURCHASE', reasons: [] };
  }

  // REVIEW purchase-root authority is fail-closed regardless of the primary
  // lifecycle event. Hard linking above still takes precedence for an already
  // known Purchase, so a disclaimer cannot break a proven existing identity.
  if (event.purchaseCreationAuthority === 'review') {
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
