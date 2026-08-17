import { getSupabaseAdmin } from '../db/supabase-admin.js';

export interface GenericLifecyclePurchaseIdentity {
  purchaseId: string;
  userId: string;
  merchantDomain: string | null;
  orderNumber: string | null;
}

export interface GenericLifecycleShipmentIdentity {
  purchaseId: string | null;
  trackingNumber: string | null;
}

export type GenericLifecycleLinkDecision =
  | 'linked_order_domain'
  | 'linked_tracking'
  | 'already_linked'
  | 'ambiguous'
  | 'conflict'
  | 'unmatched';

export interface GenericLifecycleLinkCandidate {
  decision: GenericLifecycleLinkDecision;
  purchaseId: string | null;
  reason: string;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function resolveGenericLifecycleLinkCandidate(input: {
  userId: string;
  senderDomain: string;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  purchases: GenericLifecyclePurchaseIdentity[];
  shipments: GenericLifecycleShipmentIdentity[];
}): GenericLifecycleLinkCandidate {
  const sourceDomain = normalize(input.senderDomain);
  const sourceOrder = normalize(input.orderNumber);
  const sourceTracking = normalize(input.trackingNumber);

  const orderMatches = sourceOrder && sourceDomain
    ? input.purchases.filter((purchase) =>
        purchase.userId === input.userId
        && normalize(purchase.merchantDomain) === sourceDomain
        && normalize(purchase.orderNumber) === sourceOrder,
      )
    : [];
  const orderPurchaseIds = unique(orderMatches.map((row) => row.purchaseId));

  const trackingPurchaseIds = sourceTracking
    ? unique(input.shipments
        .filter((shipment) => normalize(shipment.trackingNumber) === sourceTracking)
        .map((shipment) => shipment.purchaseId ?? ''))
    : [];

  if (orderPurchaseIds.length > 1 || trackingPurchaseIds.length > 1) {
    return { decision: 'ambiguous', purchaseId: null, reason: 'multiple_hard_anchor_matches' };
  }

  const orderPurchaseId = orderPurchaseIds[0] ?? null;
  const trackingPurchaseId = trackingPurchaseIds[0] ?? null;

  if (orderPurchaseId && trackingPurchaseId && orderPurchaseId !== trackingPurchaseId) {
    return { decision: 'conflict', purchaseId: null, reason: 'order_and_tracking_disagree' };
  }

  if (orderPurchaseId) {
    return {
      decision: 'linked_order_domain',
      purchaseId: orderPurchaseId,
      reason: 'exact_order_number_and_merchant_domain',
    };
  }

  if (trackingPurchaseId) {
    return {
      decision: 'linked_tracking',
      purchaseId: trackingPurchaseId,
      reason: 'exact_existing_tracking_number',
    };
  }

  return { decision: 'unmatched', purchaseId: null, reason: 'hard_anchor_required' };
}

export async function linkGenericLifecycleSource(input: {
  userId: string;
  sourceEmailId: string;
  senderDomain: string;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  confidence: number;
}): Promise<GenericLifecycleLinkCandidate> {
  const db = getSupabaseAdmin() as any;

  let purchases: GenericLifecyclePurchaseIdentity[] = [];
  if (input.orderNumber) {
    const { data, error } = await db.from('purchases')
      .select('id,user_id,merchant_domain,order_number')
      .eq('user_id', input.userId)
      .eq('merchant_domain', input.senderDomain)
      .limit(25);
    if (error) throw new Error(`Generic lifecycle purchase lookup failed: ${error.message}`);
    purchases = (data ?? []).map((row: Record<string, any>) => ({
      purchaseId: String(row.id),
      userId: String(row.user_id),
      merchantDomain: typeof row.merchant_domain === 'string' ? row.merchant_domain : null,
      orderNumber: typeof row.order_number === 'string' ? row.order_number : null,
    }));
  }

  let shipments: GenericLifecycleShipmentIdentity[] = [];
  if (input.trackingNumber) {
    const { data, error } = await db.from('shipments')
      .select('purchase_id,tracking_number')
      .eq('user_id', input.userId)
      .eq('tracking_number', input.trackingNumber)
      .limit(10);
    if (error) throw new Error(`Generic lifecycle tracking lookup failed: ${error.message}`);
    shipments = (data ?? []).map((row: Record<string, any>) => ({
      purchaseId: typeof row.purchase_id === 'string' ? row.purchase_id : null,
      trackingNumber: typeof row.tracking_number === 'string' ? row.tracking_number : null,
    }));
  }

  const candidate = resolveGenericLifecycleLinkCandidate({
    userId: input.userId,
    senderDomain: input.senderDomain,
    orderNumber: input.orderNumber,
    trackingNumber: input.trackingNumber,
    purchases,
    shipments,
  });
  if (!candidate.purchaseId) return candidate;

  const { data: existing, error: existingError } = await db.from('purchase_sources')
    .select('purchase_id,relation_type')
    .eq('source_email_id', input.sourceEmailId);
  if (existingError) throw new Error(`Generic lifecycle source-link lookup failed: ${existingError.message}`);

  const existingPurchaseIds = unique((existing ?? []).map((row: Record<string, any>) => String(row.purchase_id ?? '')));
  if (existingPurchaseIds.length > 0) {
    if (existingPurchaseIds.length === 1 && existingPurchaseIds[0] === candidate.purchaseId) {
      return { decision: 'already_linked', purchaseId: candidate.purchaseId, reason: 'source_already_linked_to_same_purchase' };
    }
    return { decision: 'conflict', purchaseId: null, reason: 'source_already_linked_elsewhere' };
  }

  const { error: insertError } = await db.from('purchase_sources').insert({
    purchase_id: candidate.purchaseId,
    source_email_id: input.sourceEmailId,
    relation_type: 'generic_lifecycle',
    confidence: input.confidence,
  });
  if (insertError) throw new Error(`Generic lifecycle source link failed: ${insertError.message}`);

  return candidate;
}
