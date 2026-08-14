import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { isCarrierSenderDomain } from '../email/sender-role.js';
import {
  historicalReconstructionGroupKey,
  resolveHistoricalPurchaseReconstructions,
  type HistoricalReconstructionEvidence,
  type HistoricalReconstructionEventType,
  type HistoricalReconstructionExistingPurchase,
  type HistoricalReconstructionSearchProof,
} from '../resolution/historical-purchase-reconstruction.js';
import { invoiceAnchorRecoveryDedupeKey } from './invoice-anchor-recovery-v1.js';

const LOOKBACK_DAYS = 90;
const EVENT_TYPES = new Set<HistoricalReconstructionEventType>([
  'order_created',
  'order_updated',
  'payment_completed',
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'refund',
  'return',
  'subscription',
  'other',
]);

interface SourceRow {
  id: string;
  user_id: string;
  email_connection_id: string;
  from_address: string | null;
  received_at: string;
  processing_status: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_domain: string | null;
  order_number: string | null;
  merchant_legal_name: string | null;
  expected_carrier: string | null;
}

interface ScanJobRow {
  id: string;
  user_id: string;
  email_connection_id: string;
  kind: string;
  window_days: number;
  search_term: string | null;
  automatic_dedupe_key: string | null;
  status: string;
  result: Record<string, unknown> | null;
}

