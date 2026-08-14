import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { isTrustedAutomaticEvidence } from '../pipeline/automatic-write-gate.js';
import {
  normalizeCarrierBridgeEventType,
  resolveTrackingBridgeCandidates,
  type TrackingBridgeEvidence,
  type TrackingBridgeExistingShipment,
  type TrackingBridgeMerchantAnchor,
  type TrackingBridgePurchase,
} from '../resolution/tracking-bridge-resolution.js';
import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';

const MAX_BRIDGE_MS = 36 * 60 * 60 * 1000;
const MIN_ANCHOR_CONFIDENCE = 0.8;

interface SourceRow {
  id: string;
  user_id: string;
  from_address: string | null;
  subject: string | null;
  received_at: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  expected_carrier: string | null;
  merchant_name: string | null;
  merchant_legal_name: string | null;
}

interface ShipmentRow {
  purchase_id: string;
  user_id: string;
  carrier_slug: string | null;
  tracking_number: string | null;
}

interface PurchaseSourceRow {
  purchase_id: string;
  source_email_id: string;
}

export interface TrackingBridgeRecoveryResult {
  scanned: number;
  clusters: number;
  linkedClusters: number;
  linkedSources: number;
  reviewClusters: number;
  unmatchedClusters: number;
  failedClusters: number;
}

function senderDomain(fromAddress: string | null): string {
  if (!fromAddress) return '';
  const match = fromAddress.toLowerCase().match(/@([^>\s,;]+)/);
  return (match?.[1] ?? '').replace(/[)>]+$/, '').trim();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numericOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTracking(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function carrierConsignor(subject: string | null, carrier: string | null): string | null {
  if (!subject || !carrier?.toLowerCase().includes('dpd')) return null;
  const match = subject.match(/^\s*Értesítés\s+[A-Za-z0-9-]+\s+(.+?)\s+küldemény\s+(?:feladásáról|mai kézbesítéséről)/iu);
  return match?.[1]?.trim() || null;
}

function toBridgeEvidence(source: SourceRow): TrackingBridgeEvidence | null {
  const result = source.validated_result;
  if (!result || !isTrustedAutomaticEvidence(source.validation_status, result)) return null;
  const extractedEventType = result.event_type;
  if (extractedEventType !== 'shipment' && extractedEventType !== 'delivery') return null;
  const confidence = numericOrNull(result.confidence);
  if (confidence === null) return null;
  const carrier = stringOrNull(result.carrier);
  const domain = senderDomain(source.from_address);
  const eventType = isCarrierSenderDomain(domain)
    ? normalizeCarrierBridgeEventType(source.subject, extractedEventType)
    : extractedEventType;

  return {
    sourceEmailId: source.id,
    userId: source.user_id,
    eventType,
    trackingNumber: stringOrNull(result.tracking_number),
    carrier,
    consignor: carrierConsignor(source.subject, carrier),
    confidence,
    receivedAt: source.received_at,
  };
}

function toMerchantAnchor(source: SourceRow, purchaseId: string): TrackingBridgeMerchantAnchor | null {
  const result = source.validated_result;
  if (!result || !isTrustedAutomaticEvidence(source.validation_status, result)) return null;
  const eventType = result.event_type;
  if (eventType !== 'shipment' && eventType !== 'delivery') return null;
  if (isCarrierSenderDomain(senderDomain(source.from_address))) return null;
  const confidence = numericOrNull(result.confidence);
  if (confidence === null) return null;

  return {
    sourceEmailId: source.id,
    purchaseId,
    userId: source.user_id,
    eventType,
    carrier: stringOrNull(result.carrier),
    trackingNumber: stringOrNull(result.tracking_number),
    confidence,
    receivedAt: source.received_at,
  };
}

function canonicalCarrierName(slug: string): string {
  const known: Record<string, string> = {
    'express-one': 'Express One',
    dpd: 'DPD',
    gls: 'GLS',
    foxpost: 'Foxpost',
    packeta: 'Packeta',
  };
  return known[slug] ?? slug;
}

function earliest(rows: TrackingBridgeEvidence[]): string | null {
  return [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]?.receivedAt ?? null;
}

function latest(rows: TrackingBridgeEvidence[]): string | null {
  return [...rows].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]?.receivedAt ?? null;
}

