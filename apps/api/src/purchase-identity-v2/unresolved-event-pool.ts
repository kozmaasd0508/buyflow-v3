import { normalizeStableIdentifier } from './identifier-normalizer.js';
import type { CanonicalEvent, CorrelationDecision } from './types.js';

export type UnresolvedEventStatus = 'unresolved' | 'resolved' | 'review';
export type UnresolvedIdentityKind = 'order' | 'tracking' | 'invoice' | 'payment';

export interface UnresolvedIdentityKey {
  kind: UnresolvedIdentityKind;
  key: string;
}

export interface UnresolvedEventRecord {
  eventId: string;
  userId: string;
  event: CanonicalEvent;
  status: UnresolvedEventStatus;
  reason: 'NO_PROVABLE_PARENT';
  identityKeys: UnresolvedIdentityKey[];
  firstSeenAt: string;
  lastAttemptAt: string | null;
  attemptCount: number;
  resolvedPurchaseId: string | null;
}

export interface UnresolvedEventPoolSnapshot {
  version: 1;
  records: UnresolvedEventRecord[];
}

export interface TargetedRecoveryPlan {
  triggerEventId: string;
  unresolvedEventIds: string[];
  sharedIdentityKeys: string[];
}

const ACTIONABLE_LIFECYCLE_EVENTS = new Set<CanonicalEvent['eventType']>([
  'order_updated',
  'payment_completed',
  'shipment_created',
  'out_for_delivery',
  'delivered',
  'invoice_created',
  'refund_created',
  'refund_completed',
  'return_created',
  'cancelled',
]);

/**
 * Persistence-ready orphan pool for commerce lifecycle events that are real but
 * cannot yet be attached to exactly one Purchase. This module deliberately does
 * not create or link Purchases. It only remembers evidence and plans a narrow
 * re-resolution when a later event exposes the same exact, namespaced identity.
 */
export class UnresolvedEventPool {
  private readonly records = new Map<string, UnresolvedEventRecord>();

  constructor(initial?: UnresolvedEventPoolSnapshot) {
    for (const record of initial?.records ?? []) {
      this.records.set(record.eventId, cloneRecord(record));
    }
  }

  snapshot(): UnresolvedEventPoolSnapshot {
    return {
      version: 1,
      records: [...this.records.values()]
        .map(cloneRecord)
        .sort((a, b) => a.eventId.localeCompare(b.eventId)),
    };
  }

  remember(event: CanonicalEvent, decision: CorrelationDecision): boolean {
    if (decision.kind !== 'UNLINKED') return false;
    if (!ACTIONABLE_LIFECYCLE_EVENTS.has(event.eventType)) return false;

    const identityKeys = exactIdentityKeys(event);
    const existing = this.records.get(event.eventId);
    if (existing) {
      if (existing.status !== 'unresolved') return false;
      existing.event = cloneEvent(event);
      existing.identityKeys = identityKeys;
      return false;
    }

    this.records.set(event.eventId, {
      eventId: event.eventId,
      userId: event.userId,
      event: cloneEvent(event),
      status: 'unresolved',
      reason: 'NO_PROVABLE_PARENT',
      identityKeys,
      firstSeenAt: event.receivedAt,
      lastAttemptAt: null,
      attemptCount: 0,
      resolvedPurchaseId: null,
    });
    return true;
  }

  planRecovery(triggerEvent: CanonicalEvent): TargetedRecoveryPlan {
    const triggerKeys = new Set(exactIdentityKeys(triggerEvent).map((item) => item.key));
    if (triggerKeys.size === 0) {
      return { triggerEventId: triggerEvent.eventId, unresolvedEventIds: [], sharedIdentityKeys: [] };
    }

    const unresolvedEventIds: string[] = [];
    const shared = new Set<string>();
    for (const record of this.records.values()) {
      if (record.status !== 'unresolved' || record.userId !== triggerEvent.userId) continue;
      const matches = record.identityKeys.map((item) => item.key).filter((key) => triggerKeys.has(key));
      if (matches.length === 0) continue;
      unresolvedEventIds.push(record.eventId);
      for (const key of matches) shared.add(key);
    }

    return {
      triggerEventId: triggerEvent.eventId,
      unresolvedEventIds: unresolvedEventIds.sort(),
      sharedIdentityKeys: [...shared].sort(),
    };
  }

