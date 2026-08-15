import { htmlToCompactText, type EmailExtraction } from '../ai/openai-email-extractor.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

const PARSER_VERSION = 'gls-lifecycle-v1';
const BRIDGE_VERSION = 'carrier-sender-cod-bridge-v1';
const EXACT_GLS_SENDER = 'noreply@gls-hungary.com';
const MAX_PURCHASE_DISTANCE_MS = 14 * 86_400_000;
const MAX_MERCHANT_SOURCE_DISTANCE_MS = 3 * 86_400_000;

export type GlsShipmentPhase = 'shipment_created' | 'in_transit' | 'out_for_delivery';

export interface GlsLifecycleParseResult {
  extraction: EmailExtraction;
  shipmentPhase: GlsShipmentPhase;
  parserVersion: string;
  reasons: string[];
}

export interface GlsBridgeCandidate {
  purchaseId: string;
  merchantName: string | null;
  merchantLegalName: string | null;
  merchantDomain: string | null;
  orderNumber: string | null;
  subtotal: number | null;
  shippingAmount: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  expectedCarrier: string | null;
  orderedAt: string | null;
}

export interface GlsBridgeResolution {
  purchaseId: string | null;
  decision: 'linkable' | 'review';
  reasons: string[];
}

export interface GlsPreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  parserVersion?: string;
  bridgedPurchaseId?: string;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeIdentity(value: string | null | undefined): string {
  return normalizeText(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function senderIsExactGls(from: Array<{ email: string }>): boolean {
  return from.some((address) => address.email.trim().toLowerCase() === EXACT_GLS_SENDER);
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(from
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@')))];
}

function domainFromAddress(value: string | null | undefined): string {
  const email = (value ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).replace(/[)>]+$/, '') : '';
}

function domainMatches(value: string, expected: string): boolean {
  const left = value.trim().toLowerCase().replace(/^www\./, '');
  const right = expected.trim().toLowerCase().replace(/^www\./, '');
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`)));
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function trackingFromText(subject: string, body: string): string | null {
  const subjectMatch = normalizeText(subject).match(/^GLS\s+([A-Z0-9-]{8,32})\b/i);
  if (subjectMatch?.[1]) return subjectMatch[1].toUpperCase();

  const normalizedBody = normalizeText(body);
  const labelMatch = normalizedBody.match(/\b(?:Csomagszam|Parcel number)\s*:\s*\[?([A-Z0-9-]{8,32})\b/i);
  if (labelMatch?.[1]) return labelMatch[1].toUpperCase();

  const urlMatch = body.match(/https?:\/\/gls-rtt\.com\/[^\s)\]]*#\/HU\/hu\/([A-Z0-9-]{8,32})\b/i)
    ?? body.match(/(?:parcelNumber=|[?&]match=)([A-Z0-9-]{8,32})\b/i);
  return urlMatch?.[1]?.toUpperCase() ?? null;
}

function labeledValue(body: string, labels: string[]): string | null {
  const lines = body.replace(/\r/g, '').split('\n').map((line) => line.trim());
  const normalizedLabels = labels.map((label) => normalizeText(label).toLowerCase());
  for (let i = 0; i < lines.length; i += 1) {
    const line = normalizeText(lines[i] ?? '').toLowerCase().replace(/:$/, '');
    if (!normalizedLabels.includes(line)) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      const candidate = (lines[j] ?? '').trim();
      if (candidate) return candidate;
    }
  }
  return null;
}

function parcelSenderFromBody(body: string): string | null {
  return labeledValue(body, ['Feladó', 'Sender']);
}

function codFromBody(body: string): { amount: number; currency: string } | null {
  const raw = labeledValue(body, ['Utánvét összege', 'Utánvét összeg', 'Cash on delivery']);
  if (!raw) return null;
  const match = normalizeText(raw).match(/^([0-9][0-9 .,'’]*)\s*([A-Z]{3})\b/i);
  if (!match?.[1] || !match[2]) return null;
  const amount = Number(match[1].replace(/[^0-9]/g, ''));
  return Number.isFinite(amount) ? { amount, currency: match[2].toUpperCase() } : null;
}

function extraction(input: {
  trackingNumber: string;
  parcelSender: string | null;
  cod: { amount: number; currency: string } | null;
  confidence: number;
}): EmailExtraction {
  return {
    event_type: 'shipment',
    merchant: null,
    merchant_legal_name: null,
    order_number: null,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: input.trackingNumber,
    carrier: 'GLS',
    parcel_sender: input.parcelSender,
    cod_amount: input.cod?.amount ?? null,
    cod_currency: input.cod?.currency ?? null,
    invoice_number: null,
    products: [],
    confidence: input.confidence,
  };
}

export function parseGlsLifecycleEmail(input: {
  from: Array<{ email: string }>;
  subject?: string | null;
  bodyText?: string | null;
}): GlsLifecycleParseResult | null {
  if (!senderIsExactGls(input.from)) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = input.bodyText ?? '';
  const normalizedBody = normalizeText(body);
  const trackingNumber = trackingFromText(subject, body);
  if (!trackingNumber) return null;

  const parcelSender = parcelSenderFromBody(body);
  const cod = codFromBody(body);

  if (
    /^GLS csomag informacio\s*\/\s*GLS parcel information$/i.test(subject) &&
    (/\bpartnerunk csomago\(ka\)t keszitett ossze\b/i.test(normalizedBody) || /\bour partner has prepared parcel\(s\)\b/i.test(normalizedBody)) &&
    (/\bamennyiben partnerunk ma feladja\b/i.test(normalizedBody) || /\bif our partner dispatches the parcel\(s\) today\b/i.test(normalizedBody)) &&
    parcelSender
  ) {
    return {
      extraction: extraction({ trackingNumber, parcelSender, cod, confidence: 0.995 }),
      shipmentPhase: 'shipment_created',
      parserVersion: PARSER_VERSION,
      reasons: ['exact_gls_sender', 'parcel_pre_advice', 'explicit_sender_label', 'explicit_tracking_identity', ...(cod ? ['explicit_cod_amount'] : [])],
    };
  }

  if (
    /\bmai kezbesitese\b|\bdelivery today\b/i.test(subject) &&
    (/\bmai napon megkisereljuk kezbesiteni\b/i.test(normalizedBody) || /\battempt to deliver[^.]{0,100}\btoday\b/i.test(normalizedBody)) &&
    parcelSender
  ) {
    return {
      extraction: extraction({ trackingNumber, parcelSender, cod, confidence: 0.995 }),
      shipmentPhase: 'out_for_delivery',
      parserVersion: PARSER_VERSION,
      reasons: ['exact_gls_sender', 'delivery_today_not_delivered', 'explicit_sender_label', 'explicit_tracking_identity', ...(cod ? ['explicit_cod_amount'] : [])],
    };
  }

  if (
    /^Dinamikus csomagkovetes\s*-\s*GLS$/i.test(subject) &&
    /\bdinamikus csomagkoveto szolgaltatasunk\b/i.test(normalizedBody) &&
    /https?:\/\/gls-rtt\.com\//i.test(body)
  ) {
    return {
      extraction: extraction({ trackingNumber, parcelSender: null, cod: null, confidence: 0.99 }),
      shipmentPhase: 'in_transit',
      parserVersion: PARSER_VERSION,
      reasons: ['exact_gls_sender', 'dynamic_tracking', 'tracking_from_gls_rtt_url', 'not_delivered'],
    };
  }

  return null;
}

function expectedAmount(candidate: GlsBridgeCandidate): number | null {
  if (candidate.totalAmount !== null) return candidate.totalAmount;
  if (candidate.subtotal === null || candidate.shippingAmount === null) return null;
  return candidate.subtotal + candidate.shippingAmount - (candidate.discountAmount ?? 0);
}

function exactMerchantMatch(parcelSender: string, candidate: GlsBridgeCandidate): boolean {
  const sender = normalizeIdentity(parcelSender);
  return Boolean(sender) && [candidate.merchantName, candidate.merchantLegalName]
    .some((value) => normalizeIdentity(value) === sender);
}

export function resolveGlsPurchaseBridge(input: {
  parcelSender: string;
  codAmount: number;
  codCurrency: string;
  receivedAt: string;
  candidates: GlsBridgeCandidate[];
}): GlsBridgeResolution {
  const receivedAt = Date.parse(input.receivedAt);
  if (!Number.isFinite(receivedAt)) return { purchaseId: null, decision: 'review', reasons: ['invalid_gls_timestamp'] };

  const eligible = input.candidates.filter((candidate) => {
    if (!candidate.orderNumber || !candidate.orderedAt) return false;
    if (!exactMerchantMatch(input.parcelSender, candidate)) return false;
    if (!/utanvet/i.test(normalizeIdentity(candidate.paymentMethod))) return false;
    if (candidate.expectedCarrier && !/\bgls\b/i.test(normalizeText(candidate.expectedCarrier))) return false;
    const amount = expectedAmount(candidate);
    if (amount === null || Math.abs(amount - input.codAmount) > 1) return false;
    if (candidate.currency && candidate.currency.toUpperCase() !== input.codCurrency.toUpperCase()) return false;
    const orderedAt = Date.parse(candidate.orderedAt);
    const distance = receivedAt - orderedAt;
    return Number.isFinite(orderedAt) && distance >= 0 && distance <= MAX_PURCHASE_DISTANCE_MS;
  });

  if (eligible.length !== 1) {
    return {
      purchaseId: null,
      decision: 'review',
      reasons: eligible.length === 0 ? ['no_unique_sender_cod_time_candidate'] : ['multiple_sender_cod_time_candidates'],
    };
  }

  return {
    purchaseId: eligible[0]!.purchaseId,
    decision: 'linkable',
    reasons: [
      'exact_parcel_sender_matches_purchase_merchant',
      'cod_purchase',
      'cod_amount_within_one_unit',
      'carrier_compatible',
      'purchase_within_14_days',
      'single_candidate',
    ],
  };
}

function addTrackingBridge(previous: unknown, trackingNumber: string) {
  if (!previous || typeof previous !== 'object') return previous;
  return {
    ...(previous as Record<string, unknown>),
    tracking_number: trackingNumber,
    carrier: 'GLS',
    shipment_phase: 'shipment_created',
    tracking_bridge_version: BRIDGE_VERSION,
    tracking_bridge_reasons: [
      'carrier_parcel_sender_matches_purchase_merchant',
      'carrier_cod_matches_purchase_amount_within_one_unit',
      'single_recent_purchase_candidate',
      'existing_merchant_shipment_source',
    ],
  };
}

export async function preprocessGlsCarrierNylasMessage(input: {
  grantId: string;
  messageId: string;
  sourceQuery?: string;
}): Promise<GlsPreprocessResult> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) throw new Error(`GLS grant lookup failed: ${connectionError.message}`);
  if (!connection) return { matched: false };

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: input.grantId });
  const email = await provider.getMessage(input.messageId);
  const bodyText = email.bodyHtml ? htmlToCompactText(email.bodyHtml, 50_000) : (email.snippet ?? '').trim().slice(0, 50_000);
  const parsed = parseGlsLifecycleEmail({ from: email.from, subject: email.subject, bodyText });
  if (!parsed) return { matched: false };

  const validated = validateEmailExtraction({
    extraction: parsed.extraction,
    senderDomains: senderDomains(email.from),
    subject: email.subject,
    bodyText,
  });

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,structured_result,validated_result')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', email.providerMessageId)
    .maybeSingle();
  if (existingError) throw new Error(`GLS source lookup failed: ${existingError.message}`);

  let resolution: GlsBridgeResolution = { purchaseId: null, decision: 'review', reasons: ['no_sender_cod_bridge_identity'] };
  const parcelSender = parsed.extraction.parcel_sender;
  const codAmount = parsed.extraction.cod_amount;
  const codCurrency = parsed.extraction.cod_currency;

  if (parcelSender && codAmount !== null && codCurrency) {
    const cutoff = new Date(Date.parse(email.receivedAt) - MAX_PURCHASE_DISTANCE_MS).toISOString();
    const { data: purchases, error: purchaseError } = await db
      .from('purchases')
      .select('id,merchant_name,merchant_legal_name,merchant_domain,order_number,subtotal,shipping_amount,discount_amount,total_amount,currency,payment_method,expected_carrier,ordered_at')
      .eq('user_id', connection.user_id)
      .gte('ordered_at', cutoff)
      .lte('ordered_at', email.receivedAt);
    if (purchaseError) throw new Error(`GLS bridge candidate lookup failed: ${purchaseError.message}`);

    resolution = resolveGlsPurchaseBridge({
      parcelSender,
      codAmount,
      codCurrency,
      receivedAt: email.receivedAt,
      candidates: (purchases ?? []).map((row: any) => ({
        purchaseId: row.id,
        merchantName: row.merchant_name ?? null,
        merchantLegalName: row.merchant_legal_name ?? null,
        merchantDomain: row.merchant_domain ?? null,
        orderNumber: row.order_number ?? null,
        subtotal: numeric(row.subtotal),
        shippingAmount: numeric(row.shipping_amount),
        discountAmount: numeric(row.discount_amount),
        totalAmount: numeric(row.total_amount),
        currency: row.currency ?? null,
        paymentMethod: row.payment_method ?? null,
        expectedCarrier: row.expected_carrier ?? null,
        orderedAt: row.ordered_at ?? null,
      })),
    });
  }

  const validatedPayload = {
    ...(JSON.parse(JSON.stringify(validated)) as Record<string, unknown>),
    shipment_phase: parsed.shipmentPhase,
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
    bridge_version: BRIDGE_VERSION,
    bridge_reasons: resolution.reasons,
    ...(existing?.validated_result ? { superseded_result: existing.validated_result } : {}),
  };
  const structuredPayload = {
    schema_version: 2,
    ...parsed.extraction,
    shipment_phase: parsed.shipmentPhase,
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
    bridge_version: BRIDGE_VERSION,
    bridge_reasons: resolution.reasons,
    ...(existing?.structured_result ? { superseded_result: existing.structured_result } : {}),
  };
  const now = new Date().toISOString();

  let sourceEmailId: string;
  if (existing) {
    const { error: updateError } = await db.from('source_emails').update({
      classification: 'shipment',
      structured_result: structuredPayload,
      validated_result: validatedPayload,
      validation_status: validated.validation_status,
      validated_at: now,
      processed_at: now,
      processing_status: 'review',
    }).eq('id', existing.id);
    if (updateError) throw new Error(`GLS source update failed: ${updateError.message}`);
    sourceEmailId = existing.id as string;
  } else {
    const { data: inserted, error: insertError } = await db.from('source_emails').insert({
      user_id: connection.user_id,
      email_connection_id: connection.id,
      provider_message_id: email.providerMessageId,
      provider_thread_id: email.providerThreadId ?? null,
      from_address: email.from[0]?.email ?? null,
      subject: email.subject ?? null,
      received_at: email.receivedAt,
      source_query: input.sourceQuery ?? 'deterministic:gls-lifecycle',
      classification: 'shipment',
      structured_result: structuredPayload,
      validated_result: validatedPayload,
      validation_status: validated.validation_status,
      validated_at: now,
      processed_at: now,
      processing_status: 'review',
    }).select('id').single();
    if (insertError || !inserted?.id) throw new Error(`GLS source insert failed: ${insertError?.message ?? 'missing row'}`);
    sourceEmailId = inserted.id as string;
  }

  if (resolution.decision !== 'linkable' || !resolution.purchaseId) {
    return { matched: true, sourceEmailId, parserVersion: parsed.parserVersion };
  }

  const { data: purchase, error: purchaseError } = await db
    .from('purchases')
    .select('id,merchant_domain,order_number,expected_carrier')
    .eq('id', resolution.purchaseId)
    .eq('user_id', connection.user_id)
    .maybeSingle();
  if (purchaseError) throw new Error(`GLS bridged purchase lookup failed: ${purchaseError.message}`);
  if (!purchase?.merchant_domain || !purchase?.order_number) {
    return { matched: true, sourceEmailId, parserVersion: parsed.parserVersion };
  }

  const { data: sourceLinks, error: sourceLinkError } = await db
    .from('purchase_sources')
    .select('source_email_id')
    .eq('purchase_id', resolution.purchaseId)
    .eq('relation_type', 'shipment');
  if (sourceLinkError) throw new Error(`GLS merchant shipment link lookup failed: ${sourceLinkError.message}`);
  const sourceIds = (sourceLinks ?? []).map((row: any) => row.source_email_id).filter(Boolean);
  if (sourceIds.length === 0) return { matched: true, sourceEmailId, parserVersion: parsed.parserVersion };

  const { data: merchantSources, error: merchantSourceError } = await db
    .from('source_emails')
    .select('id,from_address,received_at,structured_result,validated_result')
    .in('id', sourceIds);
  if (merchantSourceError) throw new Error(`GLS merchant source lookup failed: ${merchantSourceError.message}`);

  const carrierAt = Date.parse(email.receivedAt);
  const eligibleMerchantSources = (merchantSources ?? []).filter((row: any) => {
    const result = row.validated_result && typeof row.validated_result === 'object' ? row.validated_result : null;
    if (!result || result.event_type !== 'shipment' || result.tracking_number) return false;
    if ((result.order_number ?? '').toString() !== purchase.order_number) return false;
    if (!domainMatches(domainFromAddress(row.from_address), purchase.merchant_domain)) return false;
    const sourceAt = Date.parse(row.received_at);
    const distance = carrierAt - sourceAt;
    return Number.isFinite(sourceAt) && Number.isFinite(carrierAt) && distance >= 0 && distance <= MAX_MERCHANT_SOURCE_DISTANCE_MS;
  });

  if (eligibleMerchantSources.length !== 1) {
    return { matched: true, sourceEmailId, parserVersion: parsed.parserVersion };
  }

  const merchantSource = eligibleMerchantSources[0] as any;
  const { error: bridgeError } = await db.from('source_emails').update({
    structured_result: addTrackingBridge(merchantSource.structured_result, parsed.extraction.tracking_number as string),
    validated_result: addTrackingBridge(merchantSource.validated_result, parsed.extraction.tracking_number as string),
  }).eq('id', merchantSource.id);
  if (bridgeError) throw new Error(`GLS merchant tracking bridge update failed: ${bridgeError.message}`);

  if (!purchase.expected_carrier) {
    const { error: carrierError } = await db.from('purchases').update({ expected_carrier: 'GLS' })
      .eq('id', resolution.purchaseId).eq('user_id', connection.user_id).is('expected_carrier', null);
    if (carrierError) throw new Error(`GLS expected carrier update failed: ${carrierError.message}`);
  }

  return { matched: true, sourceEmailId, parserVersion: parsed.parserVersion, bridgedPurchaseId: resolution.purchaseId };
}
