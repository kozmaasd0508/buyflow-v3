import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';
import { normalizeCarrierSlug } from '../resolution/shipment-resolution.js';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 45;
const TRUSTED_VALIDATION = new Set(['validated', 'guardrailed']);
const MIN_VERIFIED_PURCHASE_CONFIDENCE = 0.95;

type BridgeShipmentStatus = 'in_transit' | 'ready_for_pickup';

interface VerifiedBrandCarrierIdentity {
  merchantDomain: string;
  parcelSender: string;
  carrierSlug: string;
}

// Keep this registry deliberately narrow. These aliases represent a verified
// brand/legal-entity relationship, not fuzzy merchant matching. Scitec's
// official legal pages identify BioTech USA Kft. as the operating entity.
const VERIFIED_BRAND_CARRIER_IDENTITIES: VerifiedBrandCarrierIdentity[] = [
  { merchantDomain: 'scitec.hu', parcelSender: 'biotechusa', carrierSlug: 'foxpost' },
];

export interface CarrierBridgePurchase {
  purchaseId: string;
  userId: string;
  merchantName: string | null;
  merchantDomain: string | null;
  orderNumber: string | null;
  totalAmount: number | null;
  currency: string | null;
  orderedAt: string | null;
  confidence: number | null;
}

export interface CarrierBridgeEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  receivedAt: string;
  eventType: 'shipment' | 'delivery';
  orderNumber: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  parcelSender: string | null;
  shipmentPhase: string | null;
  codAmount: number | null;
  codCurrency: string | null;
  confidence: number;
}

