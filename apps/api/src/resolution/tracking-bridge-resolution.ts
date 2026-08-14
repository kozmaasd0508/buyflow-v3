import { normalizeCarrierSlug } from './shipment-resolution.js';

export type TrackingBridgeEventType = 'shipment' | 'delivery';

export interface TrackingBridgePurchase {
  purchaseId: string;
  userId: string;
  expectedCarrier: string | null;
}

export interface TrackingBridgeExistingShipment {
  purchaseId: string;
  userId: string;
  carrierSlug: string | null;
  trackingNumber: string | null;
}

export interface TrackingBridgeMerchantAnchor {
  sourceEmailId: string;
  purchaseId: string;
  userId: string;
  eventType: TrackingBridgeEventType;
  carrier: string | null;
  confidence: number;
  receivedAt: string;
}

export interface TrackingBridgeEvidence {
  sourceEmailId: string;
  userId: string;
  eventType: TrackingBridgeEventType;
  trackingNumber: string | null;
  carrier: string | null;
  confidence: number;
  receivedAt: string;
}

export type TrackingBridgeDecision = 'linkable' | 'review' | 'unmatched';

export interface TrackingBridgeCandidate {
  key: string;
  userId: string;
  purchaseId: string | null;
  trackingNumber: string;
  carrierSlug: string | null;
  decision: TrackingBridgeDecision;
  confidence: number;
  sourceEmailIds: string[];
  reasons: string[];
}

const MAX_BRIDGE_HOURS = 36;
const MIN_TRACKING_LENGTH = 10;
const MIN_EVIDENCE_CONFIDENCE = 0.85;
const MIN_ANCHOR_CONFIDENCE = 0.8;

