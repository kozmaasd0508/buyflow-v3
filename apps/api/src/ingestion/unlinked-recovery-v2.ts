import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveExistingPurchase,
  type ExistingPurchaseEvidence,
  type ExistingPurchaseIdentity,
  type ExistingPurchaseResolutionEventType,
  type ExistingShipmentIdentity,
  type LinkedThreadIdentity,
} from '../resolution/existing-purchase-resolution.js';
import { isTrustedAutomaticEvidence } from '../pipeline/automatic-write-gate.js';

const LINKABLE_EVENT_TYPES = new Set<ExistingPurchaseResolutionEventType>([
  'order_updated',
  'payment_completed',
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'refund',
  'return',
]);

interface UnlinkedSourceRow {
  id: string;
  user_id: string;
  provider_thread_id: string | null;
  from_address: string | null;
  received_at: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
  processing_status: string;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_name: string | null;
  merchant_domain: string | null;
  order_number: string | null;
  total_amount: number | string | null;
  currency: string | null;
  ordered_at: string | null;
}

interface ShipmentRow {
  purchase_id: string;
  user_id: string;
  tracking_number: string | null;
}

interface PurchaseSourceRow {
  purchase_id: string;
  source_email_id: string;
}

interface ThreadSourceRow {
  id: string;
  user_id: string;
  provider_thread_id: string | null;
}