export interface CarrierBridgeDecision {
  trackingNumber: string;
  carrierSlug: string;
  shipmentStatus: BridgeShipmentStatus;
  purchaseId: string | null;
  decision: 'linkable' | 'review' | 'unmatched';
  sourceEmailIds: string[];
  merchantAnchorSourceId: string | null;
  primarySourceId: string | null;
  confidence: number;
  reasons: string[];
}

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeOrder(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeTracking(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeCurrency(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function normalizeMerchantLabel(value: string | null | undefined): string {
  const generic = new Set(['kft', 'zrt', 'bt', 'nyrt', 'ltd', 'limited', 'gmbh', 'inc', 'llc', 'plc', 'ag', 'hu', 'hungary', 'magyarorszag']);
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !generic.has(token))
    .join(' ');
}

function merchantAliases(purchase: CarrierBridgePurchase): string[] {
  const domain = normalizeDomain(purchase.merchantDomain);
  const root = domain ? domain.split('.').slice(0, -1).join(' ') : '';
  return [...new Set([
    normalizeMerchantLabel(purchase.merchantName),
    normalizeMerchantLabel(domain),
    normalizeMerchantLabel(root),
  ].filter(Boolean))];
}

function merchantLooksSame(parcelSender: string | null, purchase: CarrierBridgePurchase): boolean {
  const sender = normalizeMerchantLabel(parcelSender);
  if (!sender || sender.length < 4) return false;
  return merchantAliases(purchase).some((alias) =>
    alias === sender ||
    (alias.length >= 5 && sender.length >= 5 && (alias.includes(sender) || sender.includes(alias))),
  );
}

function verifiedBrandIdentityMatches(
  parcelSender: string | null,
  purchase: CarrierBridgePurchase,
  carrierSlug: string,
): boolean {
  const domain = normalizeDomain(purchase.merchantDomain);
  const sender = normalizeMerchantLabel(parcelSender);
  if (!domain || !sender) return false;
  return VERIFIED_BRAND_CARRIER_IDENTITIES.some((identity) =>
    domain === identity.merchantDomain
    && sender === identity.parcelSender
    && carrierSlug === identity.carrierSlug,
  );
}

function withinWindow(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= WINDOW_MS;
}

function exactCodMatch(purchase: CarrierBridgePurchase, row: CarrierBridgeEvidence): boolean {
  if (purchase.totalAmount === null || row.codAmount === null) return false;
  const purchaseCurrency = normalizeCurrency(purchase.currency);
  const codCurrency = normalizeCurrency(row.codCurrency);
  return Boolean(
    purchaseCurrency
    && purchaseCurrency === codCurrency
    && Math.abs(purchase.totalAmount - row.codAmount) < 0.001,
  );
}

function shipmentStatusForCarrierGroup(group: CarrierBridgeEvidence[]): BridgeShipmentStatus {
  return group.some((row) => row.shipmentPhase === 'ready_for_pickup')
    ? 'ready_for_pickup'
    : 'in_transit';
}

function earliestPhysicalCarrierSource(group: CarrierBridgeEvidence[]): CarrierBridgeEvidence | null {
  const physical = group
    .filter((row) => row.eventType === 'delivery' || Boolean(row.shipmentPhase && row.shipmentPhase !== 'shipment_created'))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  return physical[0] ?? null;
}

function uniqueSourceCount(group: CarrierBridgeEvidence[]): number {
  return new Set(group.map((row) => row.sourceEmailId)).size;
}

export function resolveCarrierParcelSenderBridges(
  purchases: CarrierBridgePurchase[],
  evidenceRows: CarrierBridgeEvidence[],
): CarrierBridgeDecision[] {
  const purchaseByMerchantOrder = new Map<string, CarrierBridgePurchase[]>();
  for (const purchase of purchases) {
    const domain = normalizeDomain(purchase.merchantDomain);
    const order = normalizeOrder(purchase.orderNumber);
    if (!purchase.userId || !domain || !order) continue;
    const key = `${purchase.userId}::${domain}::${order}`;
    const rows = purchaseByMerchantOrder.get(key) ?? [];
    rows.push(purchase);
    purchaseByMerchantOrder.set(key, rows);
  }

  const merchantAnchors = evidenceRows.flatMap((row) => {
    if (isCarrierSenderDomain(normalizeDomain(row.senderDomain)) || !row.orderNumber || row.eventType !== 'shipment') return [];
    const domain = normalizeDomain(row.senderDomain);
    const order = normalizeOrder(row.orderNumber);
    const matches = purchaseByMerchantOrder.get(`${row.userId}::${domain}::${order}`) ?? [];
    return matches.length === 1 ? [{ row, purchase: matches[0]! }] : [];
  });

  const groups = new Map<string, CarrierBridgeEvidence[]>();
  for (const row of evidenceRows) {
    const tracking = normalizeTracking(row.trackingNumber);
    if (!tracking || !isCarrierSenderDomain(normalizeDomain(row.senderDomain))) continue;
    const slug = normalizeCarrierSlug(row.carrier);
    if (!slug) continue;
    const key = `${row.userId}::${slug}::${tracking}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const decisions: CarrierBridgeDecision[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const trackingNumber = normalizeTracking(first.trackingNumber);
    const carrierSlug = normalizeCarrierSlug(first.carrier)!;
    const shipmentStatus = shipmentStatusForCarrierGroup(group);
    const confidence = group.reduce((max, row) => Math.max(max, row.confidence), 0);

    const candidateAnchors = merchantAnchors.filter(({ row, purchase }) => {
      if (row.userId !== first.userId) return false;
      if (!group.some((carrierRow) => withinWindow(carrierRow.receivedAt, row.receivedAt))) return false;
      if (!group.some((carrierRow) => merchantLooksSame(carrierRow.parcelSender, purchase))) return false;
      const anchorCarrier = normalizeCarrierSlug(row.carrier);
      return !anchorCarrier || anchorCarrier === carrierSlug;
    });

    const purchaseIds = [...new Set(candidateAnchors.map(({ purchase }) => purchase.purchaseId))];
    if (purchaseIds.length === 1) {
      const anchorsForPurchase = candidateAnchors.filter(({ purchase }) => purchase.purchaseId === purchaseIds[0]);
      anchorsForPurchase.sort((a, b) => b.row.confidence - a.row.confidence || a.row.receivedAt.localeCompare(b.row.receivedAt));
      const anchor = anchorsForPurchase[0]!;
      decisions.push({
        trackingNumber,
        carrierSlug,
        shipmentStatus,
        purchaseId: purchaseIds[0]!,
        decision: 'linkable',
        sourceEmailIds: [...new Set([anchor.row.sourceEmailId, ...group.map((row) => row.sourceEmailId)])],
        merchantAnchorSourceId: anchor.row.sourceEmailId,
        primarySourceId: anchor.row.sourceEmailId,
        confidence: Math.min(confidence, anchor.row.confidence),
        reasons: [
          'carrier_parcel_sender_matches_merchant',
          'merchant_order_shipment_anchor',
          'carrier_and_merchant_events_within_7_days',
          'single_purchase_candidate',
          ...(shipmentStatus === 'ready_for_pickup' ? ['explicit_ready_for_pickup_evidence'] : []),
        ],
      });
      continue;
    }

    if (purchaseIds.length > 1) {
      decisions.push({
        trackingNumber,
        carrierSlug,
        shipmentStatus,
        purchaseId: null,
        decision: 'review',
        sourceEmailIds: group.map((row) => row.sourceEmailId),
        merchantAnchorSourceId: null,
        primarySourceId: null,
        confidence,
        reasons: ['multiple_purchase_candidates'],
      });
      continue;
    }

    const physicalPrimary = earliestPhysicalCarrierSource(group);
    const verifiedCandidates = uniqueSourceCount(group) >= 2 && physicalPrimary
      ? purchases.filter((purchase) => {
          if (purchase.userId !== first.userId) return false;
          if (!purchase.orderNumber || !purchase.orderedAt) return false;
          if (purchase.confidence === null || purchase.confidence < MIN_VERIFIED_PURCHASE_CONFIDENCE) return false;
          if (!group.some((row) => verifiedBrandIdentityMatches(row.parcelSender, purchase, carrierSlug))) return false;
          if (!group.some((row) => exactCodMatch(purchase, row))) return false;
          return group.some((row) => withinWindow(row.receivedAt, purchase.orderedAt!));
        })
      : [];
    const verifiedPurchaseIds = [...new Set(verifiedCandidates.map((purchase) => purchase.purchaseId))];

    if (verifiedPurchaseIds.length === 1 && physicalPrimary) {
      const purchase = verifiedCandidates.find((row) => row.purchaseId === verifiedPurchaseIds[0])!;
      decisions.push({
        trackingNumber,
        carrierSlug,
        shipmentStatus,
        purchaseId: purchase.purchaseId,
        decision: 'linkable',
        sourceEmailIds: [...new Set(group.map((row) => row.sourceEmailId))],
        merchantAnchorSourceId: null,
        primarySourceId: physicalPrimary.sourceEmailId,
        confidence: Math.min(confidence, purchase.confidence ?? confidence),
        reasons: [
          'verified_brand_legal_entity_alias',
          'exact_cod_matches_purchase_total',
          'multi_event_carrier_chain',
          'purchase_and_carrier_events_within_7_days',
          'single_purchase_candidate',
          ...(shipmentStatus === 'ready_for_pickup' ? ['explicit_ready_for_pickup_evidence'] : []),
        ],
      });
    } else if (verifiedPurchaseIds.length > 1) {
      decisions.push({
        trackingNumber,
        carrierSlug,
        shipmentStatus,
        purchaseId: null,
        decision: 'review',
        sourceEmailIds: group.map((row) => row.sourceEmailId),
        merchantAnchorSourceId: null,
        primarySourceId: null,
        confidence,
        reasons: ['multiple_verified_brand_cod_purchase_candidates'],
      });
    } else {
      decisions.push({
        trackingNumber,
        carrierSlug,
        shipmentStatus,
        purchaseId: null,
        decision: 'unmatched',
        sourceEmailIds: group.map((row) => row.sourceEmailId),
        merchantAnchorSourceId: null,
        primarySourceId: null,
        confidence,
        reasons: ['no_matching_merchant_shipment_anchor'],
      });
    }
  }

  return decisions.sort((a, b) => a.trackingNumber.localeCompare(b.trackingNumber));
}

function fromDomain(fromAddress: string | null): string {
  if (!fromAddress) return '';
  const at = fromAddress.lastIndexOf('@');
  return at >= 0 ? normalizeDomain(fromAddress.slice(at + 1)) : '';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function canonicalCarrier(slug: string): string {
  const names: Record<string, string> = { 'express-one': 'Express One', foxpost: 'Foxpost', packeta: 'Packeta', dpd: 'DPD', gls: 'GLS' };
  return names[slug] ?? slug;
}

export async function reconcileCarrierParcelSenderBridgesForGrant(grantId: string): Promise<{ scanned: number; linkable: number; applied: number; review: number }> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db.from('email_connections')
    .select('user_id').eq('provider', 'nylas').eq('provider_account_id', grantId).eq('status', 'active').maybeSingle();
  if (connectionError) throw new Error(`Carrier bridge grant lookup failed: ${connectionError.message}`);
  if (!connection?.user_id) return { scanned: 0, linkable: 0, applied: 0, review: 0 };

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: sourceRows, error: sourceError } = await db.from('source_emails')
    .select('id,user_id,from_address,received_at,classification,processing_status,validation_status,validated_result')
    .eq('user_id', connection.user_id)
    .in('classification', ['shipment', 'delivery'])
    .gte('received_at', cutoff)
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true }).limit(500);
  if (sourceError) throw new Error(`Carrier bridge source scan failed: ${sourceError.message}`);

  const evidenceRows: CarrierBridgeEvidence[] = [];
  for (const source of (sourceRows ?? []) as Array<Record<string, any>>) {
    const result = source.validated_result;
    if (!result || typeof result !== 'object') continue;
    const validation = String(result.validation_status ?? source.validation_status ?? '');
    const confidence = numberOrNull(result.confidence);
    const eventType = result.event_type;
    if (!TRUSTED_VALIDATION.has(validation) || confidence === null || confidence < 0.7 || (eventType !== 'shipment' && eventType !== 'delivery')) continue;
    evidenceRows.push({
      sourceEmailId: String(source.id),
      userId: String(source.user_id),
      senderDomain: fromDomain(source.from_address ?? null),
      receivedAt: String(source.received_at),
      eventType,
      orderNumber: stringOrNull(result.order_number),
      trackingNumber: stringOrNull(result.tracking_number),
      carrier: stringOrNull(result.carrier),
      parcelSender: stringOrNull(result.parcel_sender),
      shipmentPhase: stringOrNull(result.shipment_phase),
      codAmount: numberOrNull(result.cod_amount),
      codCurrency: stringOrNull(result.cod_currency),
      confidence,
    });
  }

  const { data: purchaseRows, error: purchaseError } = await db.from('purchases')
    .select('id,user_id,merchant_name,merchant_domain,order_number,total_amount,currency,ordered_at,confidence')
    .eq('user_id', connection.user_id);
  if (purchaseError) throw new Error(`Carrier bridge purchase scan failed: ${purchaseError.message}`);
  const purchases: CarrierBridgePurchase[] = ((purchaseRows ?? []) as Array<Record<string, any>>).map((row) => ({
    purchaseId: String(row.id),
    userId: String(row.user_id),
    merchantName: stringOrNull(row.merchant_name),
    merchantDomain: stringOrNull(row.merchant_domain),
    orderNumber: stringOrNull(row.order_number),
    totalAmount: numberOrNull(row.total_amount),
    currency: stringOrNull(row.currency),
    orderedAt: stringOrNull(row.ordered_at),
    confidence: numberOrNull(row.confidence),
  }));

  const decisions = resolveCarrierParcelSenderBridges(purchases, evidenceRows);
  let applied = 0;
  let review = 0;
  for (const decision of decisions) {
    if (decision.decision === 'review') { review += 1; continue; }
    if (decision.decision !== 'linkable' || !decision.purchaseId || !decision.primarySourceId) continue;
    const sources = evidenceRows.filter((row) => decision.sourceEmailIds.includes(row.sourceEmailId));
    const merchantAnchor = decision.merchantAnchorSourceId
      ? sources.find((row) => row.sourceEmailId === decision.merchantAnchorSourceId) ?? null
      : null;
    const primarySource = sources.find((row) => row.sourceEmailId === decision.primarySourceId);
    if (!primarySource) continue;
    const carrierRows = sources.filter((row) => isCarrierSenderDomain(normalizeDomain(row.senderDomain)) && normalizeTracking(row.trackingNumber) === decision.trackingNumber);
    if (carrierRows.length === 0) continue;
    const physicalCarrierRows = carrierRows.filter((row) => row.eventType === 'delivery' || Boolean(row.shipmentPhase && row.shipmentPhase !== 'shipment_created'));
    if (!merchantAnchor && physicalCarrierRows.length === 0) continue;
    const firstCarrierAt = [...carrierRows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]!.receivedAt;
    const firstPhysicalCarrierAt = physicalCarrierRows.length > 0
      ? [...physicalCarrierRows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]!.receivedAt
      : firstCarrierAt;
    const lastEventAt = [...carrierRows].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]!.receivedAt;

    const { error: upsertError } = await db.rpc('controlled_upsert_shipment_with_sources', {
      p_user_id: connection.user_id,
      p_purchase_id: decision.purchaseId,
      p_carrier: canonicalCarrier(decision.carrierSlug),
      p_carrier_slug: decision.carrierSlug,
      p_tracking_number: decision.trackingNumber,
      p_status: decision.shipmentStatus,
      p_shipped_at: merchantAnchor?.receivedAt ?? firstPhysicalCarrierAt,
      p_delivered_at: null,
      p_last_event_at: lastEventAt,
      p_source_email_id: primarySource.sourceEmailId,
      p_confidence: decision.confidence,
      p_sources: sources.map((row) => ({ source_email_id: row.sourceEmailId, confidence: row.confidence })),
    });
    if (upsertError) throw new Error(`Carrier bridge shipment upsert failed: ${upsertError.message}`);

    const carrierSourceIds = carrierRows.map((row) => row.sourceEmailId);
    if (carrierSourceIds.length > 0) {
      const { error: statusError } = await db.from('source_emails').update({ processing_status: 'processed' }).in('id', carrierSourceIds);
      if (statusError) throw new Error(`Carrier bridge source status update failed: ${statusError.message}`);
    }
    applied += 1;
  }

  return { scanned: evidenceRows.length, linkable: decisions.filter((row) => row.decision === 'linkable').length, applied, review };
}