function corroboratedMerchantDeliveryAt(
  anchors: TrackingBridgeMerchantAnchor[],
  purchaseId: string,
  after: string,
): string | null {
  const afterMs = Date.parse(after);
  if (!Number.isFinite(afterMs)) return null;
  return anchors
    .filter((anchor) => {
      if (
        anchor.purchaseId !== purchaseId ||
        anchor.eventType !== 'delivery' ||
        anchor.confidence < MIN_ANCHOR_CONFIDENCE
      ) return false;
      const anchorMs = Date.parse(anchor.receivedAt);
      return Number.isFinite(anchorMs) && anchorMs >= afterMs && anchorMs - afterMs <= MAX_BRIDGE_MS;
    })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]?.receivedAt ?? null;
}

function laterTimestamp(a: string, b: string | null): string {
  if (!b) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

export async function drainTrackingBridgeRecoveryV21(
  mode: 'observe' | 'write',
  limit = 200,
): Promise<TrackingBridgeRecoveryResult> {
  const db = getSupabaseAdmin() as any;
  const { data: sourceData, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,from_address,subject,received_at,validation_status,validated_result')
    .eq('processing_status', 'unlinked')
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (sourceError) throw new Error(`Tracking bridge V2.3 source read failed: ${sourceError.message}`);

  const sourceRows = (sourceData ?? []) as SourceRow[];
  const evidence = sourceRows
    .map(toBridgeEvidence)
    .filter((row: TrackingBridgeEvidence | null): row is TrackingBridgeEvidence => Boolean(row));

  const result: TrackingBridgeRecoveryResult = {
    scanned: sourceRows.length,
    clusters: 0,
    linkedClusters: 0,
    linkedSources: 0,
    reviewClusters: 0,
    unmatchedClusters: 0,
    failedClusters: 0,
  };
  if (evidence.length === 0) return result;

  const userIds = [...new Set(evidence.map((row) => row.userId))];
  for (const userId of userIds) {
    const userEvidence = evidence.filter((row) => row.userId === userId);

    const { data: purchaseData, error: purchaseError } = await db
      .from('purchases')
      .select('id,user_id,expected_carrier,merchant_name,merchant_legal_name')
      .eq('user_id', userId);
    if (purchaseError) throw new Error(`Tracking bridge V2.3 purchase read failed: ${purchaseError.message}`);
    const purchaseRows = (purchaseData ?? []) as PurchaseRow[];
    if (purchaseRows.length === 0) continue;

    const purchases: TrackingBridgePurchase[] = purchaseRows.map((row) => ({
      purchaseId: row.id,
      userId: row.user_id,
      expectedCarrier: row.expected_carrier,
      merchantName: row.merchant_name,
      merchantLegalName: row.merchant_legal_name,
    }));
    const purchaseIds = purchaseRows.map((row) => row.id);

    const { data: shipmentData, error: shipmentError } = await db
      .from('shipments')
      .select('purchase_id,user_id,carrier_slug,tracking_number')
      .eq('user_id', userId);
    if (shipmentError) throw new Error(`Tracking bridge V2.3 shipment read failed: ${shipmentError.message}`);
    const shipments: TrackingBridgeExistingShipment[] = ((shipmentData ?? []) as ShipmentRow[]).map((row) => ({
      purchaseId: row.purchase_id,
      userId: row.user_id,
      carrierSlug: row.carrier_slug,
      trackingNumber: row.tracking_number,
    }));

    const { data: linkData, error: linkError } = await db
      .from('purchase_sources')
      .select('purchase_id,source_email_id')
      .in('purchase_id', purchaseIds);
    if (linkError) throw new Error(`Tracking bridge V2.3 source-link read failed: ${linkError.message}`);
    const links = (linkData ?? []) as PurchaseSourceRow[];
    const sourceIds = [...new Set(links.map((row) => row.source_email_id))];

    const anchors: TrackingBridgeMerchantAnchor[] = [];
    if (sourceIds.length > 0) {
      const { data: anchorSourceData, error: anchorSourceError } = await db
        .from('source_emails')
        .select('id,user_id,from_address,subject,received_at,validation_status,validated_result')
        .in('id', sourceIds);
      if (anchorSourceError) throw new Error(`Tracking bridge V2.3 anchor read failed: ${anchorSourceError.message}`);
      const anchorSources = (anchorSourceData ?? []) as SourceRow[];
      const sourceById = new Map(anchorSources.map((row) => [row.id, row]));
      for (const link of links) {
        const source = sourceById.get(link.source_email_id);
        if (!source) continue;
        const anchor = toMerchantAnchor(source, link.purchase_id);
        if (anchor) anchors.push(anchor);
      }
    }

    const candidates = resolveTrackingBridgeCandidates(purchases, shipments, anchors, userEvidence);
    result.clusters += candidates.length;

    for (const candidate of candidates) {
      if (candidate.decision === 'review') {
        result.reviewClusters += 1;
        if (mode === 'write' && candidate.sourceEmailIds.length > 0) {
          const { error } = await db
            .from('source_emails')
            .update({ processing_status: 'review' })
            .in('id', candidate.sourceEmailIds);
          if (error) throw new Error(`Tracking bridge V2.3 review update failed: ${error.message}`);
        }
        continue;
      }

      if (candidate.decision !== 'linkable' || !candidate.purchaseId || !candidate.carrierSlug) {
        result.unmatchedClusters += 1;
        continue;
      }

      const clusterEvidence = userEvidence.filter((row) => candidate.sourceEmailIds.includes(row.sourceEmailId));
      const proofShipmentEvidence = clusterEvidence.filter(
        (row) => candidate.shipmentProofSourceEmailIds.includes(row.sourceEmailId),
      );
      if (clusterEvidence.length === 0 || proofShipmentEvidence.length === 0) {
        result.failedClusters += 1;
        continue;
      }

      if (mode === 'observe') {
        result.linkedClusters += 1;
        result.linkedSources += clusterEvidence.length;
        continue;
      }

      try {
        const { data: liveShipmentData, error: liveShipmentError } = await db
          .from('shipments')
          .select('tracking_number')
          .eq('user_id', userId)
          .eq('purchase_id', candidate.purchaseId)
          .eq('carrier_slug', candidate.carrierSlug)
          .not('tracking_number', 'is', null);
        if (liveShipmentError) throw new Error(`Tracking bridge V2.3 live conflict read failed: ${liveShipmentError.message}`);
        const liveConflict = (liveShipmentData ?? []).some((row: { tracking_number: string | null }) => {
          const current = normalizeTracking(row.tracking_number);
          return Boolean(current && current !== normalizeTracking(candidate.trackingNumber));
        });
        if (liveConflict) {
          result.reviewClusters += 1;
          const { error: reviewError } = await db
            .from('source_emails')
            .update({ processing_status: 'review' })
            .in('id', candidate.sourceEmailIds);
          if (reviewError) throw new Error(`Tracking bridge V2.3 conflict review update failed: ${reviewError.message}`);
          continue;
        }

        const deliveredRows = clusterEvidence.filter((row) => row.eventType === 'delivery');
        const shippedAt = earliest(proofShipmentEvidence);
        const carrierDeliveredAt = earliest(deliveredRows);
        const carrierLastEventAt = latest(clusterEvidence);
        const primary = [...proofShipmentEvidence]
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0];
        if (!primary || !shippedAt || !carrierLastEventAt) throw new Error('tracking bridge timestamps are incomplete');

        const merchantDeliveredAt = candidate.reasons.includes('merchant_delivery_corroborates_bridge')
          ? corroboratedMerchantDeliveryAt(anchors, candidate.purchaseId, shippedAt)
          : null;
        const deliveredAt = carrierDeliveredAt ?? merchantDeliveredAt;
        const lastEventAt = laterTimestamp(carrierLastEventAt, deliveredAt);

        const { error: upsertError } = await db.rpc('controlled_upsert_shipment_with_sources', {
          p_user_id: userId,
          p_purchase_id: candidate.purchaseId,
          p_carrier: canonicalCarrierName(candidate.carrierSlug),
          p_carrier_slug: candidate.carrierSlug,
          p_tracking_number: candidate.trackingNumber,
          p_status: deliveredAt ? 'delivered' : 'in_transit',
          p_shipped_at: shippedAt,
          p_delivered_at: deliveredAt,
          p_last_event_at: lastEventAt,
          p_source_email_id: primary.sourceEmailId,
          p_confidence: candidate.confidence,
          p_sources: clusterEvidence.map((row) => ({
            source_email_id: row.sourceEmailId,
            confidence: row.confidence,
          })),
        });
        if (upsertError) throw new Error(`Tracking bridge V2.3 shipment upsert failed: ${upsertError.message}`);

        const { error: statusError } = await db
          .from('source_emails')
          .update({ processing_status: 'processed' })
          .in('id', candidate.sourceEmailIds);
        if (statusError) throw new Error(`Tracking bridge V2.3 source status failed: ${statusError.message}`);

        result.linkedClusters += 1;
        result.linkedSources += clusterEvidence.length;
      } catch {
        result.failedClusters += 1;
      }
    }
  }

  return result;
}
