import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { summarizeShipmentProgress } from '../ingestion/deterministic-lifecycle-state.js';
import {
  monotonicControlledShipmentStatus,
  purchaseStateMatchesShipmentSummary,
} from '../ingestion/journeygraph-controlled-verification.js';
import { selectControlledShipmentCandidate } from '../resolution/controlled-shipment-creation.js';
import {
  normalizeCarrierSlug,
  resolveShipmentCandidates,
  type ShipmentPurchaseIdentity,
  type ShipmentResolutionEvidence,
} from '../resolution/shipment-resolution.js';
import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';

interface SourceEmailRow {
  id: string;
  user_id: string;
  from_address: string | null;
  received_at: string;
  validated_result: Record<string, unknown> | null;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_domain: string | null;
  order_number: string | null;
  current_state: string;
}

function senderDomain(fromAddress: string | null): string {
  if (!fromAddress) return '';
  const match = fromAddress.toLowerCase().match(/@([^>\s,;]+)/);
  return (match?.[1] ?? '').replace(/[)>]+$/, '').trim();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toEvidence(row: SourceEmailRow): ShipmentResolutionEvidence | null {
  const result = row.validated_result;
  if (!result) return null;

  const eventType = result.event_type;
  if (eventType !== 'shipment' && eventType !== 'delivery') return null;

  const confidence = numberOrNull(result.confidence);
  if (confidence === null) return null;

  return {
    sourceEmailId: row.id,
    userId: row.user_id,
    senderDomain: senderDomain(row.from_address),
    eventType,
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    trackingNumber: stringOrNull(result.tracking_number),
    carrier: stringOrNull(result.carrier),
    confidence,
    receivedAt: row.received_at,
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

function earliestTimestamp(rows: ShipmentResolutionEvidence[]): string | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]?.receivedAt ?? null;
}

function latestTimestamp(rows: ShipmentResolutionEvidence[]): string | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]?.receivedAt ?? null;
}

