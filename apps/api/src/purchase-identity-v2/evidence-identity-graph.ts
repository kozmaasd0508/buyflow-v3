import { normalizeStableIdentifier } from './identifier-normalizer.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';
import {
  verifiedIdentityKey,
  verifiedIdentityObservationsFromEvent,
  type VerifiedIdentityObservation,
  type VerifiedIdentityObservationSnapshot,
} from './verified-identity-observation.js';

export type EvidenceIdentityResolution =
  | { kind: 'UNVERIFIED'; candidatePurchaseIds: [] }
  | { kind: 'WAITING'; candidatePurchaseIds: [] }
  | { kind: 'UNIQUE_OWNER'; candidatePurchaseIds: [string]; purchaseId: string }
  | { kind: 'AMBIGUOUS'; candidatePurchaseIds: string[] };

/**
 * Read-only evidence graph. It connects only VERIFIED exact identity
 * observations and already-existing Purchase identities. It never creates a
 * Purchase and never mutates the PurchaseIdentityGraph.
 *
 * This provides the missing "wait until the relationship is provable" layer:
 * multiple emails may strengthen one exact identity component, but ownership is
 * exposed only when that component reaches exactly one existing Purchase.
 */
export class EvidenceIdentityGraph {
  private readonly parent = new Map<string, string>();
  private readonly ownersByKey = new Map<string, Set<string>>();

  constructor(
    snapshot: PurchaseIdentitySnapshot,
    observations: VerifiedIdentityObservationSnapshot,
  ) {
    const observationsByEvent = groupByEvent(observations.observations);
    for (const group of observationsByEvent.values()) {
      this.connectKeys(group.map((item) => item.identityKey));
    }

    const purchaseKeys = purchaseIdentityKeys(snapshot);
    for (const keys of purchaseKeys.values()) {
      this.connectKeys(keys);
    }

    // Resolve roots only after every verified observation and every existing
    // Purchase identity has been connected.
    for (const [purchaseId, keys] of purchaseKeys.entries()) {
      for (const key of keys) {
        const root = this.find(key);
        const owners = this.ownersByKey.get(root) ?? new Set<string>();
        owners.add(purchaseId);
        this.ownersByKey.set(root, owners);
      }
    }
  }

  resolveEvent(event: CanonicalEvent): EvidenceIdentityResolution {
    const observations = verifiedIdentityObservationsFromEvent(event);
    if (observations.length === 0) {
      return { kind: 'UNVERIFIED', candidatePurchaseIds: [] };
    }

    const candidates = new Set<string>();
    for (const observation of observations) {
      const root = this.find(observation.identityKey);
      for (const purchaseId of this.ownersByKey.get(root) ?? []) candidates.add(purchaseId);
    }

    const candidatePurchaseIds = [...candidates].sort();
    if (candidatePurchaseIds.length === 0) {
      return { kind: 'WAITING', candidatePurchaseIds: [] };
    }
    if (candidatePurchaseIds.length === 1) {
      return {
        kind: 'UNIQUE_OWNER',
        candidatePurchaseIds: [candidatePurchaseIds[0]!],
        purchaseId: candidatePurchaseIds[0]!,
      };
    }
    return { kind: 'AMBIGUOUS', candidatePurchaseIds };
  }

  private connectKeys(keys: string[]): void {
    const unique = [...new Set(keys.filter(Boolean))];
    for (const key of unique) this.ensure(key);
    if (unique.length < 2) return;
    const first = unique[0]!;
    for (const key of unique.slice(1)) this.union(first, key);
  }

  private ensure(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  private find(key: string): string {
    this.ensure(key);
    const parent = this.parent.get(key)!;
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  private union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [winner, loser] = leftRoot.localeCompare(rightRoot) <= 0
      ? [leftRoot, rightRoot]
      : [rightRoot, leftRoot];
    this.parent.set(loser, winner);
  }
}

function groupByEvent(
  observations: VerifiedIdentityObservation[],
): Map<string, VerifiedIdentityObservation[]> {
  const result = new Map<string, VerifiedIdentityObservation[]>();
  for (const observation of observations) {
    const group = result.get(observation.sourceEventId) ?? [];
    group.push(observation);
    result.set(observation.sourceEventId, group);
  }
  return result;
}

function purchaseIdentityKeys(snapshot: PurchaseIdentitySnapshot): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const purchaseById = new Map(snapshot.purchases.map((purchase) => [purchase.purchaseId, purchase]));

  const add = (purchaseId: string, key: string | null) => {
    if (!key) return;
    const keys = result.get(purchaseId) ?? [];
    keys.push(key);
    result.set(purchaseId, keys);
  };

  for (const order of snapshot.orders) {
    const purchase = purchaseById.get(order.purchaseId);
    if (!purchase) continue;
    const value = normalizeStableIdentifier(order.orderId);
    const namespace = normalizeNamespace(order.merchantId ?? order.merchantNamespace);
    if (!value || !namespace) continue;
    add(order.purchaseId, verifiedIdentityKey(purchase.userId, 'order', namespace, value));
  }

  for (const shipment of snapshot.shipments) {
    const purchase = purchaseById.get(shipment.purchaseId);
    if (!purchase) continue;
    const value = normalizeStableIdentifier(shipment.trackingId);
    const namespace = normalizeNamespace(shipment.carrierId);
    if (!value || !namespace) continue;
    add(shipment.purchaseId, verifiedIdentityKey(purchase.userId, 'tracking', namespace, value));
  }

  return result;
}

function normalizeNamespace(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}
