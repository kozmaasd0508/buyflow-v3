import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';

export type ShipmentEventType = 'shipment' | 'delivery';
export type ShipmentEvidencePhase =
  | 'shipment_created'
  | 'shipped'
  | 'in_transit'
  | 'out_for_delivery'
  | 'ready_for_pickup'
  | 'delivered';

export interface ShipmentResolutionEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  eventType: ShipmentEventType;
  shipmentPhase?: ShipmentEvidencePhase | null;
  merchant: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  confidence: number;
  receivedAt: string;
}

export interface ShipmentPurchaseIdentity {
  purchaseId: string;
  userId: string;
  merchantDomain: string | null;
  orderNumber: string | null;
}

export type ShipmentResolutionDecision =
  | 'linkable'
  | 'review'
  | 'unmatched';

export interface ShipmentResolutionCandidate {
  key: string;
  userId: string;
  trackingNumber: string;
  carrierSlug: string | null;
  purchaseId: string | null;
  decision: ShipmentResolutionDecision;
  recommendedStatus: 'shipment_created' | 'in_transit' | 'delivered';
  confidence: number;
  evidenceCount: number;
  merchantAnchorCount: number;
  carrierEvidenceCount: number;
  physicalShipmentEvidenceCount: number;
  reasons: string[];
  sourceEmailIds: string[];
}

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeOrderNumber(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeTrackingNumber(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function normalizeCarrierSlug(carrier: string | null): string | null {
  if (!carrier) return null;
  const value = carrier.toLowerCase();
  if (value.includes('express')) return 'express-one';
  if (value.includes('dpd')) return 'dpd';
  if (value.includes('gls')) return 'gls';
  if (value.includes('foxpost')) return 'foxpost';
  if (value.includes('packeta')) return 'packeta';
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

function purchaseKey(
  userId: string,
  merchantDomain: string | null | undefined,
  orderNumber: string | null | undefined,
): string | null {
  const domain = normalizeDomain(merchantDomain);
  const order = normalizeOrderNumber(orderNumber);
  if (!userId || !domain || !order) return null;
  return `${userId}::${domain}::${order}`;
}

function trackingKey(userId: string, trackingNumber: string): string {
  return `${userId}::${trackingNumber}`;
}

function isPhysicalShipmentEvidence(row: ShipmentResolutionEvidence): boolean {
  return row.eventType === 'shipment' && row.shipmentPhase !== 'shipment_created';
}

export function resolveShipmentCandidates(
  purchases: ShipmentPurchaseIdentity[],
  evidenceRows: ShipmentResolutionEvidence[],
): ShipmentResolutionCandidate[] {
  const purchasesByIdentity = new Map<string, ShipmentPurchaseIdentity[]>();

  for (const purchase of purchases) {
    const key = purchaseKey(
      purchase.userId,
      purchase.merchantDomain,
      purchase.orderNumber,
    );
    if (!key) continue;
    const rows = purchasesByIdentity.get(key) ?? [];
    rows.push(purchase);
    purchasesByIdentity.set(key, rows);
  }

  const trackingGroups = new Map<string, ShipmentResolutionEvidence[]>();
  for (const evidence of evidenceRows) {
    const tracking = normalizeTrackingNumber(evidence.trackingNumber);
    if (!tracking) continue;
    const key = trackingKey(evidence.userId, tracking);
    const rows = trackingGroups.get(key) ?? [];
    rows.push(evidence);
    trackingGroups.set(key, rows);
  }

  const candidates: ShipmentResolutionCandidate[] = [];

  for (const [key, rows] of trackingGroups) {
    const sorted = [...rows].sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt),
    );
    const userId = sorted[0]?.userId ?? '';
    const trackingNumber = normalizeTrackingNumber(sorted[0]?.trackingNumber);
    const anchorPurchaseIds = new Set<string>();
    let merchantAnchorCount = 0;
    let carrierEvidenceCount = 0;
    const carrierSlugs = new Set<string>();
    const reasons: string[] = [];

    for (const row of sorted) {
      const senderDomain = normalizeDomain(row.senderDomain);
      const carrierSender = isCarrierSenderDomain(senderDomain);
      if (carrierSender) carrierEvidenceCount += 1;

      const slug = normalizeCarrierSlug(row.carrier);
      if (slug) carrierSlugs.add(slug);

      // A shipment_created merchant email is still valuable as a safe
      // purchase↔tracking anchor. It must not, however, count as proof that
      // the parcel has physically entered the carrier network.
      if (carrierSender || !row.orderNumber) continue;

      const identityKey = purchaseKey(userId, senderDomain, row.orderNumber);
      if (!identityKey) continue;
      const matchingPurchases = purchasesByIdentity.get(identityKey) ?? [];
      if (matchingPurchases.length === 1) {
        anchorPurchaseIds.add(matchingPurchases[0]!.purchaseId);
        merchantAnchorCount += 1;
      } else if (matchingPurchases.length > 1) {
        for (const purchase of matchingPurchases) {
          anchorPurchaseIds.add(purchase.purchaseId);
        }
        reasons.push('merchant_order_identity_is_ambiguous');
      }
    }

    const delivered = sorted.some(
      (row) => row.eventType === 'delivery' || row.shipmentPhase === 'delivered',
    );
    const physicalShipmentEvidenceCount = sorted.filter(isPhysicalShipmentEvidence).length;
    const strongestConfidence = sorted.reduce(
      (max, row) => Math.max(max, row.confidence),
      0,
    );

    let decision: ShipmentResolutionDecision;
    let purchaseId: string | null = null;

    if (anchorPurchaseIds.size === 1) {
      decision = 'linkable';
      purchaseId = [...anchorPurchaseIds][0] ?? null;
      reasons.push('merchant_order_anchor_matches_existing_purchase');
      if (carrierEvidenceCount > 0) {
        reasons.push('tracking_corroborated_by_carrier_evidence');
      }
      if (physicalShipmentEvidenceCount === 0 && !delivered) {
        reasons.push('shipment_created_without_physical_progress');
      }
    } else if (anchorPurchaseIds.size > 1) {
      decision = 'review';
      reasons.push('tracking_points_to_multiple_purchases');
    } else {
      decision = 'unmatched';
      reasons.push('no_trusted_merchant_order_anchor');
    }

    candidates.push({
      key,
      userId,
      trackingNumber,
      carrierSlug: carrierSlugs.size === 1 ? [...carrierSlugs][0] ?? null : null,
      purchaseId,
      decision,
      recommendedStatus: delivered
        ? 'delivered'
        : physicalShipmentEvidenceCount > 0
          ? 'in_transit'
          : 'shipment_created',
      confidence: strongestConfidence,
      evidenceCount: sorted.length,
      merchantAnchorCount,
      carrierEvidenceCount,
      physicalShipmentEvidenceCount,
      reasons,
      sourceEmailIds: sorted.map((row) => row.sourceEmailId),
    });
  }

  return candidates.sort((a, b) => a.key.localeCompare(b.key));
}
