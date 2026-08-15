import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';
import { normalizeCarrierSlug } from '../resolution/shipment-resolution.js';

const LOOKBACK_DAYS = 45;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CARRIER_CONFIDENCE = 0.9;
const RECONSTRUCTION_CONFIDENCE = 0.94;
const TRUSTED_VALIDATION = new Set(['validated', 'guardrailed']);
const PUBLIC_OR_SHARED_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'freemail.hu',
  'citromail.hu',
  'mailchimp.com',
  'sendgrid.net',
  'amazonses.com',
  'mandrillapp.com',
  'mailgun.org',
  'barion.com',
  'simplepay.hu',
]);

export type MerchantReconstructionKind = 'dispatch' | 'invoice';

export interface MerchantReconstructionEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  receivedAt: string;
  orderNumber: string;
  merchantName: string;
  kind: MerchantReconstructionKind;
}

export interface CarrierReconstructionEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  receivedAt: string;
  trackingNumber: string | null;
  carrier: string | null;
  parcelSender: string | null;
  shipmentPhase: string | null;
  codAmount: number | null;
  codCurrency: string | null;
  confidence: number;
}

export interface CorroboratedPurchaseReconstructionDecision {
  decision: 'reconstruct' | 'review' | 'unmatched';
  userId: string;
  merchantDomain: string;
  merchantName: string;
  orderNumber: string;
  totalAmount: number | null;
  currency: string | null;
  carrier: string | null;
  carrierSlug: string | null;
  trackingNumber: string | null;
  merchantSourceEmailIds: string[];
  carrierSourceEmailIds: string[];
  primaryCarrierSourceId: string | null;
  shippedAt: string | null;
  lastEventAt: string | null;
  confidence: number;
  reasons: string[];
}

interface RawMerchantSource {
  id: string;
  user_id: string;
  from_address: string | null;
  subject: string | null;
  received_at: string;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function fromDomain(fromAddress: string | null | undefined): string {
  const value = (fromAddress ?? '').trim();
  const at = value.lastIndexOf('@');
  return at >= 0 ? normalizeDomain(value.slice(at + 1)) : '';
}

function normalizeOrder(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeCurrency(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function compactMerchantLabel(value: string | null | undefined): string {
  const generic = new Set(['kft', 'zrt', 'bt', 'nyrt', 'ltd', 'limited', 'gmbh', 'inc', 'llc', 'plc', 'ag', 'hungary', 'magyarorszag']);
  return normalizeText(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !generic.has(token))
    .join('')
    .trim();
}

function domainMerchantTokens(domain: string): string[] {
  const generic = new Set(['www', 'mail', 'email', 'service', 'shop', 'store', 'com', 'hu', 'net', 'org', 'eu', 'co']);
  return normalizeDomain(domain)
    .split('.')
    .map((token) => compactMerchantLabel(token))
    .filter((token) => token.length >= 4 && !generic.has(token));
}

function merchantNameMatchesDomain(merchantName: string, domain: string): boolean {
  const label = compactMerchantLabel(merchantName);
  if (label.length < 4) return false;
  return domainMerchantTokens(domain).some((token) => label === token || label.includes(token) || token.includes(label));
}

function merchantLabelsCompatible(left: string, right: string): boolean {
  const a = compactMerchantLabel(left);
  const b = compactMerchantLabel(right);
  return Boolean(a && b && (a === b || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)))));
}

function parcelSenderMatchesMerchant(parcelSender: string | null, merchantName: string, merchantDomain: string): boolean {
  const sender = compactMerchantLabel(parcelSender);
  if (sender.length < 4) return false;
  const aliases = [compactMerchantLabel(merchantName), ...domainMerchantTokens(merchantDomain)].filter(Boolean);
  return aliases.some((alias) => alias === sender || (alias.length >= 5 && (sender.includes(alias) || alias.includes(sender))));
}

function isMerchantOwnedDomain(domain: string): boolean {
  return Boolean(domain && !isCarrierSenderDomain(domain) && !PUBLIC_OR_SHARED_DOMAINS.has(domain));
}

