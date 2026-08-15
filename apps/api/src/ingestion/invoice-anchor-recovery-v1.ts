import { createHash } from 'node:crypto';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveInvoiceAnchorRecoveryPlans,
  type InvoiceAnchorEvidence,
  type InvoiceAnchorEventType,
  type InvoiceAnchorExistingPurchase,
} from '../resolution/invoice-anchor-recovery.js';
import { drainInvoiceAttachmentRecoveryV1 } from './invoice-attachment-recovery-v1.js';

const LOOKBACK_DAYS = 90;
const EVENT_TYPES = new Set<InvoiceAnchorEventType>([
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
  user_id: string;
  merchant_domain: string | null;
  order_number: string | null;
}

export interface InvoiceAnchorRecoveryV1Result {
  scanned: number;
  plans: number;
  scheduled: number;
  deduped: number;
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

function eventTypeOrNull(value: unknown): InvoiceAnchorEventType | null {
  return typeof value === 'string' && EVENT_TYPES.has(value as InvoiceAnchorEventType)
    ? value as InvoiceAnchorEventType
    : null;
}

function effectiveValidationStatus(source: SourceRow): string | null {
  return stringOrNull(source.validated_result?.validation_status) ?? source.validation_status;
}

function toEvidence(source: SourceRow): InvoiceAnchorEvidence | null {
  const result = source.validated_result;
  if (!result) return null;
  const confidence = numberOrNull(result.confidence);
  if (confidence === null) return null;

  return {
    sourceEmailId: source.id,
    userId: source.user_id,
    emailConnectionId: source.email_connection_id,
    senderDomain: senderDomain(source.from_address),
    processingStatus: source.processing_status,
    validationStatus: effectiveValidationStatus(source),
    eventType: eventTypeOrNull(result.event_type),
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    invoiceNumber: stringOrNull(result.invoice_number),
    paymentStatus: stringOrNull(result.payment_status),
    confidence,
    receivedAt: source.received_at,
  };
}

export function invoiceAnchorRecoveryDedupeKey(planKey: string, emailConnectionId: string): string {
  return createHash('sha256')
    .update(`invoice-anchor-v1|${emailConnectionId}|${planKey}`)
    .digest('hex');
}

export async function drainInvoiceAnchorRecoveryV1(
  mode: 'observe' | 'write',
  limit = 200,
): Promise<InvoiceAnchorRecoveryV1Result> {
  await drainInvoiceAttachmentRecoveryV1(mode, Math.min(limit, 40));

  const db = getSupabaseAdmin() as any;
  const result: InvoiceAnchorRecoveryV1Result = {
    scanned: 0,
    plans: 0,
    scheduled: 0,
    deduped: 0,
    failed: 0,
    aiCalls: 0,
  };

  const { data: unresolvedData, error: unresolvedError } = await db
    .from('source_emails')
    .select('id,user_id,email_connection_id,from_address,received_at,processing_status,validation_status,validated_result')
    .in('processing_status', ['review', 'unlinked'])
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (unresolvedError) {
    throw new Error(`Invoice Anchor Recovery V1 unresolved read failed: ${unresolvedError.message}`);
  }

  const unresolvedRows = (unresolvedData ?? []) as SourceRow[];
  const invoiceRows = unresolvedRows.filter((row) => row.validated_result?.event_type === 'invoice_or_receipt');
  result.scanned = invoiceRows.length;
  if (invoiceRows.length === 0) return result;

  const userIds = [...new Set(invoiceRows.map((row) => row.user_id))];
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  for (const userId of userIds) {
    try {
      const { data: evidenceData, error: evidenceError } = await db
        .from('source_emails')
        .select('id,user_id,email_connection_id,from_address,received_at,processing_status,validation_status,validated_result')
        .eq('user_id', userId)
        .in('processing_status', ['review', 'unlinked', 'processed'])
        .not('validated_result', 'is', null)
        .gte('received_at', cutoff)
        .order('received_at', { ascending: true });
      if (evidenceError) {
        throw new Error(`Invoice Anchor Recovery V1 evidence read failed: ${evidenceError.message}`);
      }

      const evidence = ((evidenceData ?? []) as SourceRow[])
        .map(toEvidence)
        .filter((row: InvoiceAnchorEvidence | null): row is InvoiceAnchorEvidence => Boolean(row));

      const { data: purchaseData, error: purchaseError } = await db
        .from('purchases')
        .select('user_id,merchant_domain,order_number')
        .eq('user_id', userId);
      if (purchaseError) {
        throw new Error(`Invoice Anchor Recovery V1 purchase read failed: ${purchaseError.message}`);
      }

      const purchases: InvoiceAnchorExistingPurchase[] = ((purchaseData ?? []) as PurchaseRow[]).map((row) => ({
        userId: row.user_id,
        merchantDomain: row.merchant_domain,
        orderNumber: row.order_number,
      }));

      const plans = resolveInvoiceAnchorRecoveryPlans(evidence, purchases)
        .filter((plan) => invoiceRows.some((row) => row.id === plan.anchorSourceEmailId));
      result.plans += plans.length;

      if (mode === 'observe') continue;

      for (const plan of plans) {
        const automaticDedupeKey = invoiceAnchorRecoveryDedupeKey(plan.key, plan.emailConnectionId);
        const { data: existingJob, error: existingJobError } = await db
          .from('email_scan_jobs')
          .select('id,status')
          .eq('email_connection_id', plan.emailConnectionId)
          .eq('automatic_dedupe_key', automaticDedupeKey)
          .maybeSingle();
        if (existingJobError) {
          throw new Error(`Invoice Anchor Recovery V1 dedupe read failed: ${existingJobError.message}`);
        }
        if (existingJob) {
          result.deduped += 1;
          continue;
        }

        const { data: jobId, error: enqueueError } = await db.rpc('enqueue_automatic_targeted_email_scan', {
          p_user_id: plan.userId,
          p_email_connection_id: plan.emailConnectionId,
          p_search_term: plan.searchTerm,
          p_dedupe_key: automaticDedupeKey,
          p_window_days: plan.windowDays,
        });
        if (enqueueError || typeof jobId !== 'string' || !jobId) {
          throw new Error(`Invoice Anchor Recovery V1 enqueue failed: ${enqueueError?.message ?? 'missing job id'}`);
        }
        result.scheduled += 1;
      }
    } catch {
      result.failed += invoiceRows.filter((row) => row.user_id === userId).length;
    }
  }

  return result;
}
