import { normalizeCarrierSlug } from './shipment-resolution.js';

export type TrackingBridgeEventType = 'shipment' | 'delivery';

export interface TrackingBridgePurchase {
  purchaseId: string;
  userId: string;
  expectedCarrier: string | null;
  merchantName: string | null;
  merchantLegalName: string | null;
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
  trackingNumber?: string | null;
  confidence: number;
  receivedAt: string;
}

export interface TrackingBridgeEvidence {
  sourceEmailId: string;
  userId: string;
  eventType: TrackingBridgeEventType;
  trackingNumber: string | null;
  carrier: string | null;
  consignor: string | null;
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
  shipmentProofSourceEmailIds: string[];
  reasons: string[];
}

const MAX_BRIDGE_HOURS = 36;
const MIN_TRACKING_LENGTH = 10;
const MIN_EVIDENCE_CONFIDENCE = 0.85;
const MIN_ANCHOR_CONFIDENCE = 0.8;
const MIN_EXACT_TRACKING_ANCHOR_CONFIDENCE = 0.75;
const LEGAL_SUFFIXES = new Set([
  'kft', 'zrt', 'nyrt', 'bt', 'rt', 'gmbh', 'ltd', 'llc', 'inc', 'ag', 'sro', 'as', 'oy', 'ab',
]);

function normalizeTracking(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeParty(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function corePartyTokens(value: string): string[] {
  const tokens = value.split(' ').filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens;
}

function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (Math.min(a.length, b.length) < 4) return false;

  if (a.length === b.length) {
    let differences = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) differences += 1;
      if (differences > 1) return false;
    }
    return differences === 1;
  }

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    j += 1;
  }
  return true;
}

function strictLegalNameLooksSame(left: string, right: string): boolean {
  const leftTokens = corePartyTokens(left);
  const rightTokens = corePartyTokens(right);
  if (leftTokens.length < 2 || leftTokens.length !== rightTokens.length) return false;

  let approximateTokens = 0;
  for (let i = 0; i < leftTokens.length; i += 1) {
    const a = leftTokens[i]!;
    const b = rightTokens[i]!;
    if (a === b) continue;
    if (!oneEditApart(a, b)) return false;
    approximateTokens += 1;
    if (approximateTokens > 1) return false;
  }
  return approximateTokens === 1;
}

function partyLooksSame(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeParty(a);
  const right = normalizeParty(b);
  if (!left || !right) return false;
  if (left === right || (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left)))) {
    return true;
  }
  return strictLegalNameLooksSame(left, right);
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

function followsWithinBridgeWindow(later: string, earlier: string): boolean {
  const lag = hourDistance(later, earlier);
  return lag !== null && lag >= 0 && lag <= MAX_BRIDGE_HOURS;
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

function trustedAnchorForTracking(anchor: TrackingBridgeMerchantAnchor, trackingNumber: string): boolean {
  if (anchor.confidence >= MIN_ANCHOR_CONFIDENCE) return true;
  return (
    anchor.confidence >= MIN_EXACT_TRACKING_ANCHOR_CONFIDENCE &&
    normalizeTracking(anchor.trackingNumber).length >= MIN_TRACKING_LENGTH &&
    normalizeTracking(anchor.trackingNumber) === trackingNumber
  );
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
        shipmentProofSourceEmailIds: [],
        reasons: ['carrier_evidence_below_bridge_threshold'],
      });
      continue;
    }

    const clusterConsignors = [...new Set(sorted.map((row) => row.consignor).filter((value): value is string => Boolean(value)))];
    const carrierShipmentRows = sorted.filter((row) => row.eventType === 'shipment');
    const candidatePurchases: Array<{
      purchaseId: string;
      reasons: string[];
      shipmentProofSourceEmailIds: string[];
    }> = [];

    for (const purchase of purchases) {
      if (purchase.userId !== first.userId) continue;
      if (hasConflictingExistingTracking(purchase, carrierSlug, trackingNumber, shipments)) continue;

      let consignorMatch = false;
      if (clusterConsignors.length > 0) {
        consignorMatch = clusterConsignors.some((consignor) =>
          partyLooksSame(consignor, purchase.merchantLegalName) || partyLooksSame(consignor, purchase.merchantName),
        );
        if (!consignorMatch) continue;
      }

      const purchaseAnchors = anchors.filter(
        (anchor) =>
          anchor.userId === first.userId &&
          anchor.purchaseId === purchase.purchaseId &&
          trustedAnchorForTracking(anchor, trackingNumber),
      );

      const shipmentAnchors = purchaseAnchors.filter((anchor) =>
        anchor.eventType === 'shipment' &&
        carrierShipmentRows.some((row) => followsWithinBridgeWindow(row.receivedAt, anchor.receivedAt)),
      );
      if (shipmentAnchors.length === 0) continue;

      const shipmentProofRows = carrierShipmentRows.filter((row) =>
        shipmentAnchors.some((anchor) => followsWithinBridgeWindow(row.receivedAt, anchor.receivedAt)),
      );
      if (shipmentProofRows.length === 0) continue;

      const deliveryAnchors = purchaseAnchors.filter((anchor) =>
        anchor.eventType === 'delivery' &&
        sorted.some((row) => followsWithinBridgeWindow(anchor.receivedAt, row.receivedAt)),
      );

      const expectedCarrierMatch = normalizeCarrierSlug(purchase.expectedCarrier) === carrierSlug;
      const explicitShipmentCarrierMatch = shipmentAnchors.some(
        (anchor) => normalizeCarrierSlug(anchor.carrier) === carrierSlug,
      );
      const exactMerchantTrackingMatch = shipmentAnchors.some(
        (anchor) => normalizeTracking(anchor.trackingNumber) === trackingNumber,
      );

      if (!expectedCarrierMatch && !explicitShipmentCarrierMatch) continue;

      const strongBridge = explicitShipmentCarrierMatch || (expectedCarrierMatch && deliveryAnchors.length > 0);
      if (!strongBridge) continue;

      const purchaseReasons = ['trusted_merchant_shipment_precedes_cluster_carrier_event'];
      if (expectedCarrierMatch) purchaseReasons.push('purchase_expected_carrier_matches');
      if (explicitShipmentCarrierMatch) purchaseReasons.push('merchant_shipment_names_same_carrier');
      if (exactMerchantTrackingMatch) purchaseReasons.push('merchant_shipment_exact_tracking_match');
      if (deliveryAnchors.length > 0) purchaseReasons.push('merchant_delivery_corroborates_bridge');
      if (consignorMatch) purchaseReasons.push('carrier_consignor_matches_purchase_merchant');
      candidatePurchases.push({
        purchaseId: purchase.purchaseId,
        reasons: purchaseReasons,
        shipmentProofSourceEmailIds: shipmentProofRows.map((row) => row.sourceEmailId),
      });
    }

    if (candidatePurchases.length === 1) {
      const match = candidatePurchases[0]!;
      results.push({
        key,
        userId: first.userId,
        purchaseId: match.purchaseId,
        trackingNumber,
        carrierSlug,
        decision: 'linkable',
        confidence,
        sourceEmailIds: sorted.map((row) => row.sourceEmailId),
        shipmentProofSourceEmailIds: match.shipmentProofSourceEmailIds,
        reasons: match.reasons,
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
        shipmentProofSourceEmailIds: [],
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
      shipmentProofSourceEmailIds: [],
      reasons,
    });
  }

  return results.sort((a, b) => a.key.localeCompare(b.key));
}
