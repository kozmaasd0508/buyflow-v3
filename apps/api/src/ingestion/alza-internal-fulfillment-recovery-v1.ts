import { createHash } from 'node:crypto';
import { getSupabaseAdmin } from '../db/supabase-admin.js';

const LOOKBACK_DAYS = 90;
const MAX_CHAIN_DAYS = 14;
const TRUSTED = new Set(['validated', 'guardrailed']);
const PROCESSING_PARSER = 'alza-order-processing-v2';
const PICKUP_PARSER = 'alza-commerce-v1';
const LIFECYCLE_PARSER = 'deterministic-lifecycle-v1';

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

interface JobRow {
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

export interface AlzaRecoveryEvidence {
  sourceEmailId: string;
  userId: string;
  emailConnectionId: string;
  senderDomain: string;
  receivedAt: string;
  processingStatus: string;
  validationStatus: string | null;
  eventType: string | null;
  lifecycleEvent: string | null;
  parserVersion: string | null;
  orderNumber: string | null;
  total: number | null;
  currency: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  invoiceNumber: string | null;
  shipmentPhase: string | null;
  confidence: number | null;
}

export interface AlzaRecoveryProof {
  userId: string;
  emailConnectionId: string;
  orderNumber: string;
  windowDays: number;
  status: string;
  checked: number;
  purchaseWrites: number;
}

export interface AlzaRecoveryExistingPurchase {
  userId: string;
  merchantDomain: string | null;
  orderNumber: string | null;
}

export interface AlzaRecoveryCandidate {
  userId: string;
  emailConnectionId: string;
  orderNumber: string;
  anchorSourceEmailId: string;
  sourceEmailIds: string[];
  total: number;
  currency: 'HUF';
  paymentStatus: 'pending';
  paymentMethod: string;
  shippingMethod: 'AlzaBox';
  invoiceNumber: string;
  confidence: number;
  reasons: string[];
}

export interface AlzaInternalFulfillmentRecoveryV1Result {
  scanned: number;
  scheduled: number;
  deduped: number;
  candidates: number;
  created: number;
  resolvedSources: number;
  failed: number;
  aiCalls: number;
}

function senderDomain(fromAddress: string | null): string {
  if (!fromAddress) return '';
  const at = fromAddress.lastIndexOf('@');
  return at >= 0 ? fromAddress.slice(at + 1).trim().toLowerCase().replace(/^www\./, '') : '';
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

function normalizeOrder(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function withinDays(a: string, b: string, days: number): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= days * 86_400_000;
}

function effectiveValidation(source: SourceRow): string | null {
  return stringOrNull(source.validated_result?.validation_status) ?? source.validation_status;
}

function toEvidence(source: SourceRow): AlzaRecoveryEvidence | null {
  const result = source.validated_result;
  if (!result) return null;
  return {
    sourceEmailId: source.id,
    userId: source.user_id,
    emailConnectionId: source.email_connection_id,
    senderDomain: senderDomain(source.from_address),
    receivedAt: source.received_at,
    processingStatus: source.processing_status,
    validationStatus: effectiveValidation(source),
    eventType: stringOrNull(result.event_type),
    lifecycleEvent: stringOrNull(result.lifecycle_event),
    parserVersion: stringOrNull(result.parser_version),
    orderNumber: stringOrNull(result.order_number),
    total: numberOrNull(result.total),
    currency: stringOrNull(result.currency)?.toUpperCase() ?? null,
    paymentStatus: stringOrNull(result.payment_status),
    paymentMethod: stringOrNull(result.payment_method),
    shippingMethod: stringOrNull(result.shipping_method),
    invoiceNumber: stringOrNull(result.invoice_number),
    shipmentPhase: stringOrNull(result.shipment_phase),
    confidence: numberOrNull(result.confidence),
  };
}

function groupKey(row: Pick<AlzaRecoveryEvidence, 'userId' | 'emailConnectionId' | 'senderDomain' | 'orderNumber'>): string | null {
  const order = normalizeOrder(row.orderNumber);
  if (!row.userId || !row.emailConnectionId || normalizeDomain(row.senderDomain) !== 'alza.hu' || order.length < 9) return null;
  return `${row.userId}::${row.emailConnectionId}::${order}`;
}

function proofKey(row: Pick<AlzaRecoveryProof, 'userId' | 'emailConnectionId' | 'orderNumber'>): string {
  return `${row.userId}::${row.emailConnectionId}::${normalizeOrder(row.orderNumber)}`;
}

function existingKey(row: AlzaRecoveryExistingPurchase): string {
  return `${row.userId}::${normalizeDomain(row.merchantDomain)}::${normalizeOrder(row.orderNumber)}`;
}

export function alzaInternalFulfillmentDedupeKey(userId: string, emailConnectionId: string, orderNumber: string): string {
  return createHash('sha256')
    .update(`alza-internal-fulfillment-v1|${userId}|${emailConnectionId}|${normalizeOrder(orderNumber)}`)
    .digest('hex');
}

export function resolveAlzaInternalFulfillmentCandidates(
  evidenceRows: AlzaRecoveryEvidence[],
  proofs: AlzaRecoveryProof[],
  purchases: AlzaRecoveryExistingPurchase[] = [],
): AlzaRecoveryCandidate[] {
  const proofByKey = new Map(proofs.map((row) => [proofKey(row), row]));
  const existing = new Set(purchases.map(existingKey));
  const groups = new Map<string, AlzaRecoveryEvidence[]>();

  for (const row of evidenceRows) {
    const key = groupKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const candidates: AlzaRecoveryCandidate[] = [];
  for (const [key, rows] of groups) {
    const first = rows[0]!;
    const orderNumber = normalizeOrder(first.orderNumber);
    if (existing.has(`${first.userId}::alza.hu::${orderNumber}`)) continue;
    if (rows.some((row) => row.eventType === 'order_created' && TRUSTED.has(row.validationStatus ?? ''))) continue;

    const anchors = rows.filter((row) =>
      TRUSTED.has(row.validationStatus ?? '')
      && row.parserVersion === PROCESSING_PARSER
      && row.eventType === 'order_updated'
      && row.lifecycleEvent === 'order_processing'
      && row.confidence !== null
      && row.confidence >= 0.99
      && row.total !== null
      && row.total > 0
      && row.currency === 'HUF'
      && row.paymentStatus === 'pending'
      && Boolean(row.paymentMethod)
      && row.shippingMethod === 'AlzaBox'
      && Boolean(row.invoiceNumber && /^AHUW\d{6,20}$/i.test(row.invoiceNumber))
    );
    if (anchors.length !== 1) continue;
    const anchor = anchors[0]!;

    const auxiliaries = rows.filter((row) =>
      row.sourceEmailId !== anchor.sourceEmailId
      && TRUSTED.has(row.validationStatus ?? '')
      && row.eventType === 'order_updated'
      && row.lifecycleEvent === 'delayed'
      && row.parserVersion === LIFECYCLE_PARSER
      && row.confidence !== null
      && row.confidence >= 0.95
      && withinDays(row.receivedAt, anchor.receivedAt, MAX_CHAIN_DAYS)
    );
    if (auxiliaries.length < 1) continue;

    const pickups = rows.filter((row) =>
      row.sourceEmailId !== anchor.sourceEmailId
      && TRUSTED.has(row.validationStatus ?? '')
      && row.eventType === 'shipment'
      && row.parserVersion === PICKUP_PARSER
      && row.shipmentPhase === 'ready_for_pickup'
      && row.shippingMethod === 'AlzaBox'
      && row.confidence !== null
      && row.confidence >= 0.95
      && withinDays(row.receivedAt, anchor.receivedAt, MAX_CHAIN_DAYS)
    );
    if (pickups.length < 1) continue;

    const proof = proofByKey.get(key);
    if (!proof || proof.status !== 'processed' || proof.windowDays !== 90 || proof.checked < 1 || proof.purchaseWrites !== 0) continue;

    const sourceEmailIds = [...new Set([anchor.sourceEmailId, ...auxiliaries.map((row) => row.sourceEmailId), ...pickups.map((row) => row.sourceEmailId)])];
    candidates.push({
      userId: anchor.userId,
      emailConnectionId: anchor.emailConnectionId,
      orderNumber,
      anchorSourceEmailId: anchor.sourceEmailId,
      sourceEmailIds,
      total: anchor.total!,
      currency: 'HUF',
      paymentStatus: 'pending',
      paymentMethod: anchor.paymentMethod!,
      shippingMethod: 'AlzaBox',
      invoiceNumber: anchor.invoiceNumber!,
      confidence: Math.min(anchor.confidence ?? 0.99, 0.99),
      reasons: [
        'exact_alza_merchant_identity',
        'trusted_processing_anchor_with_financial_identity',
        'explicit_no_contract_processing_parser',
        'ninety_day_exact_order_search_without_purchase',
        'separate_alza_delay_corroboration',
        'separate_alzabox_ready_for_pickup_corroboration',
        'no_order_created_source_exists',
        'internal_fulfillment_requires_no_carrier_tracking',
      ],
    });
  }

  return candidates.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
}

export async function drainAlzaInternalFulfillmentRecoveryV1(
  mode: 'observe' | 'write',
  limit = 200,
): Promise<AlzaInternalFulfillmentRecoveryV1Result> {
  const db = getSupabaseAdmin() as any;
  const result: AlzaInternalFulfillmentRecoveryV1Result = {
    scanned: 0,
    scheduled: 0,
    deduped: 0,
    candidates: 0,
    created: 0,
    resolvedSources: 0,
    failed: 0,
    aiCalls: 0,
  };

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: sourceData, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,email_connection_id,from_address,received_at,processing_status,validation_status,validated_result')
    .in('processing_status', ['review', 'unlinked', 'processed'])
    .not('validated_result', 'is', null)
    .gte('received_at', cutoff)
    .order('received_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (sourceError) throw new Error(`Alza Internal Fulfillment Recovery source read failed: ${sourceError.message}`);

  const sourceRows = (sourceData ?? []) as SourceRow[];
  const evidence = sourceRows.map(toEvidence).filter((row: AlzaRecoveryEvidence | null): row is AlzaRecoveryEvidence => Boolean(row));
  const unresolvedAnchors = evidence.filter((row) =>
    (row.processingStatus === 'review' || row.processingStatus === 'unlinked')
    && normalizeDomain(row.senderDomain) === 'alza.hu'
    && row.parserVersion === PROCESSING_PARSER
    && row.lifecycleEvent === 'order_processing'
    && row.eventType === 'order_updated'
  );
  result.scanned = unresolvedAnchors.length;
  if (unresolvedAnchors.length === 0) return result;

  const userIds = [...new Set(unresolvedAnchors.map((row) => row.userId))];
  const { data: purchaseData, error: purchaseError } = await db
    .from('purchases')
    .select('user_id,merchant_domain,order_number')
    .in('user_id', userIds);
  if (purchaseError) throw new Error(`Alza Internal Fulfillment Recovery purchase read failed: ${purchaseError.message}`);
  const purchases = (purchaseData ?? []) as AlzaRecoveryExistingPurchase[];

  const { data: jobData, error: jobError } = await db
    .from('email_scan_jobs')
    .select('id,user_id,email_connection_id,kind,window_days,search_term,automatic_dedupe_key,status,result')
    .in('user_id', userIds)
    .eq('kind', 'targeted')
    .eq('window_days', 90)
    .eq('status', 'processed')
    .order('processed_at', { ascending: false })
    .limit(500);
  if (jobError) throw new Error(`Alza Internal Fulfillment Recovery proof read failed: ${jobError.message}`);

  const jobs = (jobData ?? []) as JobRow[];
  const proofs: AlzaRecoveryProof[] = jobs.flatMap((job) => {
    const checked = numberOrNull(job.result?.checked);
    const purchaseWrites = numberOrNull(job.result?.purchaseWrites);
    const orderNumber = stringOrNull(job.search_term);
    if (!orderNumber || checked === null || purchaseWrites === null) return [];
    return [{
      userId: job.user_id,
      emailConnectionId: job.email_connection_id,
      orderNumber,
      windowDays: job.window_days,
      status: job.status,
      checked,
      purchaseWrites,
    }];
  });

  const candidates = resolveAlzaInternalFulfillmentCandidates(evidence, proofs, purchases);
  result.candidates = candidates.length;
  if (mode === 'observe') return result;

  const proofKeys = new Set(proofs.map(proofKey));
  for (const anchor of unresolvedAnchors) {
    const orderNumber = normalizeOrder(anchor.orderNumber);
    if (!orderNumber) continue;
    const key = `${anchor.userId}::${anchor.emailConnectionId}::${orderNumber}`;
    if (proofKeys.has(key)) continue;

    try {
      const dedupeKey = alzaInternalFulfillmentDedupeKey(anchor.userId, anchor.emailConnectionId, orderNumber);
      const { data: existingJob, error: existingJobError } = await db.from('email_scan_jobs')
        .select('id').eq('email_connection_id', anchor.emailConnectionId).eq('automatic_dedupe_key', dedupeKey).maybeSingle();
      if (existingJobError) throw new Error(existingJobError.message);
      if (existingJob) {
        result.deduped += 1;
        continue;
      }
      const { data: jobId, error: enqueueError } = await db.rpc('enqueue_automatic_targeted_email_scan', {
        p_user_id: anchor.userId,
        p_email_connection_id: anchor.emailConnectionId,
        p_search_term: orderNumber,
        p_dedupe_key: dedupeKey,
        p_window_days: 90,
      });
      if (enqueueError || typeof jobId !== 'string' || !jobId) throw new Error(enqueueError?.message ?? 'missing job id');
      result.scheduled += 1;
    } catch {
      result.failed += 1;
    }
  }

  for (const candidate of candidates) {
    try {
      const { data: existing, error: existingError } = await db.from('purchases')
        .select('id').eq('user_id', candidate.userId).eq('merchant_domain', 'alza.hu').eq('order_number', candidate.orderNumber).limit(2);
      if (existingError) throw new Error(existingError.message);
      if (Array.isArray(existing) && existing.length > 0) continue;

      const { data: purchaseId, error: createError } = await db.rpc('controlled_create_purchase_with_sources', {
        p_user_id: candidate.userId,
        p_merchant_name: 'Alza.hu',
        p_merchant_domain: 'alza.hu',
        p_order_number: candidate.orderNumber,
        p_ordered_at: null,
        p_confidence: candidate.confidence,
        p_sources: candidate.sourceEmailIds.map((sourceEmailId) => ({
          source_email_id: sourceEmailId,
          relation_type: sourceEmailId === candidate.anchorSourceEmailId ? 'order_updated' : 'lifecycle',
          confidence: candidate.confidence,
        })),
      });
      if (createError || typeof purchaseId !== 'string' || !purchaseId) throw new Error(createError?.message ?? 'missing purchase id');

      const { error: enrichError } = await db.from('purchases').update({
        merchant_legal_name: 'Alza.hu Kft.',
        total_amount: candidate.total,
        currency: candidate.currency,
        payment_status: candidate.paymentStatus,
        payment_method: candidate.paymentMethod,
        shipping_method: candidate.shippingMethod,
        expected_carrier: null,
        current_state: 'ready_for_pickup',
      }).eq('id', purchaseId).eq('user_id', candidate.userId);
      if (enrichError) throw new Error(enrichError.message);

      const { error: statusError } = await db.from('source_emails')
        .update({ processing_status: 'processed' }).in('id', candidate.sourceEmailIds).eq('user_id', candidate.userId);
      if (statusError) throw new Error(statusError.message);

      result.created += 1;
      result.resolvedSources += candidate.sourceEmailIds.length;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
