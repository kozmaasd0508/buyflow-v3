import { createHash } from 'node:crypto';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { isCarrierSenderDomain } from '../email/sender-role.js';
import { isTrustedAutomaticEvidence } from '../pipeline/automatic-write-gate.js';

const RECOVERABLE_EVENT_TYPES = new Set([
  'order_updated',
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'return',
  'refund',
]);

interface SourceEmailForRecovery {
  id: string;
  user_id: string;
  email_connection_id: string;
  from_address: string | null;
  received_at: string | null;
  processing_status: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
}

export interface AutomaticTargetedRecoveryPlan {
  searchTerm: string;
  dedupeKey: string;
  windowDays: 30;
}

function senderDomain(fromAddress: string | null): string {
  if (!fromAddress) return '';
  const match = fromAddress.toLowerCase().match(/@([^>\s,;]+)/);
  return (match?.[1] ?? '').replace(/[)>]+$/, '').trim();
}

function monthBucket(receivedAt: string | null): string {
  if (!receivedAt) return 'unknown';
  const parsed = new Date(receivedAt);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return parsed.toISOString().slice(0, 7);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildAutomaticTargetedRecoveryPlan(
  source: Pick<
    SourceEmailForRecovery,
    | 'from_address'
    | 'received_at'
    | 'processing_status'
    | 'validation_status'
    | 'validated_result'
  >,
): AutomaticTargetedRecoveryPlan | null {
  if (source.processing_status !== 'unlinked') return null;

  const validated = source.validated_result;
  if (!validated || !isTrustedAutomaticEvidence(source.validation_status, validated)) {
    return null;
  }

  const eventType = stringOrNull(validated.event_type);
  const orderNumber = stringOrNull(validated.order_number);
  const confidence = numberOrNull(validated.confidence);
  const domain = senderDomain(source.from_address);

  if (!eventType || !RECOVERABLE_EVENT_TYPES.has(eventType)) return null;
  if (!orderNumber || orderNumber.length < 2 || orderNumber.length > 120) return null;
  if (confidence === null || confidence < 0.85) return null;
  if (!domain || isCarrierSenderDomain(domain)) return null;

  const dedupeMaterial = `${domain}|${orderNumber.toLowerCase()}|${monthBucket(source.received_at)}`;
  const dedupeKey = createHash('sha256').update(dedupeMaterial).digest('hex');

  return {
    searchTerm: orderNumber,
    dedupeKey,
    windowDays: 30,
  };
}

export async function enqueueAutomaticTargetedRecoveryForSource(
  sourceEmailId: string,
): Promise<{ eligible: boolean; jobId?: string }> {
  const db = getSupabaseAdmin() as any;
  const { data: source, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,email_connection_id,from_address,received_at,processing_status,validation_status,validated_result')
    .eq('id', sourceEmailId)
    .maybeSingle();

  if (sourceError) {
    throw new Error(`Automatic targeted recovery source read failed: ${sourceError.message}`);
  }
  if (!source) return { eligible: false };

  const typedSource = source as SourceEmailForRecovery;
  const plan = buildAutomaticTargetedRecoveryPlan(typedSource);
  if (!plan) return { eligible: false };

  const { data: jobId, error: enqueueError } = await db.rpc(
    'enqueue_automatic_targeted_email_scan',
    {
      p_user_id: typedSource.user_id,
      p_email_connection_id: typedSource.email_connection_id,
      p_search_term: plan.searchTerm,
      p_dedupe_key: plan.dedupeKey,
      p_window_days: plan.windowDays,
    },
  );

  if (enqueueError) {
    throw new Error(`Automatic targeted recovery enqueue failed: ${enqueueError.message}`);
  }
  if (typeof jobId !== 'string' || !jobId) {
    throw new Error('Automatic targeted recovery enqueue returned no job id');
  }

  return { eligible: true, jobId };
}
