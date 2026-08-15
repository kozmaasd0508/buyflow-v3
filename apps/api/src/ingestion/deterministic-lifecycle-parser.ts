import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { htmlToCompactText, type EmailExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender, merchantDisplayName } from '../email/sender-role.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';
import { parseAlzaLifecycleEmail } from './alza-lifecycle-adapter.js';
import { parseGymBeamOrderProcessingEmail } from './gymbeam-order-processing-adapter.js';

const PARSER_VERSION = 'deterministic-lifecycle-v1';
const EXACT_MPL_SENDER = 'kozponti.ertesites@posta.hu';
const EXACT_SZIDIBOX_PUBLIC_SENDER = 'szidibox@gmail.com';

export type DeterministicLifecycleEvent =
  | 'payment_failed'
  | 'cancelled'
  | 'delayed'
  | 'order_processing'
  | 'order_packing'
  | 'ready_to_ship'
  | 'shipment_created'
  | 'shipped'
  | 'out_for_delivery'
  | 'ready_for_pickup';

export interface DeterministicLifecycleParseResult {
  extraction: EmailExtraction;
  lifecycleEvent: DeterministicLifecycleEvent;
  parserVersion: string;
  reasons: string[];
  shipmentPhase?: 'shipment_created' | 'shipped' | 'out_for_delivery' | 'ready_for_pickup';
}

export interface DeterministicLifecyclePreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  lifecycleEvent?: DeterministicLifecycleEvent;
  parserVersion?: string;
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ');
}

function normalizeSenderDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function normalizedEmails(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(from
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@')))];
}

function lifecycleExtraction(input: {
  merchant: string;
  orderNumber: string;
  paymentStatus?: EmailExtraction['payment_status'];
}): EmailExtraction {
  return {
    event_type: 'order_updated',
    merchant: input.merchant,
    merchant_legal_name: null,
    order_number: input.orderNumber,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: input.paymentStatus ?? null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
  };
}

function shipmentExtraction(input: {
  merchant?: string | null;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  carrier: string;
  parcelSender?: string | null;
  codAmount?: number | null;
  codCurrency?: string | null;
  confidence?: number;
}): EmailExtraction {
  return {
    event_type: 'shipment',
    merchant: input.merchant ?? null,
    merchant_legal_name: null,
    order_number: input.orderNumber ?? null,
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
    tracking_number: input.trackingNumber ?? null,
    carrier: input.carrier,
    parcel_sender: input.parcelSender ?? null,
    cod_amount: input.codAmount ?? null,
    cod_currency: input.codCurrency ?? null,
    invoice_number: null,
    products: [],
    confidence: input.confidence ?? 0.995,
  };
}

function gyerekjatekboltOrderNumber(context: string): string | null {
  const labelled = context.match(/\brendelesszam\s*[:#-]?\s*#?(\d{5,12})\b/i);
  if (labelled?.[1]) return labelled[1];
  const sentence = context.match(/\b(?:a\(z\)\s+)?(\d{5,12})\.?\s+szamu\s+rendeles(?:hez|t|ed|e)?\b/i);
  return sentence?.[1] ?? null;
}

function parseGyerekjatekbolt(input: { senderDomains: string[]; subject?: string | null; bodyText?: string | null }): DeterministicLifecycleParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'gyerekjatekbolt')) return null;
  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;
  const orderNumber = gyerekjatekboltOrderNumber(context);
  if (!orderNumber) return null;

  const explicitPaymentFailure = [
    /\bsikertelen bankkartyas fizetes\b/i,
    /\btranzakcio sikertelen volt\b/i,
    /\bbankkartyas fizetes nem sikerult\b/i,
    /\brendelest nem sikerult befizetni\b/i,
  ].some((pattern) => pattern.test(context));
  if (explicitPaymentFailure) {
    return {
      extraction: lifecycleExtraction({ merchant: merchantDisplayName('gyerekjatekbolt'), orderNumber, paymentStatus: 'failed' }),
      lifecycleEvent: 'payment_failed',
      parserVersion: PARSER_VERSION,
      reasons: ['known_gyerekjatekbolt_sender', 'explicit_payment_failure', 'explicit_order_number'],
    };
  }

  const explicitCancellation = [
    /\bjelenlegi allapot\s*:\s*torolve\b/i,
    /\brendeles(?:enek)?\s+(?:aktualis\s+)?(?:allapota|statusza)\s*:\s*torolve\b/i,
    /\bmegrendeles(?:e)?\s+torolve\b/i,
  ].some((pattern) => pattern.test(context));
  if (explicitCancellation) {
    return {
      extraction: lifecycleExtraction({ merchant: merchantDisplayName('gyerekjatekbolt'), orderNumber }),
      lifecycleEvent: 'cancelled',
      parserVersion: PARSER_VERSION,
      reasons: ['known_gyerekjatekbolt_sender', 'explicit_order_cancelled_state', 'explicit_order_number'],
    };
  }
  return null;
}