async function main() {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;

  const [{ data: purchaseRows, error: purchaseError }, { data: emailRows, error: emailError }] =
    await Promise.all([
      db
        .from('purchases')
        .select('id,user_id,merchant_domain,order_number,current_state'),
      db
        .from('source_emails')
        .select('id,user_id,from_address,received_at,validated_result')
        .not('validated_result', 'is', null)
        .order('received_at', { ascending: true }),
    ]);

  if (purchaseError) {
    throw new Error(`Failed to load purchases: ${purchaseError.message}`);
  }
  if (emailError) {
    throw new Error(`Failed to load validated source emails: ${emailError.message}`);
  }

  const rawPurchases = (purchaseRows ?? []) as PurchaseRow[];
  const purchases: ShipmentPurchaseIdentity[] = rawPurchases.map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
  }));

  const evidence = ((emailRows ?? []) as SourceEmailRow[])
    .map(toEvidence)
    .filter(
      (row: ShipmentResolutionEvidence | null): row is ShipmentResolutionEvidence =>
        Boolean(row),
    );

  const candidates = resolveShipmentCandidates(purchases, evidence);
  const candidate = selectControlledShipmentCandidate(candidates);
  const candidateEvidence = evidence.filter((row) =>
    candidate.sourceEmailIds.includes(row.sourceEmailId),
  );

  if (candidateEvidence.length !== candidate.sourceEmailIds.length) {
    throw new Error('Controlled shipment candidate evidence set is incomplete');
  }
  if (candidateEvidence.some((row) => row.userId !== candidate.userId)) {
    throw new Error('Controlled shipment candidate contains cross-user evidence');
  }

  const purchaseBefore = rawPurchases.find((row) => row.id === candidate.purchaseId);
  if (!purchaseBefore || purchaseBefore.user_id !== candidate.userId) {
    throw new Error('Controlled shipment candidate purchase is missing or cross-user');
  }

  const primaryMerchantEvidence = candidateEvidence.find(
    (row) => !isCarrierSenderDomain(row.senderDomain) && Boolean(row.orderNumber),
  );
  if (!primaryMerchantEvidence) {
    throw new Error('Controlled shipment candidate has no merchant anchor evidence');
  }

  const shipmentEvents = candidateEvidence.filter((row) => row.eventType === 'shipment');
  const deliveryEvents = candidateEvidence.filter((row) => row.eventType === 'delivery');
  const shippedAt = earliestTimestamp(shipmentEvents);
  const deliveredAt = earliestTimestamp(deliveryEvents);
  const lastEventAt = latestTimestamp(candidateEvidence);

  if (!shippedAt || !lastEventAt) {
    throw new Error('Controlled shipment candidate timestamps are incomplete');
  }
  if (candidate.recommendedStatus === 'delivered' && !deliveredAt) {
    throw new Error('Delivered controlled shipment has no delivery evidence');
  }

  const carrierSlug = candidate.carrierSlug;
  if (!carrierSlug) {
    throw new Error('Controlled shipment candidate carrier is ambiguous');
  }

  const carrier = canonicalCarrierName(carrierSlug);
  const trackingNumber = candidate.trackingNumber;

  const { data: existingRows, error: existingError } = await db
    .from('shipments')
    .select('id,purchase_id,status')
    .eq('user_id', candidate.userId)
    .eq('carrier_slug', carrierSlug)
    .eq('tracking_number', trackingNumber)
    .limit(1);

  if (existingError) {
    throw new Error(`Failed to check existing shipment: ${existingError.message}`);
  }

  const existedBefore = Array.isArray(existingRows) && existingRows.length > 0;
  if (existedBefore && existingRows[0]?.purchase_id && existingRows[0].purchase_id !== candidate.purchaseId) {
    throw new Error('Existing tracking identity belongs to another purchase');
  }

  const expectedShipmentStatus = monotonicControlledShipmentStatus(
    existedBefore && typeof existingRows[0]?.status === 'string' ? existingRows[0].status : null,
    candidate.recommendedStatus,
  );

  const sources = candidateEvidence.map((row) => ({
    source_email_id: row.sourceEmailId,
    confidence: row.confidence,
  }));

  const { data: shipmentId, error: createError } = await db.rpc(
    'controlled_upsert_shipment_with_sources',
    {
      p_user_id: candidate.userId,
      p_purchase_id: candidate.purchaseId,
      p_carrier: carrier,
      p_carrier_slug: carrierSlug,
      p_tracking_number: trackingNumber,
      p_status: candidate.recommendedStatus,
      p_shipped_at: shippedAt,
      p_delivered_at: deliveredAt,
      p_last_event_at: lastEventAt,
      p_source_email_id: primaryMerchantEvidence.sourceEmailId,
      p_confidence: candidate.confidence,
      p_sources: sources,
    },
  );

  if (createError) {
    throw new Error(`Controlled shipment RPC failed: ${createError.message}`);
  }
  if (typeof shipmentId !== 'string' || !shipmentId) {
    throw new Error('Controlled shipment RPC returned no shipment id');
  }

  const { data: shipmentRows, error: shipmentVerifyError } = await db
    .from('shipments')
    .select('id,purchase_id,status,carrier_slug,tracking_number')
    .eq('id', shipmentId)
    .limit(1);

  if (shipmentVerifyError) {
    throw new Error(`Failed to verify shipment: ${shipmentVerifyError.message}`);
  }

  const shipment = shipmentRows?.[0];
  if (!shipment || shipment.purchase_id !== candidate.purchaseId) {
    throw new Error('Controlled shipment verification failed');
  }
  if (shipment.status !== expectedShipmentStatus) {
    throw new Error('Controlled shipment monotonic status verification failed');
  }

  const { count: linkedEvidenceCount, error: evidenceCountError } = await db
    .from('purchase_sources')
    .select('source_email_id', { count: 'exact', head: true })
    .eq('purchase_id', candidate.purchaseId)
    .in('source_email_id', candidate.sourceEmailIds);

  if (evidenceCountError) {
    throw new Error(`Failed to verify shipment evidence links: ${evidenceCountError.message}`);
  }
  if (linkedEvidenceCount !== candidate.sourceEmailIds.length) {
    throw new Error(
      `Controlled shipment evidence verification failed: expected ${candidate.sourceEmailIds.length}, got ${linkedEvidenceCount ?? 0}`,
    );
  }

  const [
    { data: purchaseAfterRows, error: purchaseAfterError },
    { data: purchaseShipmentRows, error: purchaseShipmentsError },
  ] = await Promise.all([
    db.from('purchases').select('current_state').eq('id', candidate.purchaseId).limit(1),
    db
      .from('shipments')
      .select('status,shipped_at,delivered_at,last_event_at')
      .eq('user_id', candidate.userId)
      .eq('purchase_id', candidate.purchaseId),
  ]);

  if (purchaseAfterError) {
    throw new Error(`Failed to verify purchase state: ${purchaseAfterError.message}`);
  }
  if (purchaseShipmentsError) {
    throw new Error(`Failed to verify aggregate shipment state: ${purchaseShipmentsError.message}`);
  }

  const purchaseAfterState = purchaseAfterRows?.[0]?.current_state;
  const shipmentProgress = summarizeShipmentProgress(
    (purchaseShipmentRows ?? []) as Array<Record<string, unknown>>,
  );

  if (!purchaseStateMatchesShipmentSummary(purchaseAfterState, shipmentProgress)) {
    throw new Error('Controlled shipment aggregate purchase-state verification failed');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'controlled_shipment_creation',
        safety: {
          maxLinkableCandidates: 1,
          requiresAtLeastThreeEvidenceEmails: true,
          requiresTrustedMerchantAnchor: true,
          requiresAtLeastTwoCarrierEvidenceEmails: true,
          userScopedResolution: true,
          databaseTrackingIdentityGuard: true,
          atomicShipmentPurchaseAndSourceWrite: true,
          aggregatePurchaseStateVerification: true,
          documentWrites: false,
          openAiCalls: false,
          publicLogContainsIdentifiers: false,
        },
        action: existedBefore ? 'reused_idempotently' : 'created',
        candidateDecision: candidate.decision,
        recommendedStatus: candidate.recommendedStatus,
        evidenceLinked: linkedEvidenceCount,
        carrierEvidence: candidate.carrierEvidenceCount,
        shipmentWrites: existedBefore ? 0 : 1,
        purchaseStateChanged: purchaseBefore.current_state !== purchaseAfterState,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    'Controlled shipment creation failed:',
    error instanceof Error ? error.message.replace(/[0-9a-f-]{20,}/gi, '[redacted]') : 'UnknownError',
  );
  process.exit(1);
});
