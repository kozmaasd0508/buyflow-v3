import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { reconcileCarrierParcelSenderBridgesForGrant } from './carrier-parcel-sender-bridge.js';
import { repairDeterministicFoxpostSourcesForGrant } from './foxpost-lifecycle-repair.js';
import type { DeterministicLifecycleEvent } from './deterministic-lifecycle-parser.js';

const TRUSTED_VALIDATION = new Set(['validated', 'guardrailed']);
const TERMINAL_STATES = new Set(['cancelled', 'refunded', 'returned', 'delivered']);
const PHYSICAL_PROGRESS_STATES = new Set(['ready_for_pickup', 'in_transit', 'shipped']);
const ORDER_PROGRESS_EVENTS = new Set<DeterministicLifecycleEvent>([
  'order_processing',
  'order_packing',
  'ready_to_ship',
]);
const SUPPORTED_LIFECYCLE_EVENTS = new Set<DeterministicLifecycleEvent>([
  'payment_failed',
  'cancelled',
  'delayed',
  ...ORDER_PROGRESS_EVENTS,
]);

export interface LifecyclePurchaseStateInput {
  lifecycleEvent: DeterministicLifecycleEvent;
  sourceReceivedAt: string;
  currentState: string;
  currentPaymentStatus: string | null;
  currentCancelledAt: string | null;
  hasShipment: boolean;
  latestShipmentStatus: string | null;
  latestShipmentEventAt: string | null;
}

export interface LifecyclePurchasePatch {
  current_state?: string;
  payment_status?: string;
  cancelled_at?: string;
}

export interface ShipmentProgressSummary {
  status: 'in_transit' | 'ready_for_pickup' | 'delivered' | null;
  latestEventAt: string | null;
  allDelivered: boolean;
  completedAt: string | null;
}

function isAfter(left: string | null, right: string): boolean {
  if (!left) return false;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime > rightTime;
}

function laterTimestamp(current: string | null, candidate: unknown): string | null {
  if (typeof candidate !== 'string') return current;
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(candidateTime)) return current;
  if (!current) return candidate;
  const currentTime = Date.parse(current);
  return !Number.isFinite(currentTime) || candidateTime > currentTime ? candidate : current;
}

export function summarizeShipmentProgress(rows: Array<Record<string, unknown>>): ShipmentProgressSummary {
  if (rows.length === 0) {
    return { status: null, latestEventAt: null, allDelivered: false, completedAt: null };
  }

  let latestEventAt: string | null = null;
  let completedAt: string | null = null;
  let deliveredCount = 0;
  let inTransitCount = 0;
  let readyForPickupCount = 0;
  let knownStatusCount = 0;

  for (const row of rows) {
    latestEventAt = laterTimestamp(latestEventAt, row.last_event_at);
    latestEventAt = laterTimestamp(latestEventAt, row.delivered_at);
    latestEventAt = laterTimestamp(latestEventAt, row.shipped_at);

    const status = typeof row.status === 'string' ? row.status : null;
    if (status === 'delivered') {
      knownStatusCount += 1;
      deliveredCount += 1;
      completedAt = laterTimestamp(completedAt, row.delivered_at);
    } else if (status === 'ready_for_pickup') {
      knownStatusCount += 1;
      readyForPickupCount += 1;
    } else if (status === 'in_transit' || status === 'shipped') {
      knownStatusCount += 1;
      inTransitCount += 1;
    }
  }

  const allDelivered = knownStatusCount === rows.length && deliveredCount === rows.length;
  const status = allDelivered
    ? 'delivered'
    : inTransitCount > 0
      ? 'in_transit'
      : readyForPickupCount > 0
        ? 'ready_for_pickup'
        : null;

  return {
    status,
    latestEventAt,
    allDelivered,
    completedAt: allDelivered ? completedAt : null,
  };
}

function recoverFromNewerShipment(input: LifecyclePurchaseStateInput): LifecyclePurchasePatch | null {
  if (!input.latestShipmentStatus || !isAfter(input.latestShipmentEventAt, input.sourceReceivedAt)) return null;
  const recoveredState = input.latestShipmentStatus === 'shipped' ? 'in_transit' : input.latestShipmentStatus;
  if (!PHYSICAL_PROGRESS_STATES.has(recoveredState) && recoveredState !== 'delivered') return null;
  return input.currentState === recoveredState ? {} : { current_state: recoveredState };
}

export function decideLifecyclePurchasePatch(input: LifecyclePurchaseStateInput): LifecyclePurchasePatch {
  const patch: LifecyclePurchasePatch = {};

  if (input.lifecycleEvent === 'payment_failed') {
    if (input.currentPaymentStatus === 'paid') {
      if (input.currentState === 'payment_failed') patch.current_state = 'paid';
      return patch;
    }
    if (input.currentState === 'paid') return patch;
    if (input.currentPaymentStatus !== 'failed') patch.payment_status = 'failed';
    if (!TERMINAL_STATES.has(input.currentState) && !PHYSICAL_PROGRESS_STATES.has(input.currentState) && input.currentState !== 'payment_failed') {
      patch.current_state = 'payment_failed';
    }
    return patch;
  }

  if (input.lifecycleEvent === 'cancelled') {
    if (TERMINAL_STATES.has(input.currentState) || PHYSICAL_PROGRESS_STATES.has(input.currentState) || input.hasShipment) return patch;
    if (input.currentState !== 'cancelled') patch.current_state = 'cancelled';
    if (!input.currentCancelledAt) patch.cancelled_at = input.sourceReceivedAt;
    return patch;
  }

  if (ORDER_PROGRESS_EVENTS.has(input.lifecycleEvent)) {
    if (
      TERMINAL_STATES.has(input.currentState)
      || PHYSICAL_PROGRESS_STATES.has(input.currentState)
      || input.currentState === 'payment_failed'
      || input.currentPaymentStatus === 'failed'
    ) return patch;

    const recovered = recoverFromNewerShipment(input);
    if (recovered) return recovered;
    if (input.currentState !== 'processing') patch.current_state = 'processing';
    return patch;
  }

  if (TERMINAL_STATES.has(input.currentState) || PHYSICAL_PROGRESS_STATES.has(input.currentState) || input.currentState === 'payment_failed') return patch;
  const recovered = recoverFromNewerShipment(input);
  if (recovered) return recovered;
  if (input.currentState !== 'delayed') patch.current_state = 'delayed';
  return patch;
}

