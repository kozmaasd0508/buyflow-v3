import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import {
  htmlToCompactText,
  type BuyFlowEmailEventType,
  type EmailExtraction,
} from '../ai/openai-email-extractor.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';
import { parseAboutYouCommerceEmail } from './aboutyou-commerce-adapter.js';
import { parseAllegroOrderEmail } from './allegro-order-adapter.js';
import { parseAlzaCommerceEmail } from './alza-commerce-adapter.js';
import { preprocessExpressOneTerminalReceiptNylasMessage } from './expressone-terminal-receipt-adapter.js';
import { parseGenericOrderConfirmationEmail } from './generic-order-confirmation-adapter.js';
import { parseMerchantPreAdviceEmail } from './pre-advice-commerce-adapter.js';
import { parseZalandoCommerceEmail } from './zalando-commerce-adapter.js';

const PARSER_VERSION = 'deterministic-commerce-v2';
const AI_OFF_FALLBACK_PARSER_VERSION = 'deterministic-ai-off-fallback-v1';
const DETERMINISTIC_BODY_MAX_CHARS = 80_000;

interface CarrierRule {
  name: string;
  domainTokens: string[];
}

const CARRIER_RULES: CarrierRule[] = [
  { name: 'Express One', domainTokens: ['expressone'] },
  { name: 'GLS', domainTokens: ['gls'] },
  { name: 'DPD', domainTokens: ['dpd'] },
  { name: 'Foxpost', domainTokens: ['foxpost'] },
  { name: 'Packeta', domainTokens: ['packeta'] },
  { name: 'DHL', domainTokens: ['dhl'] },
  { name: 'UPS', domainTokens: ['ups'] },
];

const TRACKING_LABEL_PATTERN = /\b(?:tracking(?:\s*(?:number|no\.?|id))?|nyomkovetesi\s*(?:szam|azonosito)|csomag(?:szam|azonosito)|kul[d]?emeny(?:szam|azonosito)|parcel(?:\s*(?:number|no\.?|id))|shipment(?:\s*(?:number|no\.?|id)))\s*[:#-]?\s*([a-z0-9][a-z0-9-]{7,31})\b/gi;

const FUTURE_DELIVERY_PATTERNS = [
  /\bout for delivery\b/i,
  /\bkezbesites alatt\b/i,
  /\bkezbesitesre kerul\b/i,
  /\bkezbesitjuk\b/i,
  /\bkezbesites varhato\b/i,
];

const DELIVERED_PATTERNS = [
  /\bhas been delivered\b/i,
  /\bwas delivered\b/i,
  /\bdelivered successfully\b/i,
  /\bsuccessfully delivered\b/i,
  /\bsikeresen kezbesitett(?:uk|ek)?\b/i,
  /\bkezbesitve\b/i,
  /\batvette\b/i,
  /\batvetel megtortent\b/i,
];

export type DeterministicShipmentPhase =
  | 'shipment_created'
  | 'shipped'
  | 'in_transit'
  | 'out_for_delivery'
  | 'ready_for_pickup'
  | 'delivered';

export interface DeterministicCommerceParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
  shipmentPhase?: DeterministicShipmentPhase;
}

export interface DeterministicEmailPreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  parserVersion?: string;
}