export interface HistoricalPurchaseReconstructionV1Result {
  scannedJobs: number;
  candidates: number;
  created: number;
  resolvedSources: number;
  carrierProofSources: number;
  failed: number;
  aiCalls: number;
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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function eventTypeOrNull(value: unknown): HistoricalReconstructionEventType | null {
  return typeof value === 'string' && EVENT_TYPES.has(value as HistoricalReconstructionEventType)
    ? value as HistoricalReconstructionEventType
    : null;
}

function effectiveValidationStatus(source: SourceRow): string | null {
  return stringOrNull(source.validated_result?.validation_status) ?? source.validation_status;
}

function toEvidence(source: SourceRow): HistoricalReconstructionEvidence | null {
  const result = source.validated_result;
  if (!result) return null;
  const confidence = numberOrNull(result.confidence);
  if (confidence === null) return null;
  const domain = senderDomain(source.from_address);

  return {
    sourceEmailId: source.id,
    userId: source.user_id,
    emailConnectionId: source.email_connection_id,
    senderDomain: domain,
    isCarrierSender: isCarrierSenderDomain(domain),
    processingStatus: source.processing_status,
    validationStatus: effectiveValidationStatus(source),
    eventType: eventTypeOrNull(result.event_type),
    merchant: stringOrNull(result.merchant),
    merchantLegalName: stringOrNull(result.merchant_legal_name),
    orderNumber: stringOrNull(result.order_number),
    trackingNumber: stringOrNull(result.tracking_number),
    carrier: stringOrNull(result.carrier),
    paymentStatus: stringOrNull(result.payment_status),
    confidence,
    receivedAt: source.received_at,
  };
}

function normalizedOrder(value: string | null): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizedDomain(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function purchaseKey(row: PurchaseRow): string | null {
  const domain = normalizedDomain(row.merchant_domain);
  const order = normalizedOrder(row.order_number);
  if (!row.user_id || !domain || !order) return null;
  return `${row.user_id}::${domain}::${order}`;
}

function searchProofsForEvidence(
  evidence: HistoricalReconstructionEvidence[],
  jobs: ScanJobRow[],
): HistoricalReconstructionSearchProof[] {
  const proofs = new Map<string, HistoricalReconstructionSearchProof>();

  for (const row of evidence) {
    const key = historicalReconstructionGroupKey(row);
    if (!key) continue;
    const expectedDedupe = invoiceAnchorRecoveryDedupeKey(key, row.emailConnectionId);
    const job = jobs.find((candidate) =>
      candidate.user_id === row.userId &&
      candidate.email_connection_id === row.emailConnectionId &&
      candidate.kind === 'targeted' &&
      candidate.window_days === 90 &&
      candidate.status === 'processed' &&
      candidate.automatic_dedupe_key === expectedDedupe &&
      normalizedOrder(candidate.search_term) === normalizedOrder(row.orderNumber),
    );
    if (!job?.result) continue;

    const checked = numberOrNull(job.result.checked);
    const purchaseWrites = numberOrNull(job.result.purchaseWrites);
    if (checked === null || purchaseWrites === null) continue;

    proofs.set(key, {
      key,
      status: 'processed',
      windowDays: 90,
      checked,
      purchaseWrites,
    });
  }

  return [...proofs.values()];
}

export async function drainHistoricalPurchaseReconstructionV1(
  mode: 'observe' | 'write',
  limit = 200,
): Promise<HistoricalPurchaseReconstructionV1Result> {
  const db = getSupabaseAdmin() as any;
  const result: HistoricalPurchaseReconstructionV1Result = {
    scannedJobs: 0,
    candidates: 0,
    created: 0,
    resolvedSources: 0,
    carrierProofSources: 0,
    failed: 0,
    aiCalls: 0,
  };

  const { data: jobData, error: jobError } = await db
    .from('email_scan_jobs')
    .select('id,user_id,email_connection_id,kind,window_days,search_term,automatic_dedupe_key,status,result')
    .eq('kind', 'targeted')
    .eq('window_days', 90)
    .eq('status', 'processed')
    .not('automatic_dedupe_key', 'is', null)
    .order('processed_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (jobError) {
    throw new Error(`Historical Reconstruction V1 scan-job read failed: ${jobError.message}`);
  }

  const jobs = (jobData ?? []) as ScanJobRow[];
  result.scannedJobs = jobs.length;
  if (jobs.length === 0) return result;

  const userIds = [...new Set(jobs.map((job) => job.user_id))];
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  for (const userId of userIds) {
    try {
      const userJobs = jobs.filter((job) => job.user_id === userId);
      const { data: sourceData, error: sourceError } = await db
        .from('source_emails')
        .select('id,user_id,email_connection_id,from_address,received_at,processing_status,validation_status,validated_result')
        .eq('user_id', userId)
        .in('processing_status', ['review', 'unlinked', 'processed'])
        .not('validated_result', 'is', null)
        .gte('received_at', cutoff)
        .order('received_at', { ascending: true });
      if (sourceError) {
        throw new Error(`Historical Reconstruction V1 source read failed: ${sourceError.message}`);
      }

      const evidence = ((sourceData ?? []) as SourceRow[])
        .map(toEvidence)
        .filter((row: HistoricalReconstructionEvidence | null): row is HistoricalReconstructionEvidence => Boolean(row));
      const proofs = searchProofsForEvidence(evidence, userJobs);
      if (proofs.length === 0) continue;

      const { data: purchaseData, error: purchaseError } = await db
        .from('purchases')
        .select('id,user_id,merchant_domain,order_number,merchant_legal_name,expected_carrier')
        .eq('user_id', userId);
      if (purchaseError) {
        throw new Error(`Historical Reconstruction V1 purchase read failed: ${purchaseError.message}`);
      }

      const purchaseRows = (purchaseData ?? []) as PurchaseRow[];
      const purchases: HistoricalReconstructionExistingPurchase[] = purchaseRows.map((row) => ({
        userId: row.user_id,
        merchantDomain: row.merchant_domain,
        orderNumber: row.order_number,
      }));
      const candidates = resolveHistoricalPurchaseReconstructions(evidence, proofs, purchases);
      result.candidates += candidates.length;

      for (const candidate of candidates) {
        if (mode === 'observe') continue;

        const { data: purchaseId, error: createError } = await db.rpc('controlled_create_purchase_with_sources', {
          p_user_id: candidate.userId,
          p_merchant_name: candidate.merchant,
          p_merchant_domain: candidate.senderDomain,
          p_order_number: candidate.orderNumber,
          p_ordered_at: candidate.orderedAt,
          p_confidence: candidate.confidence,
          p_sources: candidate.sourceLinks.map((row) => ({
            source_email_id: row.sourceEmailId,
            relation_type: row.relationType,
            confidence: row.confidence,
          })),
        });
        if (createError || typeof purchaseId !== 'string' || !purchaseId) {
          throw new Error(`Historical Reconstruction V1 purchase create failed: ${createError?.message ?? 'missing id'}`);
        }

        const key = purchaseKey({
          id: purchaseId,
          user_id: candidate.userId,
          merchant_domain: candidate.senderDomain,
          order_number: candidate.orderNumber,
          merchant_legal_name: candidate.merchantLegalName,
          expected_carrier: candidate.expectedCarrier,
        });
        if (key !== candidate.key) {
          throw new Error('Historical Reconstruction V1 created identity mismatch');
        }

        const { data: savedPurchase, error: savedPurchaseError } = await db
          .from('purchases')
          .select('id,user_id,merchant_domain,order_number,merchant_legal_name,expected_carrier')
          .eq('id', purchaseId)
          .eq('user_id', candidate.userId)
          .single();
        if (savedPurchaseError || !savedPurchase) {
          throw new Error(`Historical Reconstruction V1 created purchase read failed: ${savedPurchaseError?.message ?? 'missing purchase'}`);
        }

        const identityPatch: Record<string, unknown> = {};
        if (!savedPurchase.merchant_legal_name && candidate.merchantLegalName) {
          identityPatch.merchant_legal_name = candidate.merchantLegalName;
        }
        if (!savedPurchase.expected_carrier && candidate.expectedCarrier) {
          identityPatch.expected_carrier = candidate.expectedCarrier;
        }
        if (Object.keys(identityPatch).length > 0) {
          const { error: patchError } = await db
            .from('purchases')
            .update(identityPatch)
            .eq('id', purchaseId)
            .eq('user_id', candidate.userId);
          if (patchError) {
            throw new Error(`Historical Reconstruction V1 identity enrichment failed: ${patchError.message}`);
          }
        }

        const sourceIds = candidate.sourceLinks.map((row) => row.sourceEmailId);
        if (sourceIds.length > 0) {
          const { error: statusError } = await db
            .from('source_emails')
            .update({ processing_status: 'processed' })
            .in('id', sourceIds);
          if (statusError) {
            throw new Error(`Historical Reconstruction V1 source status failed: ${statusError.message}`);
          }
        }

        result.created += 1;
        result.resolvedSources += sourceIds.length;
        result.carrierProofSources += candidate.carrierProofSourceEmailIds.length;
      }
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
