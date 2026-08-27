import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { isCarrierSenderDomain, isPublicMailboxSenderDomain } from '../email/sender-role.js';
import { normalizeCarrierSlug } from '../resolution/shipment-resolution.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import {
  UnresolvedEventPool,
  type TargetedRecoveryPlan,
  type UnresolvedEventPoolSnapshot,
} from './unresolved-event-pool.js';
import type { CanonicalEvent, CanonicalEventType, EvidenceProvenance, SourceRole } from './types.js';

export interface PersistedUnlinkedSourceEmail {
  id: string;
  user_id: string;
  provider_message_id: string;
  from_address: string | null;
  received_at: string | null;
  processing_status: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
}

export interface DurableUnresolvedLoadResult {
  snapshot: UnresolvedEventPoolSnapshot;
  sourceRowsRead: number;
  eventsAccepted: number;
  eventsRejected: number;
}

const DEFAULT_MAX_ROWS = 200;

/**
 * Reuses source_emails as the durable orphan store. The database already keeps
 * trusted unlinked extraction results, so no second copy of raw email content is
 * needed. This adapter is read-only: it does not mark an email processed or link
 * a Purchase. Existing PurchaseIdentityGraph rules remain the only authority.
 */
export async function loadDurableUnresolvedSnapshotForUser(
  userId: string,
  maxRows = DEFAULT_MAX_ROWS,
): Promise<DurableUnresolvedLoadResult> {
  if (!userId.trim()) throw new Error('Durable unresolved load requires a user id.');
  const limit = Math.max(1, Math.min(Math.trunc(maxRows), 1_000));
  const db = getSupabaseAdmin() as any;
  const { data, error } = await db
    .from('source_emails')
    .select('id,user_id,provider_message_id,from_address,received_at,processing_status,validation_status,validated_result')
    .eq('user_id', userId)
    .eq('processing_status', 'unlinked')
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Durable unresolved source read failed: ${error.message}`);
  }

  return buildDurableUnresolvedSnapshotFromSourceRows(
    Array.isArray(data) ? data as PersistedUnlinkedSourceEmail[] : [],
    userId,
  );
}

export function buildDurableUnresolvedSnapshotFromSourceRows(
  rows: PersistedUnlinkedSourceEmail[],
  userId: string,
): DurableUnresolvedLoadResult {
  const pool = new UnresolvedEventPool();
  let accepted = 0;
  let rejected = 0;

  for (const row of rows) {
    if (row.user_id !== userId || row.processing_status !== 'unlinked') {
      rejected += 1;
      continue;
    }
    const event = persistedSourceEmailToCanonicalEvent(row);
    if (!event || !pool.remember(event, { kind: 'UNLINKED', reasons: [] })) {
      rejected += 1;
      continue;
    }
    accepted += 1;
  }

  return {
    snapshot: pool.snapshot(),
    sourceRowsRead: rows.length,
    eventsAccepted: accepted,
    eventsRejected: rejected,
  };
}

export function planRecoveryAgainstDurableSnapshot(
  triggerEvent: CanonicalEvent,
  snapshot: UnresolvedEventPoolSnapshot,
): TargetedRecoveryPlan {
  return new UnresolvedEventPool(snapshot).planRecovery(triggerEvent);
}

export function persistedSourceEmailToCanonicalEvent(
  row: PersistedUnlinkedSourceEmail,
): CanonicalEvent | null {
  if (row.processing_status !== 'unlinked') return null;
  const validated = row.validated_result;
  if (!validated || !trustedValidation(row.validation_status)) return null;

  const eventType = canonicalEventType(validated);
  if (!eventType) return null;

  const senderDomain = domainOfAddress(row.from_address);
  const sourceRole = sourceRoleFor(senderDomain, stringOrNull(validated.merchant));
  const merchantNamespace = sourceRole === 'merchant' && senderDomain
    ? `sender-domain:${senderDomain}`
    : null;
  const confidence = numberOrNull(validated.confidence);
  const orderRaw = stringOrNull(validated.order_number);
  const trackingRaw = stringOrNull(validated.tracking_number);
  const invoiceRaw = stringOrNull(validated.invoice_number);
  const carrierRaw = stringOrNull(validated.carrier);
  const merchantRaw = stringOrNull(validated.merchant);
  const parserVersion = stringOrNull(validated.parser_version);

  return {
    eventId: `source-email:${row.id}`,
    userId: row.user_id,
    eventType,
    sourceProvider: 'persisted-source-email',
    sourceMessageId: row.provider_message_id,
    senderDomain,
    receivedAt: row.received_at ?? '1970-01-01T00:00:00.000Z',
    occurredAt: null,
    merchantRaw,
    merchantId: null,
    merchantNamespace,
    purchaseCreationAuthority: 'none',
    purchaseCreationReasons: ['persisted_unlinked_lifecycle'],
    orderIdRaw: orderRaw,
    orderIdNormalized: normalizeStableIdentifier(orderRaw),
    trackingIdRaw: trackingRaw,
    trackingIdNormalized: normalizeStableIdentifier(trackingRaw),
    invoiceIdRaw: invoiceRaw,
    invoiceIdNormalized: normalizeStableIdentifier(invoiceRaw),
    paymentReference: stringOrNull(validated.payment_reference),
    amount: numberOrNull(validated.total) ?? numberOrNull(validated.paid_amount) ?? numberOrNull(validated.cod_amount),
    currency: stringOrNull(validated.currency) ?? stringOrNull(validated.paid_currency) ?? stringOrNull(validated.cod_currency),
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: provenanceForPersistedEvent({
      eventType,
      orderRaw,
      trackingRaw,
      invoiceRaw,
      merchantRaw,
      carrierRaw,
      confidence,
      parserVersion,
    }),
    sourceRole,
    carrierId: normalizeCarrierSlug(carrierRaw),
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
  };
}

function canonicalEventType(validated: Record<string, unknown>): CanonicalEventType | null {
  const eventType = stringOrNull(validated.event_type);
  const phase = stringOrNull(validated.shipment_phase)?.toLowerCase() ?? null;

  if (eventType === 'order_created') return 'order_created';
  if (eventType === 'order_updated') return 'order_updated';
  if (eventType === 'payment_completed') return 'payment_completed';
  if (eventType === 'invoice_or_receipt' || eventType === 'invoice_created') return 'invoice_created';
  if (eventType === 'return' || eventType === 'return_created') return 'return_created';
  if (eventType === 'refund_completed') return 'refund_completed';
  if (eventType === 'refund' || eventType === 'refund_created') return 'refund_created';
  if (eventType === 'cancelled' || eventType === 'cancellation') return 'cancelled';

  if (eventType === 'delivery' || eventType === 'delivered') {
    if (phase === 'delivered' || eventType === 'delivered') return 'delivered';
    if (phase === 'out_for_delivery') return 'out_for_delivery';
    return 'shipment_created';
  }

  if (eventType === 'shipment' || eventType === 'shipment_created') {
    if (phase === 'out_for_delivery') return 'out_for_delivery';
    if (phase === 'delivered') return 'delivered';
    return 'shipment_created';
  }

  return null;
}

function provenanceForPersistedEvent(input: {
  eventType: CanonicalEventType;
  orderRaw: string | null;
  trackingRaw: string | null;
  invoiceRaw: string | null;
  merchantRaw: string | null;
  carrierRaw: string | null;
  confidence: number | null;
  parserVersion: string | null;
}): EvidenceProvenance[] {
  const fields: Array<[string, boolean]> = [
    ['event_type', true],
    ['order_number', Boolean(input.orderRaw)],
    ['tracking_number', Boolean(input.trackingRaw)],
    ['invoice_number', Boolean(input.invoiceRaw)],
    ['merchant', Boolean(input.merchantRaw)],
    ['carrier', Boolean(input.carrierRaw)],
  ];
  return fields
    .filter(([, present]) => present)
    .map(([field]) => ({
      field,
      source: 'provider_adapter' as const,
      parserVersion: input.parserVersion,
      extractorId: 'persisted-unlinked-source-email',
      extractorVersion: '1.0.0',
      confidence: input.confidence,
      qualifiers: ['durable_rehydration', input.eventType],
    }));
}

function sourceRoleFor(senderDomain: string | null, merchant: string | null): SourceRole {
  if (senderDomain && isCarrierSenderDomain(senderDomain)) return 'carrier';
  if (senderDomain && !isPublicMailboxSenderDomain(senderDomain) && merchant) return 'merchant';
  return 'unknown';
}

function trustedValidation(status: string | null): boolean {
  return status === 'validated' || status === 'guardrailed';
}

function domainOfAddress(value: string | null): string | null {
  if (!value) return null;
  const match = /@([^>\s,;]+)/.exec(value.toLowerCase());
  const domain = (match?.[1] ?? '').replace(/[)>]+$/, '').replace(/^www\./, '').replace(/\.$/, '').trim();
  return domain || null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