function parseMpl(input: { senderEmails?: string[]; subject?: string | null; bodyText?: string | null }): DeterministicLifecycleParseResult | null {
  if (!normalizedEmails(input.senderEmails).includes(EXACT_MPL_SENDER)) return null;

  const subject = normalizeText(input.subject ?? '').trim();
  const body = normalizeText(input.bodyText ?? '').replace(/\r/g, '');
  const trackingMatch = body.match(/\bCsomagazonosito\s*:\s*(?:\[\s*)?([A-Z0-9-]{10,32})\b/i);
  const parcelSenderMatch = body.match(/\bFelado\s*:\s*(.+?)(?=\s+Csomagazonosito\s*:|\s+Feladas datuma\s*:|\s+Kezbesitesi cim\s*:|\s+Arufizetesi osszeg\s*:|\n|$)/i);
  const codMatch = body.match(/\bArufizetesi osszeg\s*:\s*([0-9][0-9 .]*)\s*Ft\b/i);
  if (!trackingMatch?.[1] || !parcelSenderMatch?.[1]) return null;

  const trackingNumber = trackingMatch[1].toUpperCase();
  const parcelSender = parcelSenderMatch[1].trim();
  const codAmount = codMatch?.[1] ? Number(codMatch[1].replace(/[^0-9]/g, '')) : null;
  const codCurrency = codAmount !== null && Number.isFinite(codAmount) ? 'HUF' : null;

  let shipmentPhase: 'shipped' | 'out_for_delivery' | 'ready_for_pickup' | null = null;
  if (/^Csomagot adtak fel neked$/i.test(subject) && /\bErtesitunk, hogy csomagot adtak fel Neked\b/i.test(body)) {
    shipmentPhase = 'shipped';
  } else if (/^Csomagod a kezbesitonel van$/i.test(subject) && /\bcsomagod a kezbesitonel van\b/i.test(body)) {
    shipmentPhase = 'out_for_delivery';
  } else if (/^Csomagod a postan atveheto$/i.test(subject) && /\bcsomagod[\s\S]{0,120}?atveheto az alabbi postan\b/i.test(body)) {
    shipmentPhase = 'ready_for_pickup';
  }
  if (!shipmentPhase) return null;

  return {
    extraction: shipmentExtraction({
      trackingNumber,
      carrier: 'Magyar Posta Logisztika (MPL)',
      parcelSender,
      codAmount: codCurrency ? codAmount : null,
      codCurrency,
      confidence: 0.995,
    }),
    lifecycleEvent: shipmentPhase,
    shipmentPhase,
    parserVersion: PARSER_VERSION,
    reasons: [
      'exact_mpl_sender',
      'explicit_mpl_tracking_identity',
      'explicit_parcel_sender',
      ...(codCurrency ? ['explicit_cod_amount'] : []),
      shipmentPhase === 'shipped'
        ? 'explicit_carrier_acceptance'
        : shipmentPhase === 'out_for_delivery'
          ? 'explicit_out_for_delivery'
          : 'explicit_ready_for_pickup',
    ],
  };
}

function parseSzidiboxPacking(input: { senderEmails?: string[]; subject?: string | null; bodyText?: string | null }): DeterministicLifecycleParseResult | null {
  if (!normalizedEmails(input.senderEmails).includes(EXACT_SZIDIBOX_PUBLIC_SENDER)) return null;
  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  if (!/kartonshop\.hu/i.test(input.bodyText ?? '')) return null;
  if (!/\bSzidibox Karton Kft\. Webaruhaz\s*-\s*Megrendeleset osszekeszitettuk\b/i.test(subject)) return null;
  if (!/\bosszekeszitettuk es hamarosan atadjuk a futarszolgalat reszere\b/i.test(body)) return null;
  const subjectOrder = subject.match(/\b(SO-\d{4}-\d{4,12})\b/i);
  const bodyOrder = body.match(/\bRendelesszam\s*:\s*(SO-\d{4}-\d{4,12})\b/i);
  if (!subjectOrder?.[1] || !bodyOrder?.[1] || subjectOrder[1].toUpperCase() !== bodyOrder[1].toUpperCase()) return null;

  return {
    extraction: shipmentExtraction({
      merchant: 'Szidibox Karton Kft. Webáruház',
      orderNumber: bodyOrder[1].toUpperCase(),
      carrier: 'MPL',
      confidence: 0.995,
    }),
    lifecycleEvent: 'shipment_created',
    shipmentPhase: 'shipment_created',
    parserVersion: PARSER_VERSION,
    reasons: [
      'verified_szidibox_public_mailbox',
      'kartonshop_domain_in_message',
      'explicit_order_number_agreement',
      'explicit_packed_evidence',
      'explicit_future_carrier_handoff',
      'not_physical_shipment_yet',
    ],
  };
}

function parseGymBeam(input: { senderDomains: string[]; subject?: string | null; bodyText?: string | null }): DeterministicLifecycleParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'gymbeam')) return null;
  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  if (!/\bellenorizzuk a kezbesitest\b/i.test(subject)) return null;
  const delayMatch = body.match(/\ba\(z\)\s+(\d{8,20})\s+rendelese\s+kesik\b/i)
    ?? body.match(/\b(\d{8,20})\s+szamu\s+rendeles(?:ed|e)?\s+kesik\b/i);
  if (!delayMatch?.[1]) return null;
  return {
    extraction: lifecycleExtraction({ merchant: merchantDisplayName('gymbeam'), orderNumber: delayMatch[1] }),
    lifecycleEvent: 'delayed',
    parserVersion: PARSER_VERSION,
    reasons: ['known_gymbeam_sender', 'explicit_delivery_check_subject', 'explicit_order_delay_sentence', 'explicit_order_number'],
  };
}

