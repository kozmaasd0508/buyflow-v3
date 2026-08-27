from pathlib import Path
import sys

v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')
source = v7.read_text()

import_anchor = "import { PurchaseIdentityGraph } from '../purchase-identity-v2/graph.js';\n"
import_addition = "import { DeferredResolutionGraph } from '../purchase-identity-v2/deferred-resolution-graph.js';\nimport type { UnresolvedEventPoolSnapshot } from '../purchase-identity-v2/unresolved-event-pool.js';\n"

function_anchor = "\nfunction addUsage(target: { input: number; output: number; cached: number; calls: number }, result: OpenAIEmailExtractionResult): void {"
report_anchor = "\n  const aiReport = {"
hybrid_report_anchor = "    hybrid: hybridScore,\n"
safety_anchor = "  if (lunaScore.unsafeCount > 0 || hybridScore.unsafeCount > 0) {\n    throw new Error('unsafe_v7_ai_score');\n  }"

for anchor, name in [
    (import_anchor, 'import'),
    (function_anchor, 'function'),
    (report_anchor, 'report'),
    (hybrid_report_anchor, 'hybrid_report'),
    (safety_anchor, 'safety'),
]:
    if anchor not in source:
        raise SystemExit(f'v7_deferred_{name}_anchor_missing')

if '--check' in sys.argv:
    print('v7_deferred_recovery_benchmark_patch_check_ok')
    raise SystemExit(0)

if import_addition not in source:
    source = source.replace(import_anchor, import_anchor + import_addition, 1)

deferred_function = r'''

type DeferredLaneScore = LaneScore & {
  deferredStoredEvents: number;
  deferredRecoveredEvents: number;
  deferredMovedToReviewEvents: number;
  journeysWithDeferredRecovery: number;
  wrongDeferredLinks: number;
  unresolvedRemaining: number;
};

/**
 * Supplemental lane for measuring delayed exact-identity recovery without
 * changing the historical baseline/luna/hybrid score definitions.
 *
 * Primary CREATE/LINK counters intentionally remain separate from recovered
 * events. A recovered event is counted only after the current trigger itself is
 * promotion-eligible, and every recovered purchase link is checked against the
 * frozen journey ownership map. Only aggregate counts leave this function.
 */
function replayDeferredLane(input: {
  lane: string;
  ordered: NormalizedEmail[];
  messageOwners: Map<string, Set<string>>;
  extractions: Map<string, ExtractionEngineV2Result>;
  journeys: RootChain[];
}): DeferredLaneScore {
  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let snapshot = emptySnapshot();
  let unresolvedSnapshot: UnresolvedEventPoolSnapshot = { version: 1, records: [] };
  const purchaseOwner = new Map<string, string>();
  const chainPurchase = new Map<string, string>();
  const chainsWithLinks = new Set<string>();
  const chainsWithDeferredRecovery = new Set<string>();
  const decisionCounts: Record<string, number> = {};
  const eventCounts: Record<string, number> = {};
  const promotionReasonCounts: Record<string, number> = {};
  let automaticCreates = 0;
  let automaticLinks = 0;
  let blocked = 0;
  let wrongAutomaticLinks = 0;
  let duplicateCreates = 0;
  let nonAcceptanceCreates = 0;
  let deferredStoredEvents = 0;
  let deferredRecoveredEvents = 0;
  let deferredMovedToReviewEvents = 0;
  let wrongDeferredLinks = 0;
  let unsafeCount = 0;

  for (const email of input.ordered) {
    const owners = input.messageOwners.get(email.providerMessageId) ?? new Set<string>();
    const document = buildEmailDocumentV1(email);
    const extraction = input.extractions.get(email.providerMessageId);
    if (!extraction) throw new Error('deferred_lane_extraction_missing:' + input.lane);
    const before = snapshot;
    const graph = new DeferredResolutionGraph(snapshot, unresolvedSnapshot);
    const canonicalEvent = canonicalEventFromExtractionV2({
      userId: 'phase-e-100-v7-private-user',
      document,
      extraction,
      merchantResolver,
    });

    if (!canonicalEvent) {
      inc(decisionCounts, undefined);
      inc(eventCounts, undefined);
      inc(promotionReasonCounts, 'NO_CANONICAL_EVENT');
      blocked += 1;
      continue;
    }

    canonicalEvent.merchantNamespace = deriveMerchantSenderNamespace(canonicalEvent);
    const creationAuthority = evaluatePurchaseCreationAuthority({
      document,
      eventType: canonicalEvent.eventType,
      sourceRole: canonicalEvent.sourceRole ?? 'unknown',
      orderId: canonicalEvent.orderIdNormalized ?? canonicalEvent.orderIdRaw,
    });
    canonicalEvent.purchaseCreationAuthority = creationAuthority.authority;
    canonicalEvent.purchaseCreationReasons = creationAuthority.reasons;

    const applied = graph.applyEvent(canonicalEvent);
    const decision = applied.decision;
    const promotionReadiness = evaluatePromotionReadiness({ event: canonicalEvent, decision });
    const eligible = promotionReadiness.eligible;
    const action = promotionReadiness.action;
    inc(decisionCounts, decision.kind);
    inc(eventCounts, canonicalEvent.eventType);
    for (const reason of promotionReadiness.reasons) inc(promotionReasonCounts, reason);

    if (decision.kind === 'LINKED') {
      const owner = purchaseOwner.get(decision.purchaseId);
      if (!owner || !owners.has(owner)) {
        wrongAutomaticLinks += 1;
        unsafeCount += 1;
      }
    }

    if (eligible && action === 'CREATE_PURCHASE') {
      automaticCreates += 1;
      if (owners.size !== 1) {
        unsafeCount += 1;
      } else {
        const chainId = [...owners][0]!;
        if (explicitNonAcceptance(document)) {
          nonAcceptanceCreates += 1;
          unsafeCount += 1;
        }
        if (chainPurchase.has(chainId)) {
          duplicateCreates += 1;
          unsafeCount += 1;
        }
      }
    } else if (eligible && action === 'LINK_EVENT') {
      automaticLinks += 1;
    } else {
      blocked += 1;
    }

    const acceptedMutation = eligible && (applied.mutated || applied.recoveredEventIds.length > 0);
    if (acceptedMutation) {
      snapshot = applied.snapshot;
      if (action === 'CREATE_PURCHASE') {
        const beforeIds = new Set(before.purchases.map((purchase) => purchase.purchaseId));
        const added = snapshot.purchases.filter((purchase) => !beforeIds.has(purchase.purchaseId));
        if (added.length !== 1 || owners.size !== 1) {
          unsafeCount += 1;
        } else {
          const chainId = [...owners][0]!;
          purchaseOwner.set(added[0]!.purchaseId, chainId);
          if (!chainPurchase.has(chainId)) chainPurchase.set(chainId, added[0]!.purchaseId);
        }
      }
      if (action === 'LINK_EVENT' && decision.kind === 'LINKED') {
        const owner = purchaseOwner.get(decision.purchaseId);
        if (owner && owners.has(owner)) chainsWithLinks.add(owner);
      }
    }

    if (decision.kind === 'UNLINKED' && applied.unresolvedStored) {
      // Persisting an orphan is not a Purchase graph write. It mirrors the
      // existing durable source_emails/unlinked state used by the real shadow.
      unresolvedSnapshot = graph.unresolvedSnapshot();
      deferredStoredEvents += 1;
    } else if (acceptedMutation) {
      unresolvedSnapshot = graph.unresolvedSnapshot();
      deferredRecoveredEvents += applied.recoveredEventIds.length;
      deferredMovedToReviewEvents += applied.movedToReviewEventIds.length;

      // Check delayed links against frozen journey ownership after current
      // purchase ownership has been recorded. Raw ids are never logged.
      for (const recoveredEventId of applied.recoveredEventIds) {
        const record = unresolvedSnapshot.records.find((candidate) => candidate.eventId === recoveredEventId);
        const resolvedPurchaseId = record?.status === 'resolved' ? record.resolvedPurchaseId : null;
        const owner = resolvedPurchaseId ? purchaseOwner.get(resolvedPurchaseId) : undefined;
        const eventOwners = record
          ? input.messageOwners.get(record.event.sourceMessageId) ?? new Set<string>()
          : new Set<string>();
        if (!owner || !eventOwners.has(owner)) {
          wrongDeferredLinks += 1;
          unsafeCount += 1;
        } else {
          chainsWithDeferredRecovery.add(owner);
        }
      }
    }
  }

  return {
    lane: input.lane,
    journeys: input.journeys.length,
    discoveredMessages: input.ordered.length,
    automaticCreates,
    automaticLinks,
    blocked,
    journeysWithPurchase: chainPurchase.size,
    journeysWithAutomaticLifecycleLinks: chainsWithLinks.size,
    wrongAutomaticLinks,
    duplicateCreates,
    nonAcceptanceCreates,
    decisionCounts,
    eventCounts,
    promotionReasonCounts,
    deferredStoredEvents,
    deferredRecoveredEvents,
    deferredMovedToReviewEvents,
    journeysWithDeferredRecovery: chainsWithDeferredRecovery.size,
    wrongDeferredLinks,
    unresolvedRemaining: unresolvedSnapshot.records.filter((record) => record.status === 'unresolved').length,
    unsafeCount,
  };
}
'''

