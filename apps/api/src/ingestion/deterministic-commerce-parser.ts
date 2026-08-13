import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import {
  htmlToCompactText,
  type BuyFlowEmailEventType,
  type EmailExtraction,
} from '../ai/openai-email-extractor.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

const PARSER_VERSION = 'deterministic-carrier-v1';

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

export interface DeterministicCommerceParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
}

export interface DeterministicEmailPreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  parserVersion?: string;
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

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(
    from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
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

function emptyExtraction(input: {
  eventType: BuyFlowEmailEventType;
  trackingNumber: string;
  carrier: string;
}): EmailExtraction {
  return {
    event_type: input.eventType,
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
    carrier: input.carrier,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.96,
  };
}

export function parseDeterministicCommerceEmail(input: {
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
    extraction: emptyExtraction({ eventType, trackingNumber, carrier }),
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_carrier_sender',
      'explicit_tracking_label',
      eventType === 'delivery' ? 'explicit_delivery_evidence' : 'shipment_or_transit_evidence',
    ],
  };
}

export async function preprocessDeterministicNylasMessage(input: {
  grantId: string;
  messageId: string;
}): Promise<DeterministicEmailPreprocessResult> {
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
    ? htmlToCompactText(email.bodyHtml)
    : (email.snippet ?? '').trim().slice(0, 20_000);

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
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };
  const validatedResult = JSON.parse(JSON.stringify(validated)) as Record<string, unknown>;

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,validated_result')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check deterministic source dedupe: ${existingError.message}`);
  }

  if (existing?.validated_result) {
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
