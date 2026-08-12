import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveShipmentCandidates,
  type ShipmentPurchaseIdentity,
  type ShipmentResolutionEvidence,
} from '../resolution/shipment-resolution.js';

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

async function main() {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;

  const [{ data: purchaseRows, error: purchaseError }, { data: emailRows, error: emailError }] =
    await Promise.all([
      db
        .from('purchases')
        .select('id,user_id,merchant_domain,order_number'),
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

  const purchases: ShipmentPurchaseIdentity[] = ((purchaseRows ?? []) as PurchaseRow[]).map(
    (row) => ({
      purchaseId: row.id,
      userId: row.user_id,
      merchantDomain: row.merchant_domain,
      orderNumber: row.order_number,
    }),
  );

  const evidence = ((emailRows ?? []) as SourceEmailRow[])
    .map(toEvidence)
    .filter(
      (row: ShipmentResolutionEvidence | null): row is ShipmentResolutionEvidence =>
        Boolean(row),
    );

  const candidates = resolveShipmentCandidates(purchases, evidence);
  const decisionCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  let evidenceInLinkableCandidates = 0;
  let carrierEvidenceInLinkableCandidates = 0;

  for (const candidate of candidates) {
    decisionCounts[candidate.decision] =
      (decisionCounts[candidate.decision] ?? 0) + 1;
    statusCounts[candidate.recommendedStatus] =
      (statusCounts[candidate.recommendedStatus] ?? 0) + 1;

    if (candidate.decision === 'linkable') {
      evidenceInLinkableCandidates += candidate.evidenceCount;
      carrierEvidenceInLinkableCandidates += candidate.carrierEvidenceCount;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'shipment_resolution_dry_run',
        safety: {
          databaseWrites: false,
          shipmentWrites: false,
          purchaseUpdates: false,
          openAiCalls: false,
          carrierOrderIdsCannotAnchorPurchases: true,
          merchantOrderAnchorRequired: true,
          userScopedResolution: true,
          publicLogContainsIdentifiers: false,
        },
        purchasesLoaded: purchases.length,
        shipmentLifecycleEmailsLoaded: evidence.length,
        trackingCandidateGroups: candidates.length,
        decisionCounts,
        recommendedStatusCounts: statusCounts,
        linkableCandidateCount: decisionCounts.linkable ?? 0,
        evidenceInLinkableCandidates,
        carrierEvidenceInLinkableCandidates,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    'Shipment resolution dry run failed:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exit(1);
});