if 'function replayDeferredLane(' not in source:
    source = source.replace(function_anchor, deferred_function + function_anchor, 1)

deferred_scores = r'''
  const deferredRecoveryScores = {
    deterministic: replayDeferredLane({
      lane: 'deterministic_deferred',
      ordered,
      messageOwners,
      extractions: baseExtractions,
      journeys,
    }),
    luna: replayDeferredLane({
      lane: 'luna_deferred',
      ordered,
      messageOwners,
      extractions: lunaExtractions,
      journeys,
    }),
    hybrid: replayDeferredLane({
      lane: 'luna_sol_hybrid_deferred',
      ordered,
      messageOwners,
      extractions: hybridExtractions,
      journeys,
    }),
  };
'''

if 'const deferredRecoveryScores = {' not in source:
    source = source.replace(report_anchor, '\n' + deferred_scores + report_anchor, 1)

if '    deferredRecovery: deferredRecoveryScores,\n' not in source:
    source = source.replace(hybrid_report_anchor, hybrid_report_anchor + '    deferredRecovery: deferredRecoveryScores,\n', 1)

safety_new = """  if (
    lunaScore.unsafeCount > 0
    || hybridScore.unsafeCount > 0
    || deferredRecoveryScores.deterministic.unsafeCount > 0
    || deferredRecoveryScores.luna.unsafeCount > 0
    || deferredRecoveryScores.hybrid.unsafeCount > 0
    || deferredRecoveryScores.deterministic.wrongDeferredLinks > 0
    || deferredRecoveryScores.luna.wrongDeferredLinks > 0
    || deferredRecoveryScores.hybrid.wrongDeferredLinks > 0
  ) {
    throw new Error('unsafe_v7_ai_or_deferred_score');
  }"""
source = source.replace(safety_anchor, safety_new, 1)

v7.write_text(source)
print('v7_deferred_recovery_benchmark_patch_applied')
