import { createHash } from 'node:crypto';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import type { CanonicalEvent, SourceRole } from './types.js';

export type VerifiedIdentityObservationKind = 'order' | 'tracking';
export type VerifiedIdentityProvenanceClass = 'deterministic' | 'mixed';

export interface VerifiedIdentityObservation {
  observationId: string;
  userId: string;
  sourceEventId: string;
  kind: VerifiedIdentityObservationKind;
  namespace: string;
  normalizedValue: string;
  identityKey: string;
  observedAt: string;
  sourceRole: SourceRole;
  provenanceClass: VerifiedIdentityProvenanceClass;
  status: 'VERIFIED';
}

export interface VerifiedIdentityObservationSnapshot {
  version: 1;
  observations: VerifiedIdentityObservation[];
}

const AI_EXTRACTOR_IDS = new Set(['openai-semantic-shadow']);

/**
 * Derives identity observations that are safe to remember as evidence but have
 * no Purchase CREATE/LINK authority by themselves.
 *
 * Rules are intentionally narrow:
 * - exact, namespaced hard identity only;
 * - no hard conflict anywhere on the event;
 * - the identity value must have at least one non-AI provenance source;
 * - order identity is merchant-source only;
 * - tracking identity is direct-carrier, or merchant-source only when the
 *   carrier namespace itself is also supported by non-AI provenance.
 */
export function verifiedIdentityObservationsFromEvent(
  event: CanonicalEvent,
): VerifiedIdentityObservation[] {
  if ((event.conflicts ?? []).some((conflict) => conflict.severity === 'hard')) return [];

  const result: VerifiedIdentityObservation[] = [];
  const sourceRole = event.sourceRole ?? 'unknown';

  if (sourceRole === 'merchant') {
    const orderValue = normalizeStableIdentifier(event.orderIdNormalized ?? event.orderIdRaw);
    const merchantNamespace = normalizeNamespace(event.merchantId ?? event.merchantNamespace);
    const support = provenanceSupport(event, 'order_number');
    if (orderValue && merchantNamespace && support.nonAi) {
      result.push(buildObservation({
        event,
        sourceRole,
        kind: 'order',
        namespace: merchantNamespace,
        normalizedValue: orderValue,
        provenanceClass: support.ai ? 'mixed' : 'deterministic',
      }));
    }
  }

  if (sourceRole === 'carrier' || sourceRole === 'merchant') {
    const trackingValue = normalizeStableIdentifier(event.trackingIdNormalized ?? event.trackingIdRaw);
    const carrierNamespace = normalizeNamespace(event.carrierId);
    const trackingSupport = provenanceSupport(event, 'tracking_number');
    const carrierSupport = provenanceSupport(event, 'carrier');
    const namespaceVerified = sourceRole === 'carrier' || carrierSupport.nonAi;
    if (trackingValue && carrierNamespace && trackingSupport.nonAi && namespaceVerified) {
      result.push(buildObservation({
        event,
        sourceRole,
        kind: 'tracking',
        namespace: carrierNamespace,
        normalizedValue: trackingValue,
        provenanceClass: trackingSupport.ai || carrierSupport.ai ? 'mixed' : 'deterministic',
      }));
    }
  }

  return dedupeObservations(result);
}

export class VerifiedIdentityObservationStore {
  private readonly observations = new Map<string, VerifiedIdentityObservation>();

  constructor(initial?: VerifiedIdentityObservationSnapshot) {
    for (const observation of initial?.observations ?? []) {
      if (observation.status !== 'VERIFIED') continue;
      this.observations.set(observation.observationId, { ...observation });
    }
  }

  observe(event: CanonicalEvent): VerifiedIdentityObservation[] {
    const derived = verifiedIdentityObservationsFromEvent(event);
    for (const observation of derived) {
      this.observations.set(observation.observationId, { ...observation });
    }
    return derived.map((item) => ({ ...item }));
  }

  snapshot(): VerifiedIdentityObservationSnapshot {
    return {
      version: 1,
      observations: [...this.observations.values()]
        .map((item) => ({ ...item }))
        .sort((a, b) => a.observationId.localeCompare(b.observationId)),
    };
  }

  forUser(userId: string): VerifiedIdentityObservation[] {
    return [...this.observations.values()]
      .filter((item) => item.userId === userId)
      .map((item) => ({ ...item }))
      .sort((a, b) => a.observationId.localeCompare(b.observationId));
  }
}

export function verifiedIdentityKey(
  userId: string,
  kind: VerifiedIdentityObservationKind,
  namespace: string,
  normalizedValue: string,
): string {
  return `${userId}|${kind}|${normalizeNamespace(namespace) ?? ''}|${normalizeStableIdentifier(normalizedValue) ?? ''}`;
}

function buildObservation(input: {
  event: CanonicalEvent;
  sourceRole: SourceRole;
  kind: VerifiedIdentityObservationKind;
  namespace: string;
  normalizedValue: string;
  provenanceClass: VerifiedIdentityProvenanceClass;
}): VerifiedIdentityObservation {
  const identityKey = verifiedIdentityKey(
    input.event.userId,
    input.kind,
    input.namespace,
    input.normalizedValue,
  );
  return {
    observationId: `vio_${createHash('sha256')
      .update(`${input.event.eventId}|${identityKey}`, 'utf8')
      .digest('hex')
      .slice(0, 24)}`,
    userId: input.event.userId,
    sourceEventId: input.event.eventId,
    kind: input.kind,
    namespace: input.namespace,
    normalizedValue: input.normalizedValue,
    identityKey,
    observedAt: input.event.receivedAt,
    sourceRole: input.sourceRole,
    provenanceClass: input.provenanceClass,
    status: 'VERIFIED',
  };
}

function provenanceSupport(event: CanonicalEvent, field: string): { ai: boolean; nonAi: boolean } {
  const evidence = event.provenance.filter((item) => item.field === field);
  return {
    ai: evidence.some((item) => AI_EXTRACTOR_IDS.has(item.extractorId ?? '')),
    nonAi: evidence.some((item) => !AI_EXTRACTOR_IDS.has(item.extractorId ?? '')),
  };
}

function normalizeNamespace(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function dedupeObservations(items: VerifiedIdentityObservation[]): VerifiedIdentityObservation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.identityKey)) return false;
    seen.add(item.identityKey);
    return true;
  });
}