  recordAttempt(eventId: string, attemptedAt: string): boolean {
    const record = this.records.get(eventId);
    if (!record || record.status !== 'unresolved') return false;
    record.lastAttemptAt = attemptedAt;
    record.attemptCount += 1;
    return true;
  }

  markResolved(eventId: string, purchaseId: string): boolean {
    const record = this.records.get(eventId);
    if (!record || record.status !== 'unresolved') return false;
    record.status = 'resolved';
    record.resolvedPurchaseId = purchaseId;
    return true;
  }

  markReview(eventId: string): boolean {
    const record = this.records.get(eventId);
    if (!record || record.status !== 'unresolved') return false;
    record.status = 'review';
    return true;
  }

  unresolved(): UnresolvedEventRecord[] {
    return [...this.records.values()]
      .filter((record) => record.status === 'unresolved')
      .map(cloneRecord)
      .sort((a, b) => a.eventId.localeCompare(b.eventId));
  }
}

export function exactIdentityKeys(event: CanonicalEvent): UnresolvedIdentityKey[] {
  const result: UnresolvedIdentityKey[] = [];
  const orderId = normalizeStableIdentifier(event.orderIdNormalized ?? event.orderIdRaw);
  const merchantNamespace = normalizedNamespace(event.merchantId ?? event.merchantNamespace);
  if (orderId && merchantNamespace) {
    result.push({ kind: 'order', key: identityKey(event.userId, 'order', merchantNamespace, orderId) });
  }

  const trackingId = normalizeStableIdentifier(event.trackingIdNormalized ?? event.trackingIdRaw);
  const carrierNamespace = normalizedNamespace(event.carrierId);
  if (trackingId && carrierNamespace) {
    result.push({ kind: 'tracking', key: identityKey(event.userId, 'tracking', carrierNamespace, trackingId) });
  }

  const invoiceId = normalizeStableIdentifier(event.invoiceIdNormalized ?? event.invoiceIdRaw);
  const invoiceNamespace = normalizedNamespace(event.invoiceIssuerId);
  if (invoiceId && invoiceNamespace) {
    result.push({ kind: 'invoice', key: identityKey(event.userId, 'invoice', invoiceNamespace, invoiceId) });
  }

  const paymentReference = normalizeStableIdentifier(event.paymentReference);
  const paymentNamespace = normalizedNamespace(event.paymentProviderId);
  if (paymentReference && paymentNamespace) {
    result.push({ kind: 'payment', key: identityKey(event.userId, 'payment', paymentNamespace, paymentReference) });
  }

  return dedupeKeys(result);
}

function identityKey(userId: string, kind: UnresolvedIdentityKind, namespace: string, value: string): string {
  return `${userId}|${kind}|${namespace}|${value}`;
}

function normalizedNamespace(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function dedupeKeys(keys: UnresolvedIdentityKey[]): UnresolvedIdentityKey[] {
  const seen = new Set<string>();
  return keys.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function cloneEvent(event: CanonicalEvent): CanonicalEvent {
  return {
    ...event,
    productFingerprints: [...event.productFingerprints],
    provenance: event.provenance.map((item) => ({
      ...item,
      qualifiers: item.qualifiers ? [...item.qualifiers] : undefined,
    })),
    purchaseCreationReasons: event.purchaseCreationReasons ? [...event.purchaseCreationReasons] : undefined,
    orderRelation: event.orderRelation ? {
      ...event.orderRelation,
      provenance: event.orderRelation.provenance.map((item) => ({
        ...item,
        qualifiers: item.qualifiers ? [...item.qualifiers] : undefined,
      })),
    } : event.orderRelation,
    conflicts: event.conflicts?.map((conflict) => ({
      ...conflict,
      values: [...conflict.values],
      evidence: conflict.evidence.map((item) => ({ ...item, qualifiers: [...item.qualifiers] })),
    })),
  };
}

function cloneRecord(record: UnresolvedEventRecord): UnresolvedEventRecord {
  return {
    ...record,
    event: cloneEvent(record.event),
    identityKeys: record.identityKeys.map((item) => ({ ...item })),
  };
}