function normalizeTracking(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function instant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hourDistance(later: string, earlier: string): number | null {
  const left = instant(later);
  const right = instant(earlier);
  if (left === null || right === null) return null;
  return (left - right) / 3_600_000;
}

function clusterKey(row: TrackingBridgeEvidence): string | null {
  const tracking = normalizeTracking(row.trackingNumber);
  const carrierSlug = normalizeCarrierSlug(row.carrier);
  if (!row.userId || tracking.length < MIN_TRACKING_LENGTH || !carrierSlug) return null;
  return `${row.userId}::${carrierSlug}::${tracking}`;
}

function hasConflictingExistingTracking(
  purchase: TrackingBridgePurchase,
  carrierSlug: string,
  trackingNumber: string,
  shipments: TrackingBridgeExistingShipment[],
): boolean {
  return shipments.some((shipment) => {
    if (shipment.userId !== purchase.userId || shipment.purchaseId !== purchase.purchaseId) return false;
    if (normalizeCarrierSlug(shipment.carrierSlug) !== carrierSlug) return false;
    const existingTracking = normalizeTracking(shipment.trackingNumber);
    return Boolean(existingTracking && existingTracking !== trackingNumber);
  });
}

export function resolveTrackingBridgeCandidates(
  purchases: TrackingBridgePurchase[],
  shipments: TrackingBridgeExistingShipment[],
  anchors: TrackingBridgeMerchantAnchor[],
  evidenceRows: TrackingBridgeEvidence[],
): TrackingBridgeCandidate[] {
  const groups = new Map<string, TrackingBridgeEvidence[]>();
  for (const row of evidenceRows) {
    const key = clusterKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const results: TrackingBridgeCandidate[] = [];

  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const first = sorted[0];
    if (!first) continue;

    const trackingNumber = normalizeTracking(first.trackingNumber);
    const carrierSlug = normalizeCarrierSlug(first.carrier);
    const confidence = sorted.reduce((max, row) => Math.max(max, row.confidence), 0);
    const reasons: string[] = [];

    if (!carrierSlug || trackingNumber.length < MIN_TRACKING_LENGTH) continue;

    if (confidence < MIN_EVIDENCE_CONFIDENCE) {
      results.push({
        key,
        userId: first.userId,
        purchaseId: null,
        trackingNumber,
        carrierSlug,
        decision: 'review',
        confidence,
        sourceEmailIds: sorted.map((row) => row.sourceEmailId),
        reasons: ['carrier_evidence_below_bridge_threshold'],
      });
      continue;
    }

    const candidatePurchases: Array<{ purchaseId: string; reasons: string[] }> = [];

    for (const purchase of purchases) {
      if (purchase.userId !== first.userId) continue;
      if (hasConflictingExistingTracking(purchase, carrierSlug, trackingNumber, shipments)) continue;

      const purchaseAnchors = anchors.filter(
        (anchor) =>
          anchor.userId === first.userId &&
          anchor.purchaseId === purchase.purchaseId &&
          anchor.confidence >= MIN_ANCHOR_CONFIDENCE,
      );
      const shipmentAnchors = purchaseAnchors.filter((anchor) => {
        if (anchor.eventType !== 'shipment') return false;
        const lag = hourDistance(first.receivedAt, anchor.receivedAt);
        return lag !== null && lag >= 0 && lag <= MAX_BRIDGE_HOURS;
      });
      if (shipmentAnchors.length === 0) continue;

      const deliveryAnchors = purchaseAnchors.filter((anchor) => {
        if (anchor.eventType !== 'delivery') return false;
        const lag = hourDistance(anchor.receivedAt, first.receivedAt);
        return lag !== null && lag >= 0 && lag <= MAX_BRIDGE_HOURS;
      });

      const expectedCarrierMatch = normalizeCarrierSlug(purchase.expectedCarrier) === carrierSlug;
      const explicitShipmentCarrierMatch = shipmentAnchors.some(
        (anchor) => normalizeCarrierSlug(anchor.carrier) === carrierSlug,
      );

      if (!expectedCarrierMatch && !explicitShipmentCarrierMatch) continue;

      // There are two safe bridge shapes:
      // 1) the merchant's own shipment email explicitly names the same carrier; or
      // 2) the purchase expected that carrier and merchant lifecycle evidence brackets
      //    the carrier observation (shipment before, delivery after).
      const strongBridge = explicitShipmentCarrierMatch || (expectedCarrierMatch && deliveryAnchors.length > 0);
      if (!strongBridge) continue;

      const purchaseReasons = ['trusted_merchant_shipment_precedes_carrier_event'];
      if (expectedCarrierMatch) purchaseReasons.push('purchase_expected_carrier_matches');
      if (explicitShipmentCarrierMatch) purchaseReasons.push('merchant_shipment_names_same_carrier');
      if (deliveryAnchors.length > 0) purchaseReasons.push('merchant_delivery_corroborates_bridge');
      candidatePurchases.push({ purchaseId: purchase.purchaseId, reasons: purchaseReasons });
    }

    if (candidatePurchases.length === 1) {
      results.push({
        key,
        userId: first.userId,
        purchaseId: candidatePurchases[0]!.purchaseId,
        trackingNumber,
        carrierSlug,
        decision: 'linkable',
        confidence,
        sourceEmailIds: sorted.map((row) => row.sourceEmailId),
        reasons: candidatePurchases[0]!.reasons,
      });
      continue;
    }

    if (candidatePurchases.length > 1) {
      results.push({
        key,
        userId: first.userId,
        purchaseId: null,
        trackingNumber,
        carrierSlug,
        decision: 'review',
        confidence,
        sourceEmailIds: sorted.map((row) => row.sourceEmailId),
        reasons: ['tracking_bridge_matches_multiple_purchases'],
      });
      continue;
    }

    reasons.push('no_unique_trusted_tracking_bridge');
    results.push({
      key,
      userId: first.userId,
      purchaseId: null,
      trackingNumber,
      carrierSlug,
      decision: 'unmatched',
      confidence,
      sourceEmailIds: sorted.map((row) => row.sourceEmailId),
      reasons,
    });
  }

  return results.sort((a, b) => a.key.localeCompare(b.key));
}