export function canReplaceAiOffFallbackWithDeterministic(input: {
  validatedResult: unknown;
  validationStatus: unknown;
  processingStatus: unknown;
}): boolean {
  if (!input.validatedResult || typeof input.validatedResult !== 'object') return false;
  const parserVersion = (input.validatedResult as Record<string, unknown>).parser_version;
  return (
    parserVersion === AI_OFF_FALLBACK_PARSER_VERSION &&
    input.validationStatus === 'review' &&
    input.processingStatus === 'review'
  );
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function domainHasToken(domain: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[.-])${escaped}([.-]|$)`, 'i').test(domain);
}

function domainMatches(domain: string, expected: string): boolean {
  const normalized = normalizeDomain(domain);
  const target = normalizeDomain(expected);
  return normalized === target || normalized.endsWith(`.${target}`);
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(
    from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

function baseExtraction(input: {
  eventType: BuyFlowEmailEventType;
  merchant?: string | null;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  invoiceNumber?: string | null;
  paymentStatus?: EmailExtraction['payment_status'];
  confidence?: number;
}): EmailExtraction {
  return {
    event_type: input.eventType,
    merchant: input.merchant ?? null,
    merchant_legal_name: null,
    order_number: input.orderNumber ?? null,
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
    tracking_number: input.trackingNumber ?? null,
    carrier: input.carrier ?? null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: input.invoiceNumber ?? null,
    products: [],
    confidence: input.confidence ?? 0.96,
  };
}

export function detectCarrierFromDomains(domains: string[]): string | null {
  const normalized = domains.map(normalizeDomain);
  for (const rule of CARRIER_RULES) {
    if (normalized.some((domain) => rule.domainTokens.some((token) => domainHasToken(domain, token)))) {
      return rule.name;
    }
  }
  return null;
}

function detectCarrierFromText(text: string): string | null {
  const normalized = normalizeText(text).toLowerCase();
  if (/\bexpress\s*one\b/.test(normalized)) return 'Express One';
  if (/\bgls\b/.test(normalized)) return 'GLS';
  if (/\bdpd\b/.test(normalized)) return 'DPD';
  if (/\bfoxpost\b/.test(normalized)) return 'Foxpost';
  if (/\bpacketa\b/.test(normalized)) return 'Packeta';
  if (/\bdhl\b/.test(normalized)) return 'DHL';
  if (/\bups\b/.test(normalized)) return 'UPS';
  return null;
}

export function extractLabeledTrackingNumber(text: string): string | null {
  const normalized = normalizeText(text);
  TRACKING_LABEL_PATTERN.lastIndex = 0;
  const match = TRACKING_LABEL_PATTERN.exec(normalized);
  if (!match?.[1]) return null;
  return match[1].trim().toUpperCase();
}

function detectCarrierEventType(text: string): BuyFlowEmailEventType {
  const normalized = normalizeText(text);
  if (FUTURE_DELIVERY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'shipment';
  }
  if (DELIVERED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'delivery';
  }
  return 'shipment';
}

function parseKnownCarrierEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicCommerceParseResult | null {
  const carrier = detectCarrierFromDomains(input.senderDomains);
  if (!carrier) return null;

  const contextText = `${input.subject ?? ''}\n${input.bodyText ?? ''}`;
  const trackingNumber = extractLabeledTrackingNumber(contextText);
  if (!trackingNumber) return null;

  const eventType = detectCarrierEventType(contextText);
  return {
    extraction: baseExtraction({ eventType, trackingNumber, carrier, confidence: 0.96 }),
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_carrier_sender',
      'explicit_tracking_label',
      eventType === 'delivery' ? 'explicit_delivery_evidence' : 'shipment_or_transit_evidence',
    ],
  };
}

function parseGymBeamEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicCommerceParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'service.gymbeam.hu'))) {
    return null;
  }

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;

  const invoiceSubject = subject.match(/\bszamlad elkeszult!\s*-\s*(\d{8,20})\b/i);
  const invoiceBody = body.match(/\baz\s+(\d{8,20})\s+szamu\s+szamlad\s+elkeszult\b/i);
  if (invoiceSubject?.[1] && invoiceBody?.[1]) {
    return {
      extraction: baseExtraction({
        eventType: 'invoice_or_receipt',
        merchant: 'GymBeam',
        orderNumber: invoiceSubject[1],
        invoiceNumber: invoiceBody[1],
        confidence: 0.99,
      }),
      parserVersion: PARSER_VERSION,
      reasons: [
        'known_gymbeam_sender',
        'explicit_gymbeam_invoice_subject',
        'explicit_invoice_number_in_body',
      ],
    };
  }

  const shipmentSubject = /\bmegrendelesed uton van\b/i.test(subject);
  const orderMatch = body.match(/\ba\s+(\d{8,20})\s+szamu\s+rendelesed(?:et)?\b/i);
  const trackingMatch = body.match(/\ba\s+([a-z0-9-]{10,32})\s+szammal\s+kovetheted\s+a\s+csomagot\b/i);
  const carrier = detectCarrierFromText(context);
  if (shipmentSubject && orderMatch?.[1] && trackingMatch?.[1] && carrier) {
    return {
      extraction: baseExtraction({
        eventType: 'shipment',
        merchant: 'GymBeam',
        orderNumber: orderMatch[1],
        trackingNumber: trackingMatch[1].toUpperCase(),
        carrier,
        confidence: 0.99,
      }),
      parserVersion: PARSER_VERSION,
      reasons: [
        'known_gymbeam_sender',
        'explicit_gymbeam_shipment_subject',
        'explicit_order_number',
        'explicit_gymbeam_tracking_sentence',
        'explicit_carrier_name',
      ],
    };
  }

  return null;
}

function parseGyerekjatekboltEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicCommerceParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'gyerekjatekbolt.com'))) {
    return null;
  }

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;

  const successfulPayment = /\bsikeres bankkartyas fizetes\b/i.test(context);
  const orderMatch = context.match(/\b(?:a\(z\)\s+)?(\d{5,12})\.?\s+szamu\s+rendeles(?:t|ed)?\b/i)
    ?? context.match(/\brendelesszam\s*[:#-]?\s*#?(\d{5,12})\b/i);

  if (successfulPayment && orderMatch?.[1]) {
    return {
      extraction: baseExtraction({
        eventType: 'payment_completed',
        merchant: 'Gyerekjatekbolt.com',
        orderNumber: orderMatch[1],
        paymentStatus: 'paid',
        confidence: 0.99,
      }),
      parserVersion: PARSER_VERSION,
      reasons: [
        'known_gyerekjatekbolt_sender',
        'explicit_successful_card_payment',
        'explicit_order_number',
      ],
    };
  }

  const explicitDelivered = /\bjelenlegi allapot\s*:\s*rendeles kezbesitve\b/i.test(context)
    || (/\bjelenlegi allapot\b/i.test(context) && /\brendeles kezbesitve\b/i.test(body));
  if (explicitDelivered && orderMatch?.[1]) {
    return {
      extraction: baseExtraction({
        eventType: 'delivery',
        merchant: 'Gyerekjatekbolt.com',
        orderNumber: orderMatch[1],
        confidence: 0.99,
      }),
      parserVersion: PARSER_VERSION,
      reasons: [
        'known_gyerekjatekbolt_sender',
        'explicit_order_delivered_state',
        'explicit_order_number',
      ],
    };
  }

  const explicitShippingState = /\bjelenlegi allapot\s*:\s*szallitas alatt\b/i.test(context);
  const explicitCourierHandoff = /\brendeleset atadtuk a futarszolgalat reszere\b/i.test(body);
  if (explicitShippingState && explicitCourierHandoff && orderMatch?.[1]) {
    return {
      extraction: baseExtraction({
        eventType: 'shipment',
        merchant: 'Gyerekjatekbolt.com',
        orderNumber: orderMatch[1],
        confidence: 0.99,
      }),
      parserVersion: PARSER_VERSION,
      reasons: [
        'known_gyerekjatekbolt_sender',
        'explicit_shipping_state',
        'explicit_courier_handoff',
        'explicit_order_number',
      ],
    };
  }

  return null;
}

function parseDorkoEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicCommerceParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'dorko.hu'))) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;

  const explicitSentNotice = /\bertesites\s*:\s*megrendeles elkuldve\b/i.test(context)
    || /\bdorko\s*:\s*rendeles elkuldve\b/i.test(subject);
  const explicitDispatch = /\bmegrendelese feladasra kerult a megadott cimre\b/i.test(body);
  if (!explicitSentNotice || !explicitDispatch) return null;

  const orderMatch = body.match(/\brendeles azonosito\s*:\s*(DK\d{5,20})\b/i);
  if (!orderMatch?.[1]) return null;

  return {
    extraction: baseExtraction({
      eventType: 'shipment',
      merchant: 'Dorko',
      orderNumber: orderMatch[1].toUpperCase(),
      carrier: detectCarrierFromText(context),
      confidence: 0.99,
    }),
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_dorko_sender',
      'explicit_order_sent_notice',
      'explicit_dispatch_sentence',
      'explicit_order_number',
    ],
  };
}

export function parseDeterministicCommerceEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicCommerceParseResult | null {
  return parseKnownCarrierEmail(input)
    ?? parseMerchantPreAdviceEmail(input)
    ?? parseAlzaCommerceEmail(input)
    ?? parseGymBeamEmail(input)
    ?? parseGyerekjatekboltEmail(input)
    ?? parseDorkoEmail(input)
    ?? parseAllegroOrderEmail(input)
    ?? parseAboutYouCommerceEmail(input)
    ?? parseZalandoCommerceEmail(input)
    ?? parseGenericOrderConfirmationEmail(input);
}

export async function preprocessDeterministicNylasMessage(input: {
  grantId: string;
  messageId: string;
}): Promise<DeterministicEmailPreprocessResult> {
  const receipt = await preprocessExpressOneTerminalReceiptNylasMessage({
    grantId: input.grantId,
    messageId: input.messageId,
    sourceQuery: 'deterministic:expressone-terminal-receipt',
  });
  if (receipt.matched) {
    return {
      matched: true,
      ...(receipt.sourceEmailId ? { sourceEmailId: receipt.sourceEmailId } : {}),
      parserVersion: 'expressone-terminal-receipt-v1',
    };
  }

  const db = getSupabaseAdmin() as any;

  const { data: connection, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) {
    throw new Error(`Failed to resolve deterministic parser grant: ${connectionError.message}`);
  }
  if (!connection) return { matched: false };

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: input.grantId,
  });
  const email = await provider.getMessage(input.messageId);
  const domains = senderDomains(email.from);
  const bodyText = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, DETERMINISTIC_BODY_MAX_CHARS)
    : (email.snippet ?? '').trim().slice(0, DETERMINISTIC_BODY_MAX_CHARS);

  const parsed = parseDeterministicCommerceEmail({
    senderDomains: domains,
    subject: email.subject,
    bodyText,
  });
  if (!parsed) return { matched: false };

  const validated = validateEmailExtraction({
    extraction: parsed.extraction,
    senderDomains: domains,
    subject: email.subject,
    bodyText,
  });
  const now = new Date().toISOString();
  const structuredResult = {
    schema_version: 2,
    ...parsed.extraction,
    ...(parsed.shipmentPhase ? { shipment_phase: parsed.shipmentPhase } : {}),
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };
  const validatedResult = JSON.parse(JSON.stringify(validated)) as Record<string, unknown>;
  validatedResult.extraction_source = 'deterministic';
  validatedResult.parser_version = parsed.parserVersion;
  validatedResult.parser_reasons = parsed.reasons;
  if (parsed.shipmentPhase) {
    validatedResult.shipment_phase = parsed.shipmentPhase;
  }

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,validated_result,validation_status,processing_status')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check deterministic source dedupe: ${existingError.message}`);
  }

  const replaceFallback = existing
    ? canReplaceAiOffFallbackWithDeterministic({
        validatedResult: existing.validated_result,
        validationStatus: existing.validation_status,
        processingStatus: existing.processing_status,
      })
    : false;

  if (existing?.validated_result && !replaceFallback) {
    return {
      matched: true,
      sourceEmailId: existing.id as string,
      parserVersion: parsed.parserVersion,
    };
  }

  if (existing) {
    const { error: updateError } = await db
      .from('source_emails')
      .update({
        classification: parsed.extraction.event_type,
        structured_result: structuredResult,
        validated_result: validatedResult,
        validation_status: validated.validation_status,
        validated_at: now,
        processed_at: now,
        processing_status: 'review',
      })
      .eq('id', existing.id);
    if (updateError) {
      throw new Error(`Failed to update deterministic source email: ${updateError.message}`);
    }

    return {
      matched: true,
      sourceEmailId: existing.id as string,
      parserVersion: parsed.parserVersion,
    };
  }

  const { data: inserted, error: insertError } = await db
    .from('source_emails')
    .insert({
      user_id: connection.user_id,
      email_connection_id: connection.id,
      provider_message_id: email.providerMessageId,
      provider_thread_id: email.providerThreadId ?? null,
      from_address: email.from[0]?.email ?? null,
      subject: email.subject ?? null,
      received_at: email.receivedAt,
      source_query: 'webhook:message.created',
      classification: parsed.extraction.event_type,
      structured_result: structuredResult,
      validated_result: validatedResult,
      validation_status: validated.validation_status,
      validated_at: now,
      processed_at: now,
      processing_status: 'review',
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(`Failed to save deterministic source email: ${insertError?.message ?? 'missing row'}`);
  }

  return {
    matched: true,
    sourceEmailId: inserted.id as string,
    parserVersion: parsed.parserVersion,
  };
}