function normalizeDomain(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/^www\./, '');
  return normalized || null;
}

function fromDomain(fromAddress: string | null): string | null {
  if (!fromAddress) return null;
  const at = fromAddress.lastIndexOf('@');
  return at >= 0 ? normalizeDomain(fromAddress.slice(at + 1)) : null;
}

export async function reconcileDeterministicLifecycleStatesForGrant(grantId: string): Promise<{ scanned: number; applied: number }> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db.from('email_connections')
    .select('user_id').eq('provider', 'nylas').eq('provider_account_id', grantId).eq('status', 'active').maybeSingle();
  if (connectionError) throw new Error(`Lifecycle reconciliation grant lookup failed: ${connectionError.message}`);
  if (!connection?.user_id) return { scanned: 0, applied: 0 };

  const { data: sources, error: sourceError } = await db.from('source_emails')
    .select('id,user_id,from_address,received_at,classification,validated_result,validation_status')
    .eq('user_id', connection.user_id)
    .in('classification', [...SUPPORTED_LIFECYCLE_EVENTS])
    .order('received_at', { ascending: true }).limit(200);
  if (sourceError) throw new Error(`Lifecycle reconciliation source scan failed: ${sourceError.message}`);

  let applied = 0;
  for (const source of (sources ?? []) as Array<Record<string, any>>) {
    const result = source.validated_result;
    if (!result || typeof result !== 'object') continue;
    const validationStatus = String(result.validation_status ?? source.validation_status ?? '');
    const lifecycleEvent = result.lifecycle_event as DeterministicLifecycleEvent | undefined;
    const confidence = Number(result.confidence);
    if (
      !TRUSTED_VALIDATION.has(validationStatus)
      || !lifecycleEvent
      || !SUPPORTED_LIFECYCLE_EVENTS.has(lifecycleEvent)
      || result.event_type !== 'order_updated'
      || result.extraction_source !== 'deterministic'
      || result.parser_version !== 'deterministic-lifecycle-v1'
      || !Number.isFinite(confidence)
      || confidence < 0.95
    ) continue;

    const orderNumber = typeof result.order_number === 'string' ? result.order_number.trim() : '';
    const sourceDomain = fromDomain(typeof source.from_address === 'string' ? source.from_address : null);
    if (!orderNumber || !sourceDomain || typeof source.received_at !== 'string') continue;

    const { data: purchases, error: purchaseError } = await db.from('purchases')
      .select('id,user_id,merchant_domain,order_number,current_state,payment_status,cancelled_at')
      .eq('user_id', connection.user_id).eq('order_number', orderNumber);
    if (purchaseError) throw new Error(`Lifecycle reconciliation purchase lookup failed: ${purchaseError.message}`);
    const matches = ((purchases ?? []) as Array<Record<string, any>>)
      .filter((purchase) => normalizeDomain(purchase.merchant_domain ?? null) === sourceDomain);
    if (matches.length !== 1) continue;
    const purchase = matches[0]!;

    const { data: shipments, error: shipmentError } = await db.from('shipments')
      .select('status,shipped_at,delivered_at,last_event_at')
      .eq('user_id', connection.user_id).eq('purchase_id', purchase.id);
    if (shipmentError) throw new Error(`Lifecycle reconciliation shipment lookup failed: ${shipmentError.message}`);

    const shipmentProgress = summarizeShipmentProgress((shipments ?? []) as Array<Record<string, unknown>>);
    const patch = decideLifecyclePurchasePatch({
      lifecycleEvent,
      sourceReceivedAt: source.received_at,
      currentState: String(purchase.current_state ?? 'unknown'),
      currentPaymentStatus: typeof purchase.payment_status === 'string' ? purchase.payment_status : null,
      currentCancelledAt: typeof purchase.cancelled_at === 'string' ? purchase.cancelled_at : null,
      hasShipment: Array.isArray(shipments) && shipments.length > 0,
      latestShipmentStatus: shipmentProgress.status,
      latestShipmentEventAt: shipmentProgress.latestEventAt,
    });

    if (Object.keys(patch).length === 0) continue;
    const { error: updateError } = await db.from('purchases').update(patch)
      .eq('id', purchase.id).eq('user_id', connection.user_id);
    if (updateError) throw new Error(`Lifecycle reconciliation purchase update failed: ${updateError.message}`);
    applied += 1;
  }

  // Upgrade unresolved Foxpost evidence first: use the labelled CLFOX tracking ID,
  // preserve the actual parcel sender, and keep pickup-ready separate from delivered.
  await repairDeterministicFoxpostSourcesForGrant(grantId);

  // A carrier message may contain the first tracking number while the merchant's
  // shipment email only contains the order identity. Reconcile those two pieces
  // after the normal lifecycle pass. The bridge is conservative: it requires a
  // carrier-labelled parcel sender, a trusted merchant shipment anchor, a 7-day
  // window and exactly one matching Purchase.
  await reconcileCarrierParcelSenderBridgesForGrant(grantId);

  return { scanned: (sources ?? []).length, applied };
}