function withinWindow(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= WINDOW_MS;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canonicalCarrier(slug: string): string {
  const names: Record<string, string> = {
    'express-one': 'Express One',
    foxpost: 'Foxpost',
    packeta: 'Packeta',
    dpd: 'DPD',
    gls: 'GLS',
    dhl: 'DHL',
    ups: 'UPS',
  };
  return names[slug] ?? slug;
}

export function parseMerchantReconstructionEvidence(source: RawMerchantSource): MerchantReconstructionEvidence | null {
  const senderDomain = fromDomain(source.from_address);
  if (!isMerchantOwnedDomain(senderDomain) || !source.subject || !source.received_at) return null;

  const subject = normalizeText(source.subject);
  const dispatch = subject.match(/^(.{2,80}?)\s*:\s*#\s*([A-Z0-9][A-Z0-9._/-]{3,})\s+rendeles\s+elkuldve\b/i);
  if (dispatch) {
    const merchantName = dispatch[1]!.trim();
    const orderNumber = dispatch[2]!.trim();
    if (!merchantNameMatchesDomain(merchantName, senderDomain)) return null;
    return {
      sourceEmailId: source.id,
      userId: source.user_id,
      senderDomain,
      receivedAt: source.received_at,
      orderNumber,
      merchantName,
      kind: 'dispatch',
    };
  }

  const invoice = subject.match(/^szamla\s+(.{2,80}?)\s+\(([A-Z0-9][A-Z0-9._/-]{3,})\)\s+szamu\s+webrendeleshez\b/i);
  if (invoice) {
    const merchantName = invoice[1]!.trim();
    const orderNumber = invoice[2]!.trim();
    if (!merchantNameMatchesDomain(merchantName, senderDomain)) return null;
    return {
      sourceEmailId: source.id,
      userId: source.user_id,
      senderDomain,
      receivedAt: source.received_at,
      orderNumber,
      merchantName,
      kind: 'invoice',
    };
  }

  return null;
}

function carrierGroups(rows: CarrierReconstructionEvidence[]): CarrierReconstructionEvidence[][] {
  const groups = new Map<string, CarrierReconstructionEvidence[]>();
  for (const row of rows) {
    const tracking = normalizeOrder(row.trackingNumber);
    const carrierSlug = normalizeCarrierSlug(row.carrier);
    if (!tracking || !carrierSlug || !isCarrierSenderDomain(row.senderDomain)) continue;
    const key = `${row.userId}::${carrierSlug}::${tracking}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function consistentCod(group: CarrierReconstructionEvidence[]): { amount: number; currency: string } | null {
  const codRows = group.filter((row) => row.codAmount !== null && normalizeCurrency(row.codCurrency));
  if (codRows.length === 0) return null;
  const first = codRows[0]!;
  const amount = first.codAmount!;
  const currency = normalizeCurrency(first.codCurrency);
  if (!currency) return null;
  if (!codRows.every((row) => row.codAmount !== null && Math.abs(row.codAmount - amount) < 0.001 && normalizeCurrency(row.codCurrency) === currency)) {
    return null;
  }
  return { amount, currency };
}

function earliestPhysical(group: CarrierReconstructionEvidence[]): CarrierReconstructionEvidence | null {
  return [...group]
    .filter((row) => Boolean(row.shipmentPhase && row.shipmentPhase !== 'shipment_created'))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0] ?? null;
}

function latestReceivedAt(group: CarrierReconstructionEvidence[]): string | null {
  return [...group].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]?.receivedAt ?? null;
}

export function resolveCorroboratedPurchaseReconstructions(
  merchantRows: MerchantReconstructionEvidence[],
  carrierRows: CarrierReconstructionEvidence[],
): CorroboratedPurchaseReconstructionDecision[] {
  const merchantGroups = new Map<string, MerchantReconstructionEvidence[]>();
  for (const row of merchantRows) {
    const domain = normalizeDomain(row.senderDomain);
    const order = normalizeOrder(row.orderNumber);
    if (!row.userId || !domain || !order || !isMerchantOwnedDomain(domain)) continue;
    const key = `${row.userId}::${domain}::${order}`;
    const group = merchantGroups.get(key) ?? [];
    group.push(row);
    merchantGroups.set(key, group);
  }

  const decisions: CorroboratedPurchaseReconstructionDecision[] = [];
  const allCarrierGroups = carrierGroups(carrierRows);

  for (const group of merchantGroups.values()) {
    const dispatchRows = group.filter((row) => row.kind === 'dispatch');
    const invoiceRows = group.filter((row) => row.kind === 'invoice');
    if (dispatchRows.length === 0 || invoiceRows.length === 0) continue;

    const corroboratingPairs = dispatchRows.flatMap((dispatch) => invoiceRows
      .filter((invoice) => invoice.sourceEmailId !== dispatch.sourceEmailId
        && withinWindow(dispatch.receivedAt, invoice.receivedAt)
        && merchantLabelsCompatible(dispatch.merchantName, invoice.merchantName))
      .map((invoice) => ({ dispatch, invoice })));
    if (corroboratingPairs.length === 0) continue;

    const firstPair = corroboratingPairs[0]!;
    const userId = firstPair.dispatch.userId;
    const merchantDomain = normalizeDomain(firstPair.dispatch.senderDomain);
    const merchantName = firstPair.dispatch.merchantName;
    const orderNumber = firstPair.dispatch.orderNumber;
    const merchantSourceEmailIds = [...new Set(corroboratingPairs.flatMap(({ dispatch, invoice }) => [dispatch.sourceEmailId, invoice.sourceEmailId]))];
    const merchantTimes = corroboratingPairs.flatMap(({ dispatch, invoice }) => [dispatch.receivedAt, invoice.receivedAt]);

    const eligibleCarrierGroups = allCarrierGroups.flatMap((carrierGroup) => {
      const first = carrierGroup[0];
      if (!first || first.userId !== userId) return [];
      const uniqueSources = new Set(carrierGroup.map((row) => row.sourceEmailId)).size;
      const cod = consistentCod(carrierGroup);
      const physical = earliestPhysical(carrierGroup);
      const carrierSlug = normalizeCarrierSlug(first.carrier);
      const trackingNumber = normalizeOrder(first.trackingNumber);
      if (uniqueSources < 2 || !cod || !physical || !carrierSlug || !trackingNumber) return [];
      if (!carrierGroup.every((row) => row.confidence >= MIN_CARRIER_CONFIDENCE)) return [];
      if (!carrierGroup.some((row) => parcelSenderMatchesMerchant(row.parcelSender, merchantName, merchantDomain))) return [];
      if (!carrierGroup.some((row) => merchantTimes.some((merchantAt) => withinWindow(row.receivedAt, merchantAt)))) return [];
      return [{ carrierGroup, cod, physical, carrierSlug, trackingNumber }];
    });

    if (eligibleCarrierGroups.length === 1) {
      const match = eligibleCarrierGroups[0]!;
      decisions.push({
        decision: 'reconstruct',
        userId,
        merchantDomain,
        merchantName,
        orderNumber,
        totalAmount: match.cod.amount,
        currency: match.cod.currency,
        carrier: canonicalCarrier(match.carrierSlug),
        carrierSlug: match.carrierSlug,
        trackingNumber: match.trackingNumber,
        merchantSourceEmailIds,
        carrierSourceEmailIds: [...new Set(match.carrierGroup.map((row) => row.sourceEmailId))],
        primaryCarrierSourceId: match.physical.sourceEmailId,
        shippedAt: match.physical.receivedAt,
        lastEventAt: latestReceivedAt(match.carrierGroup),
        confidence: RECONSTRUCTION_CONFIDENCE,
        reasons: [
          'same_merchant_domain_two_transactional_sources',
          'same_explicit_order_identity_dispatch_and_invoice',
          'merchant_name_matches_sender_domain',
          'single_cod_carrier_group',
          'multi_event_carrier_chain',
          'parcel_sender_matches_merchant_identity',
          'physical_carrier_progress_present',
          'merchant_and_carrier_evidence_within_7_days',
        ],
      });
    } else {
      decisions.push({
        decision: eligibleCarrierGroups.length > 1 ? 'review' : 'unmatched',
        userId,
        merchantDomain,
        merchantName,
        orderNumber,
        totalAmount: null,
        currency: null,
        carrier: null,
        carrierSlug: null,
        trackingNumber: null,
        merchantSourceEmailIds,
        carrierSourceEmailIds: eligibleCarrierGroups.flatMap((row) => row.carrierGroup.map((source) => source.sourceEmailId)),
        primaryCarrierSourceId: null,
        shippedAt: null,
        lastEventAt: null,
        confidence: RECONSTRUCTION_CONFIDENCE,
        reasons: [eligibleCarrierGroups.length > 1 ? 'multiple_cod_carrier_groups' : 'no_unique_cod_carrier_group'],
      });
    }
  }

  return decisions.sort((a, b) => `${a.merchantDomain}:${a.orderNumber}`.localeCompare(`${b.merchantDomain}:${b.orderNumber}`));
}

function existingPurchaseCompatible(purchase: Record<string, any>, decision: CorroboratedPurchaseReconstructionDecision): boolean {
  if (decision.totalAmount === null || !decision.currency || !decision.carrierSlug) return false;
  if (purchase.total_amount !== null && purchase.total_amount !== undefined && Math.abs(Number(purchase.total_amount) - decision.totalAmount) >= 0.001) return false;
  if (purchase.currency && normalizeCurrency(purchase.currency) !== decision.currency) return false;
  if (purchase.payment_method && !/utanvet|utánvét|cash.?on.?delivery|cod/i.test(String(purchase.payment_method))) return false;
  if (purchase.expected_carrier) {
    const existingCarrier = normalizeCarrierSlug(String(purchase.expected_carrier));
    if (existingCarrier && existingCarrier !== decision.carrierSlug) return false;
  }
  return true;
}

export async function reconcileCorroboratedPurchaseReconstructionsForGrant(
  grantId: string,
): Promise<{ scanned: number; candidates: number; reconstructed: number; shipments: number; review: number }> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db.from('email_connections')
    .select('user_id').eq('provider', 'nylas').eq('provider_account_id', grantId).eq('status', 'active').maybeSingle();
  if (connectionError) throw new Error(`Corroborated reconstruction grant lookup failed: ${connectionError.message}`);
  if (!connection?.user_id) return { scanned: 0, candidates: 0, reconstructed: 0, shipments: 0, review: 0 };

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: rawMerchantRows, error: merchantError } = await db.from('source_emails')
    .select('id,user_id,from_address,subject,received_at,processing_status')
    .eq('user_id', connection.user_id)
    .in('processing_status', ['review', 'unlinked'])
    .gte('received_at', cutoff)
    .order('received_at', { ascending: true })
    .limit(500);
  if (merchantError) throw new Error(`Corroborated reconstruction merchant scan failed: ${merchantError.message}`);

  const merchantRows = ((rawMerchantRows ?? []) as RawMerchantSource[])
    .map(parseMerchantReconstructionEvidence)
    .filter((row): row is MerchantReconstructionEvidence => row !== null);

  const { data: rawCarrierRows, error: carrierError } = await db.from('source_emails')
    .select('id,user_id,from_address,received_at,classification,validation_status,validated_result')
    .eq('user_id', connection.user_id)
    .in('processing_status', ['review', 'unlinked'])
    .in('classification', ['shipment', 'delivery'])
    .gte('received_at', cutoff)
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true })
    .limit(500);
  if (carrierError) throw new Error(`Corroborated reconstruction carrier scan failed: ${carrierError.message}`);

  const carrierRows: CarrierReconstructionEvidence[] = [];
  for (const source of (rawCarrierRows ?? []) as Array<Record<string, any>>) {
    const result = source.validated_result;
    if (!result || typeof result !== 'object') continue;
    const validation = String(result.validation_status ?? source.validation_status ?? '');
    const confidence = numberOrNull(result.confidence);
    const senderDomain = fromDomain(source.from_address);
    if (!TRUSTED_VALIDATION.has(validation) || confidence === null || confidence < MIN_CARRIER_CONFIDENCE || !isCarrierSenderDomain(senderDomain)) continue;
    if (result.extraction_source !== 'deterministic' || (result.event_type !== 'shipment' && result.event_type !== 'delivery')) continue;
    carrierRows.push({
      sourceEmailId: String(source.id),
      userId: String(source.user_id),
      senderDomain,
      receivedAt: String(source.received_at),
      trackingNumber: stringOrNull(result.tracking_number),
      carrier: stringOrNull(result.carrier),
      parcelSender: stringOrNull(result.parcel_sender),
      shipmentPhase: stringOrNull(result.shipment_phase),
      codAmount: numberOrNull(result.cod_amount),
      codCurrency: stringOrNull(result.cod_currency),
      confidence,
    });
  }

  const decisions = resolveCorroboratedPurchaseReconstructions(merchantRows, carrierRows);
  let reconstructed = 0;
  let shipments = 0;
  let review = 0;

  for (const decision of decisions) {
    if (decision.decision === 'review') {
      review += 1;
      continue;
    }
    if (
      decision.decision !== 'reconstruct'
      || decision.totalAmount === null
      || !decision.currency
      || !decision.carrier
      || !decision.carrierSlug
      || !decision.trackingNumber
      || !decision.primaryCarrierSourceId
      || !decision.shippedAt
      || !decision.lastEventAt
    ) continue;

    const { data: existingRows, error: existingError } = await db.from('purchases')
      .select('id,total_amount,currency,payment_method,expected_carrier')
      .eq('user_id', decision.userId)
      .eq('merchant_domain', decision.merchantDomain)
      .eq('order_number', decision.orderNumber);
    if (existingError) throw new Error(`Corroborated reconstruction purchase lookup failed: ${existingError.message}`);
    if ((existingRows ?? []).length > 1) {
      review += 1;
      continue;
    }
    if ((existingRows ?? []).length === 1 && !existingPurchaseCompatible(existingRows[0], decision)) {
      review += 1;
      continue;
    }

    let purchaseId = (existingRows ?? [])[0]?.id as string | undefined;
    if (!purchaseId) {
      const merchantSources = decision.merchantSourceEmailIds.map((sourceEmailId) => ({
        source_email_id: sourceEmailId,
        relation_type: 'corroborated_order',
        confidence: decision.confidence,
      }));
      const { data: createdId, error: createError } = await db.rpc('controlled_create_purchase_with_sources', {
        p_user_id: decision.userId,
        p_merchant_name: decision.merchantName,
        p_merchant_domain: decision.merchantDomain,
        p_order_number: decision.orderNumber,
        p_ordered_at: null,
        p_confidence: decision.confidence,
        p_sources: merchantSources,
      });
      if (createError || typeof createdId !== 'string' || !createdId) {
        throw new Error(`Corroborated reconstruction purchase create failed: ${createError?.message ?? 'missing purchase id'}`);
      }
      purchaseId = createdId;
      reconstructed += 1;
    }

    const { error: purchaseUpdateError } = await db.from('purchases').update({
      total_amount: decision.totalAmount,
      currency: decision.currency,
      payment_method: 'cash_on_delivery',
      expected_carrier: decision.carrier,
    }).eq('id', purchaseId).eq('user_id', decision.userId);
    if (purchaseUpdateError) throw new Error(`Corroborated reconstruction purchase enrichment failed: ${purchaseUpdateError.message}`);

    const shipmentSources = decision.carrierSourceEmailIds.map((sourceEmailId) => ({
      source_email_id: sourceEmailId,
      confidence: decision.confidence,
    }));
    const { data: shipmentId, error: shipmentError } = await db.rpc('controlled_upsert_shipment_with_sources', {
      p_user_id: decision.userId,
      p_purchase_id: purchaseId,
      p_carrier: decision.carrier,
      p_carrier_slug: decision.carrierSlug,
      p_tracking_number: decision.trackingNumber,
      p_status: 'in_transit',
      p_shipped_at: decision.shippedAt,
      p_delivered_at: null,
      p_last_event_at: decision.lastEventAt,
      p_source_email_id: decision.primaryCarrierSourceId,
      p_confidence: decision.confidence,
      p_sources: shipmentSources,
    });
    if (shipmentError || typeof shipmentId !== 'string' || !shipmentId) {
      throw new Error(`Corroborated reconstruction shipment upsert failed: ${shipmentError?.message ?? 'missing shipment id'}`);
    }
    shipments += 1;

    const linkedSourceIds = [...new Set([...decision.merchantSourceEmailIds, ...decision.carrierSourceEmailIds])];
    const { error: statusError } = await db.from('source_emails').update({
      processing_status: 'processed',
      processed_at: new Date().toISOString(),
    }).eq('user_id', decision.userId).in('id', linkedSourceIds);
    if (statusError) throw new Error(`Corroborated reconstruction source status update failed: ${statusError.message}`);
  }

  return {
    scanned: merchantRows.length + carrierRows.length,
    candidates: decisions.length,
    reconstructed,
    shipments,
    review,
  };
}