export interface UnlinkedRecoveryResult {
  scanned: number;
  linked: number;
  healed: number;
  review: number;
  unmatched: number;
  failed: number;
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
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function eventTypeOrNull(value: unknown): ExistingPurchaseResolutionEventType | null {
  return typeof value === 'string' && LINKABLE_EVENT_TYPES.has(value as ExistingPurchaseResolutionEventType)
    ? value as ExistingPurchaseResolutionEventType
    : null;
}

function toEvidence(source: UnlinkedSourceRow): ExistingPurchaseEvidence | null {
  const result = source.validated_result;
  if (!result || !isTrustedAutomaticEvidence(source.validation_status, result)) return null;
  const eventType = eventTypeOrNull(result.event_type);
  const confidence = numericOrNull(result.confidence);
  if (!eventType || confidence === null) return null;

  return {
    sourceEmailId: source.id,
    userId: source.user_id,
    senderDomain: senderDomain(source.from_address),
    providerThreadId: source.provider_thread_id,
    eventType,
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    trackingNumber: stringOrNull(result.tracking_number),
    total: numericOrNull(result.total) ?? numericOrNull(result.paid_amount),
    currency: stringOrNull(result.currency) ?? stringOrNull(result.paid_currency),
    confidence,
    receivedAt: source.received_at,
  };
}

function paymentPayload(result: Record<string, unknown>) {
  return {
    order_number: stringOrNull(result.order_number),
    payment_status: stringOrNull(result.payment_status),
    payment_method: stringOrNull(result.payment_method),
    paid_amount: numericOrNull(result.paid_amount),
    paid_currency: stringOrNull(result.paid_currency)?.toUpperCase() ?? null,
  };
}

async function recoverUser(
  userId: string,
  sources: UnlinkedSourceRow[],
  mode: 'observe' | 'write',
): Promise<Omit<UnlinkedRecoveryResult, 'scanned' | 'failed'>> {
  const db = getSupabaseAdmin() as any;
  const result = { linked: 0, healed: 0, review: 0, unmatched: 0 };

  const { data: purchaseData, error: purchaseError } = await db
    .from('purchases')
    .select('id,user_id,merchant_name,merchant_domain,order_number,total_amount,currency,ordered_at')
    .eq('user_id', userId);
  if (purchaseError) throw new Error(`Unlinked V2 purchase read failed: ${purchaseError.message}`);

  const purchaseRows = (purchaseData ?? []) as PurchaseRow[];
  if (purchaseRows.length === 0) {
    result.unmatched += sources.length;
    return result;
  }

  const purchaseIds = purchaseRows.map((row) => row.id);
  const purchases: ExistingPurchaseIdentity[] = purchaseRows.map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    merchantName: row.merchant_name,
    orderNumber: row.order_number,
    totalAmount: numericOrNull(row.total_amount),
    currency: row.currency,
    orderedAt: row.ordered_at,
  }));

  const { data: shipmentData, error: shipmentError } = await db
    .from('shipments')
    .select('purchase_id,user_id,tracking_number')
    .eq('user_id', userId)
    .not('tracking_number', 'is', null);
  if (shipmentError) throw new Error(`Unlinked V2 shipment read failed: ${shipmentError.message}`);
  const shipments: ExistingShipmentIdentity[] = ((shipmentData ?? []) as ShipmentRow[]).map((row) => ({
    purchaseId: row.purchase_id,
    userId: row.user_id,
    trackingNumber: row.tracking_number,
  }));

  const { data: linkData, error: linkError } = await db
    .from('purchase_sources')
    .select('purchase_id,source_email_id')
    .in('purchase_id', purchaseIds);
  if (linkError) throw new Error(`Unlinked V2 source-link read failed: ${linkError.message}`);
  const links = (linkData ?? []) as PurchaseSourceRow[];

  const purchaseIdsBySource = new Map<string, Set<string>>();
  for (const link of links) {
    const set = purchaseIdsBySource.get(link.source_email_id) ?? new Set<string>();
    set.add(link.purchase_id);
    purchaseIdsBySource.set(link.source_email_id, set);
  }

  const linkedSourceIds = [...new Set(links.map((link) => link.source_email_id))];
  let linkedThreads: LinkedThreadIdentity[] = [];
  if (linkedSourceIds.length > 0) {
    const { data: threadData, error: threadError } = await db
      .from('source_emails')
      .select('id,user_id,provider_thread_id')
      .in('id', linkedSourceIds);
    if (threadError) throw new Error(`Unlinked V2 thread read failed: ${threadError.message}`);
    const threadRows = (threadData ?? []) as ThreadSourceRow[];
    linkedThreads = threadRows.flatMap((row) => {
      if (!row.provider_thread_id) return [];
      return [...(purchaseIdsBySource.get(row.id) ?? [])].map((purchaseId) => ({
        purchaseId,
        userId: row.user_id,
        providerThreadId: row.provider_thread_id,
      }));
    });
  }

  for (const source of sources) {
    const existingPurchaseIds = purchaseIdsBySource.get(source.id) ?? new Set<string>();
    if (existingPurchaseIds.size === 1) {
      result.healed += 1;
      if (mode === 'write') {
        await db.from('source_emails').update({ processing_status: 'processed' }).eq('id', source.id);
      }
      continue;
    }
    if (existingPurchaseIds.size > 1) {
      result.review += 1;
      if (mode === 'write') {
        await db.from('source_emails').update({ processing_status: 'review' }).eq('id', source.id);
      }
      continue;
    }

    const evidence = toEvidence(source);
    if (!evidence) {
      result.unmatched += 1;
      continue;
    }

    const resolution = resolveExistingPurchase(evidence, purchases, shipments, linkedThreads);
    if (resolution.decision === 'review') {
      result.review += 1;
      if (mode === 'write') {
        await db.from('source_emails').update({ processing_status: 'review' }).eq('id', source.id);
      }
      continue;
    }
    if (resolution.decision !== 'linkable' || !resolution.purchaseId) {
      result.unmatched += 1;
      continue;
    }

    if (mode === 'observe') {
      result.linked += 1;
      continue;
    }

    const { error: upsertError } = await db.from('purchase_sources').upsert({
      purchase_id: resolution.purchaseId,
      source_email_id: source.id,
      relation_type: evidence.eventType,
      confidence: evidence.confidence,
    }, { onConflict: 'purchase_id,source_email_id' });
    if (upsertError) throw new Error(`Unlinked V2 source link failed: ${upsertError.message}`);

    if (evidence.eventType === 'payment_completed' && source.validated_result) {
      const { error: paymentError } = await db.rpc('controlled_apply_payment_evidence', {
        p_user_id: userId,
        p_purchase_id: resolution.purchaseId,
        p_source_email_id: source.id,
        p_payment: paymentPayload(source.validated_result),
      });
      if (paymentError) throw new Error(`Unlinked V2 payment apply failed: ${paymentError.message}`);
    }

    const { error: statusError } = await db
      .from('source_emails')
      .update({ processing_status: 'processed' })
      .eq('id', source.id);
    if (statusError) throw new Error(`Unlinked V2 status update failed: ${statusError.message}`);

    const linkedSet = purchaseIdsBySource.get(source.id) ?? new Set<string>();
    linkedSet.add(resolution.purchaseId);
    purchaseIdsBySource.set(source.id, linkedSet);
    if (source.provider_thread_id) {
      linkedThreads.push({
        purchaseId: resolution.purchaseId,
        userId,
        providerThreadId: source.provider_thread_id,
      });
    }
    result.linked += 1;
  }

  return result;
}

export async function drainUnlinkedRecoveryV2(
  mode: 'observe' | 'write',
  limit = 100,
): Promise<UnlinkedRecoveryResult> {
  const db = getSupabaseAdmin() as any;
  const { data, error } = await db
    .from('source_emails')
    .select('id,user_id,provider_thread_id,from_address,received_at,validation_status,validated_result,processing_status')
    .eq('processing_status', 'unlinked')
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`Unlinked V2 recovery read failed: ${error.message}`);

  const rows = (data ?? []) as UnlinkedSourceRow[];
  const result: UnlinkedRecoveryResult = {
    scanned: rows.length,
    linked: 0,
    healed: 0,
    review: 0,
    unmatched: 0,
    failed: 0,
  };

  const byUser = new Map<string, UnlinkedSourceRow[]>();
  for (const row of rows) {
    const group = byUser.get(row.user_id) ?? [];
    group.push(row);
    byUser.set(row.user_id, group);
  }

  for (const [userId, sources] of byUser) {
    try {
      const userResult = await recoverUser(userId, sources, mode);
      result.linked += userResult.linked;
      result.healed += userResult.healed;
      result.review += userResult.review;
      result.unmatched += userResult.unmatched;
    } catch {
      result.failed += sources.length;
    }
  }

  return result;
}
