import { PurchaseIdentityGraph, type GraphApplyResult } from './graph.js';
import {
  UnresolvedEventPool,
  type UnresolvedEventPoolSnapshot,
} from './unresolved-event-pool.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';

export interface DeferredGraphApplyResult extends GraphApplyResult {
  unresolvedStored: boolean;
  recoveredEventIds: string[];
  movedToReviewEventIds: string[];
}

/**
 * Adds durable/deferred resolution semantics without changing the proven
 * PurchaseIdentityGraph decision rules. The underlying graph remains the only
 * authority for CREATE/LINK decisions; this layer only remembers UNLINKED
 * lifecycle events and replays a narrowly targeted subset after later hard
 * identity evidence has safely entered the graph.
 */
export class DeferredResolutionGraph {
  private readonly graph: PurchaseIdentityGraph;
  private readonly unresolvedPool: UnresolvedEventPool;

  constructor(
    initialGraph?: PurchaseIdentitySnapshot,
    initialUnresolved?: UnresolvedEventPoolSnapshot,
  ) {
    this.graph = new PurchaseIdentityGraph(initialGraph);
    this.unresolvedPool = new UnresolvedEventPool(initialUnresolved);
  }

  snapshot(): PurchaseIdentitySnapshot {
    return this.graph.snapshot();
  }

  unresolvedSnapshot(): UnresolvedEventPoolSnapshot {
    return this.unresolvedPool.snapshot();
  }

  applyEvent(event: CanonicalEvent): DeferredGraphApplyResult {
    const primary = this.graph.applyEvent(event);

    if (primary.decision.kind === 'UNLINKED') {
      const unresolvedStored = this.unresolvedPool.remember(event, primary.decision);
      return {
        ...primary,
        unresolvedStored,
        recoveredEventIds: [],
        movedToReviewEventIds: [],
      };
    }

    if (primary.decision.kind !== 'NEW_PURCHASE' && primary.decision.kind !== 'LINKED') {
      return {
        ...primary,
        unresolvedStored: false,
        recoveredEventIds: [],
        movedToReviewEventIds: [],
      };
    }

    const plan = this.unresolvedPool.planRecovery(event);
    if (plan.unresolvedEventIds.length === 0) {
      return {
        ...primary,
        unresolvedStored: false,
        recoveredEventIds: [],
        movedToReviewEventIds: [],
      };
    }

    const records = new Map(
      this.unresolvedPool.snapshot().records.map((record) => [record.eventId, record]),
    );
    const recoveredEventIds: string[] = [];
    const movedToReviewEventIds: string[] = [];

    for (const eventId of plan.unresolvedEventIds) {
      const record = records.get(eventId);
      if (!record || record.status !== 'unresolved') continue;

      this.unresolvedPool.recordAttempt(eventId, event.receivedAt);
      const retry = this.graph.applyEvent(record.event);

      if (retry.decision.kind === 'LINKED') {
        this.unresolvedPool.markResolved(eventId, retry.decision.purchaseId);
        recoveredEventIds.push(eventId);
        continue;
      }

      if (retry.decision.kind === 'REVIEW' || retry.decision.kind === 'PENDING') {
        this.unresolvedPool.markReview(eventId);
        movedToReviewEventIds.push(eventId);
      }
      // If it remains UNLINKED, keep it unresolved for a later exact bridge.
      // NEW_PURCHASE cannot be produced by admitted unresolved lifecycle events.
    }

    return {
      ...primary,
      snapshot: this.graph.snapshot(),
      unresolvedStored: false,
      recoveredEventIds: recoveredEventIds.sort(),
      movedToReviewEventIds: movedToReviewEventIds.sort(),
    };
  }
}
