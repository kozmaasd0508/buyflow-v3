import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveReviewPurchaseCandidates,
  type ReviewPurchaseEvidence,
  type ReviewPurchaseEventType,
} from '../resolution/review-purchase-resolution.js';

const LOOKBACK_DAYS = 60;
const TRUSTED_VALIDATION = new Set(['validated', 'guardrailed']);
const EVENT_TYPES = new Set<ReviewPurchaseEventType>([
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
  from_address: string | null;
  subject: string | null;
  received_at: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
  processing_status: string;
}

interface PurchaseRow {
  id: string;
  merchant_domain: string | null;
  order_number: string | null;
  merchant_legal_name: string | null;
  expected_carrier: string | null;
}

export interface ReviewResolverV3Result {
  scanned: number;
  candidates: number;
  created: number;
  healed: number;
  resolvedSources: number;
  stayedReview: number;
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

function nonNegativeNumberOrNull(value: unknown): number | null {
  const valueNumber = numberOrNull(value);
  return valueNumber !== null && valueNumber >= 0 ? valueNumber : null;
}

function currencyOrNull(value: unknown): string | null {
  const currency = stringOrNull(value)?.toUpperCase() ?? null;
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function safeHttpUrl(value: unknown): string | null {
  const text = stringOrNull(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function eventTypeOrNull(value: unknown): ReviewPurchaseEventType | null {
  return typeof value === 'string' && EVENT_TYPES.has(value as ReviewPurchaseEventType)
    ? value as ReviewPurchaseEventType
    : null;
}

function effectiveValidationStatus(source: SourceRow): string | null {
  return stringOrNull(source.validated_result?.validation_status) ?? source.validation_status;
}

function toEvidence(source: SourceRow): ReviewPurchaseEvidence | null {
  const result = source.validated_result;
  if (!result) return null;
  const confidence = numberOrNull(result.confidence);
  if (confidence === null) return null;

  return {
    sourceEmailId: source.id,
    userId: source.user_id,
    senderDomain: senderDomain(source.from_address),
    subject: source.subject,
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

function normalizedPurchaseKey(domain: string | null, orderNumber: string | null): string {
  return `${(domain ?? '').trim().toLowerCase().replace(/^www\./, '')}::${(orderNumber ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
}

function orderPayload(result: Record<string, unknown>) {
  return {
    order_number: stringOrNull(result.order_number),
    merchant_legal_name: stringOrNull(result.merchant_legal_name),
    subtotal: nonNegativeNumberOrNull(result.subtotal),
    shipping_amount: nonNegativeNumberOrNull(result.shipping_amount),
    discount_amount: nonNegativeNumberOrNull(result.discount_amount),
    total: nonNegativeNumberOrNull(result.total),
    currency: currencyOrNull(result.currency),
    payment_status: stringOrNull(result.payment_status),
    payment_method: stringOrNull(result.payment_method),
    shipping_method: stringOrNull(result.shipping_method),
    carrier: stringOrNull(result.carrier),
  };
}

function sanitizedProducts(result: Record<string, unknown>) {
  if (!Array.isArray(result.products)) return [];
  return result.products
    .slice(0, 50)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const row = raw as Record<string, unknown>;
      const name = stringOrNull(row.name);
      const confidence = numberOrNull(row.confidence);
      if (!name || name.length > 500 || confidence === null || confidence < 0.7) return null;
      const quantity = numberOrNull(row.quantity);
      return {
        name,
        brand: stringOrNull(row.brand),
        model: stringOrNull(row.model),
        variant: stringOrNull(row.variant),
        sku: stringOrNull(row.sku),
        gtin: stringOrNull(row.gtin),
        category: stringOrNull(row.category),
        quantity: quantity !== null && quantity > 0 && quantity <= 1000 ? quantity : null,
        unit_price: nonNegativeNumberOrNull(row.unit_price),
        total_price: nonNegativeNumberOrNull(row.total_price),
        currency: currencyOrNull(row.currency),
        product_url: safeHttpUrl(row.product_url),
        image_url: safeHttpUrl(row.image_url),
        confidence,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

async function resolveUser(
  userId: string,
  currentReviewIds: Set<string>,
  mode: 'observe' | 'write',
): Promise<Omit<ReviewResolverV3Result, 'scanned' | 'failed' | 'aiCalls'>> {
  const db = getSupabaseAdmin() as any;
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const result = { candidates: 0, created: 0, healed: 0, resolvedSources: 0, stayedReview: 0 };

  const { data: sourceData, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,from_address,subject,received_at,validation_status,validated_result,processing_status')
    .eq('user_id', userId)
    .in('processing_status', ['review', 'unlinked', 'processed'])
    .not('validated_result', 'is', null)
    .gte('received_at', cutoff)
    .order('received_at', { ascending: true });
  if (sourceError) throw new Error(`Review Resolver V3 evidence read failed: ${sourceError.message}`);

  const sourceRows = (sourceData ?? []) as SourceRow[];
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const evidence = sourceRows
    .map(toEvidence)
    .filter((row: ReviewPurchaseEvidence | null): row is ReviewPurchaseEvidence => Boolean(row));

  const candidates = resolveReviewPurchaseCandidates(evidence)
    .filter((candidate) => currentReviewIds.has(candidate.anchorSourceEmailId));
  result.candidates = candidates.length;

  const { data: purchaseData, error: purchaseError } = await db
    .from('purchases')
    .select('id,merchant_domain,order_number,merchant_legal_name,expected_carrier')
    .eq('user_id', userId);
  if (purchaseError) throw new Error(`Review Resolver V3 purchase read failed: ${purchaseError.message}`);

  const purchases = (purchaseData ?? []) as PurchaseRow[];
  const purchaseByIdentity = new Map(
    purchases.map((row) => [normalizedPurchaseKey(row.merchant_domain, row.order_number), row]),
  );

  for (const candidate of candidates) {
    if (candidate.decision !== 'create') {
      result.stayedReview += 1;
      continue;
    }

    if (mode === 'observe') {
      const existing = purchaseByIdentity.get(normalizedPurchaseKey(candidate.senderDomain, candidate.orderNumber));
      if (existing) result.healed += 1;
      else result.created += 1;
      result.resolvedSources += candidate.sourceLinks.length;
      continue;
    }

    const identityKey = normalizedPurchaseKey(candidate.senderDomain, candidate.orderNumber);
    const existedBefore = purchaseByIdentity.has(identityKey);

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
    if (createError || typeof purchaseId !== 'string') {
      throw new Error(`Review Resolver V3 purchase create failed: ${createError?.message ?? 'missing id'}`);
    }

    const { data: purchaseIdentity, error: identityReadError } = await db
      .from('purchases')
      .select('id,merchant_domain,order_number,merchant_legal_name,expected_carrier')
      .eq('id', purchaseId)
      .eq('user_id', candidate.userId)
      .single();
    if (identityReadError || !purchaseIdentity) {
      throw new Error(`Review Resolver V3 created purchase read failed: ${identityReadError?.message ?? 'missing purchase'}`);
    }

    const identityPatch: Record<string, unknown> = {};
    if (!purchaseIdentity.merchant_legal_name && candidate.merchantLegalName) {
      identityPatch.merchant_legal_name = candidate.merchantLegalName;
    }
    if (!purchaseIdentity.expected_carrier && candidate.expectedCarrier) {
      identityPatch.expected_carrier = candidate.expectedCarrier;
    }
    if (Object.keys(identityPatch).length > 0) {
      const { error: identityUpdateError } = await db
        .from('purchases')
        .update(identityPatch)
        .eq('id', purchaseId)
        .eq('user_id', candidate.userId);
      if (identityUpdateError) {
        throw new Error(`Review Resolver V3 identity enrichment failed: ${identityUpdateError.message}`);
      }
    }

    const anchor = sourceById.get(candidate.anchorSourceEmailId);
    const anchorResult = anchor?.validated_result ?? null;
    const anchorValidation = anchor ? effectiveValidationStatus(anchor) : null;
    if (
      anchorResult &&
      anchorValidation &&
      TRUSTED_VALIDATION.has(anchorValidation) &&
      anchorResult.event_type === 'order_created'
    ) {
      const { error: enrichError } = await db.rpc('controlled_enrich_purchase_from_order_source', {
        p_user_id: candidate.userId,
        p_purchase_id: purchaseId,
        p_source_email_id: candidate.anchorSourceEmailId,
        p_order: orderPayload(anchorResult),
        p_products: sanitizedProducts(anchorResult),
      });
      if (enrichError) {
        throw new Error(`Review Resolver V3 order enrichment failed: ${enrichError.message}`);
      }
    }

    const linkedSourceIds = candidate.sourceLinks.map((row) => row.sourceEmailId);
    if (linkedSourceIds.length > 0) {
      const { error: statusError } = await db
        .from('source_emails')
        .update({ processing_status: 'processed' })
        .in('id', linkedSourceIds);
      if (statusError) throw new Error(`Review Resolver V3 source status failed: ${statusError.message}`);
    }

    const savedPurchase: PurchaseRow = {
      id: purchaseId,
      merchant_domain: candidate.senderDomain,
      order_number: candidate.orderNumber,
      merchant_legal_name: candidate.merchantLegalName,
      expected_carrier: candidate.expectedCarrier,
    };
    purchaseByIdentity.set(identityKey, savedPurchase);

    if (existedBefore) result.healed += 1;
    else result.created += 1;
    result.resolvedSources += linkedSourceIds.length;
  }

  return result;
}

export async function drainReviewResolverV3(
  mode: 'observe' | 'write',
  limit = 200,
): Promise<ReviewResolverV3Result> {
  const db = getSupabaseAdmin() as any;
  const { data, error } = await db
    .from('source_emails')
    .select('id,user_id')
    .eq('processing_status', 'review')
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`Review Resolver V3 review read failed: ${error.message}`);

  const reviewRows = (data ?? []) as Array<{ id: string; user_id: string }>;
  const result: ReviewResolverV3Result = {
    scanned: reviewRows.length,
    candidates: 0,
    created: 0,
    healed: 0,
    resolvedSources: 0,
    stayedReview: 0,
    failed: 0,
    aiCalls: 0,
  };

  const byUser = new Map<string, Set<string>>();
  for (const row of reviewRows) {
    const ids = byUser.get(row.user_id) ?? new Set<string>();
    ids.add(row.id);
    byUser.set(row.user_id, ids);
  }

  for (const [userId, reviewIds] of byUser) {
    try {
      const userResult = await resolveUser(userId, reviewIds, mode);
      result.candidates += userResult.candidates;
      result.created += userResult.created;
      result.healed += userResult.healed;
      result.resolvedSources += userResult.resolvedSources;
      result.stayedReview += userResult.stayedReview;
    } catch {
      result.failed += reviewIds.size;
    }
  }

  return result;
}