function parseMarketa(input: { senderDomains: string[]; subject?: string | null; bodyText?: string | null }): DeterministicLifecycleParseResult | null {
  if (!input.senderDomains.map(normalizeSenderDomain).includes('marketa.hu')) return null;
  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;
  const orderMatch = context.match(/\b(\d{6,12})\s+(?:szamu\s+)?rendeles(?:ed|eddel)?\b/i);
  if (!orderMatch?.[1]) return null;

  const subjectPacking = /\belkezdtuk\s+rendelesed\s+osszekesziteset\b/i.test(subject);
  const explicitPacking = /\braktarunk\s+mar\s+elkezdte\s+becsomagolni\b/i.test(body);
  const futureCourierHandoff = /\b(?:1\s*-\s*2|1-2)\s+munkanapon\s+belul\s+atadja\s+azt\s+a\s+futarszolgalatnak\b/i.test(body);
  if (!subjectPacking || !explicitPacking || !futureCourierHandoff) return null;

  return {
    extraction: lifecycleExtraction({ merchant: 'Marketa.hu', orderNumber: orderMatch[1] }),
    lifecycleEvent: 'order_packing',
    parserVersion: PARSER_VERSION,
    reasons: ['exact_marketa_sender', 'explicit_order_packing_subject', 'explicit_warehouse_packing_sentence', 'explicit_future_courier_handoff', 'explicit_order_number'],
  };
}

export function parseDeterministicLifecycleEmail(input: { senderDomains: string[]; senderEmails?: string[]; subject?: string | null; bodyText?: string | null }): DeterministicLifecycleParseResult | null {
  return parseMpl(input)
    ?? parseSzidiboxPacking(input)
    ?? parseGyerekjatekbolt(input)
    ?? parseGymBeamOrderProcessingEmail(input)
    ?? parseGymBeam(input)
    ?? parseMarketa(input)
    ?? parseAlzaLifecycleEmail(input);
}

function sourceClassification(parsed: DeterministicLifecycleParseResult): string {
  return parsed.shipmentPhase ? parsed.extraction.event_type : parsed.lifecycleEvent;
}

export async function preprocessDeterministicLifecycleNylasMessage(input: { grantId: string; messageId: string }): Promise<DeterministicLifecyclePreprocessResult> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db.from('email_connections')
    .select('id,user_id,provider_account_id').eq('provider', 'nylas').eq('provider_account_id', input.grantId)
    .eq('status', 'active').maybeSingle();
  if (connectionError) throw new Error(`Failed to resolve lifecycle parser grant: ${connectionError.message}`);
  if (!connection) return { matched: false };

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: input.grantId });
  const email = await provider.getMessage(input.messageId);
  const domains = senderDomains(email.from);
  const senderEmails = email.from.map((address) => address.email);
  const bodyText = email.bodyHtml ? htmlToCompactText(email.bodyHtml) : (email.snippet ?? '').trim().slice(0, 20_000);
  const parsed = parseDeterministicLifecycleEmail({ senderDomains: domains, senderEmails, subject: email.subject, bodyText });
  if (!parsed) return { matched: false };

  const validated = validateEmailExtraction({ extraction: parsed.extraction, senderDomains: domains, subject: email.subject, bodyText });
  const now = new Date().toISOString();
  const structuredResult = {
    schema_version: 2,
    ...parsed.extraction,
    lifecycle_event: parsed.lifecycleEvent,
    ...(parsed.shipmentPhase ? { shipment_phase: parsed.shipmentPhase } : {}),
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };
  const validatedResult = {
    ...(JSON.parse(JSON.stringify(validated)) as Record<string, unknown>),
    lifecycle_event: parsed.lifecycleEvent,
    ...(parsed.shipmentPhase ? { shipment_phase: parsed.shipmentPhase } : {}),
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };

  const { data: existing, error: existingError } = await db.from('source_emails').select('id,validated_result')
    .eq('email_connection_id', connection.id).eq('provider_message_id', input.messageId).maybeSingle();
  if (existingError) throw new Error(`Failed to check lifecycle source dedupe: ${existingError.message}`);
  const existingLifecycle = existing?.validated_result && typeof existing.validated_result === 'object'
    ? (existing.validated_result as Record<string, unknown>).lifecycle_event : null;
  const existingParser = existing?.validated_result && typeof existing.validated_result === 'object'
    ? (existing.validated_result as Record<string, unknown>).parser_version : null;
  if (existing && existingLifecycle === parsed.lifecycleEvent && existingParser === parsed.parserVersion) {
    return { matched: true, sourceEmailId: existing.id as string, lifecycleEvent: parsed.lifecycleEvent, parserVersion: parsed.parserVersion };
  }

  if (existing) {
    const { error: updateError } = await db.from('source_emails').update({
      classification: sourceClassification(parsed), structured_result: structuredResult, validated_result: validatedResult,
      validation_status: validated.validation_status, validated_at: now, processed_at: now, processing_status: 'review',
    }).eq('id', existing.id);
    if (updateError) throw new Error(`Failed to update lifecycle source email: ${updateError.message}`);
    return { matched: true, sourceEmailId: existing.id as string, lifecycleEvent: parsed.lifecycleEvent, parserVersion: parsed.parserVersion };
  }

  const { data: inserted, error: insertError } = await db.from('source_emails').insert({
    user_id: connection.user_id, email_connection_id: connection.id, provider_message_id: email.providerMessageId,
    provider_thread_id: email.providerThreadId ?? null, from_address: email.from[0]?.email ?? null,
    subject: email.subject ?? null, received_at: email.receivedAt, source_query: 'webhook:message.created',
    classification: sourceClassification(parsed), structured_result: structuredResult, validated_result: validatedResult,
    validation_status: validated.validation_status, validated_at: now, processed_at: now, processing_status: 'review',
  }).select('id').single();
  if (insertError || !inserted) throw new Error(`Failed to save lifecycle source email: ${insertError.message ?? 'missing row'}`);
  return { matched: true, sourceEmailId: inserted.id as string, lifecycleEvent: parsed.lifecycleEvent, parserVersion: parsed.parserVersion };
}
