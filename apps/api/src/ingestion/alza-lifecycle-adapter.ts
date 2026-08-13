import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import {
  htmlToCompactText,
  type EmailExtraction,
} from '../ai/openai-email-extractor.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

const PARSER_VERSION = 'deterministic-lifecycle-v1';

type AlzaLifecycleEvent = 'payment_failed' | 'cancelled' | 'delayed';

export interface AlzaLifecycleParseResult {
  extraction: EmailExtraction;
  lifecycleEvent: AlzaLifecycleEvent;
  parserVersion: string;
  reasons: string[];
}

export interface AlzaLifecyclePreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  lifecycleEvent?: AlzaLifecycleEvent;
  parserVersion?: string;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

function domainMatches(domain: string, expected: string): boolean {
  const normalized = normalizeDomain(domain);
  const target = normalizeDomain(expected);
  return normalized === target || normalized.endsWith(`.${target}`);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(
    from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

function extractOrderNumber(context: string): string | null {
  const labelled = context.match(/\bmegrendeles\s+(\d{9,12})\b/i);
  if (labelled?.[1]) return labelled[1];

  const subjectStyle = context.match(
    /\b(\d{9,12})\s+sz\.?\s+megr(?:\.|endeles(?:ed|rol|e|t|enek|edet)?)\b/i,
  );
  return subjectStyle?.[1] ?? null;
}

function extraction(input: {
  orderNumber: string;
  paymentStatus?: EmailExtraction['payment_status'];
}): EmailExtraction {
  return {
    event_type: 'order_updated',
    merchant: 'Alza.hu',
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

export function parseAlzaLifecycleEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AlzaLifecycleParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'alza.hu'))) {
    return null;
  }

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;
  const orderNumber = extractOrderNumber(context);
  if (!orderNumber) return null;

  const paymentFailed = [
    /\bbank elutasitotta a reszletfizetest\b/i,
    /\bfizetes(?:e|ed)? sikertelen\b/i,
    /\bfizetes(?:e|ed)? nem sikerult\b/i,
  ].some((pattern) => pattern.test(context));

  if (paymentFailed) {
    return {
      extraction: extraction({ orderNumber, paymentStatus: 'failed' }),
      lifecycleEvent: 'payment_failed',
      parserVersion: PARSER_VERSION,
      reasons: ['known_alza_sender', 'explicit_payment_failure', 'explicit_order_number'],
    };
  }

  const cancelled = [
    /\ba megrendeles torolve\b/i,
    /\btorolt megrendeles\b/i,
    /\bmegrendeles(?:ed|et)? toroltuk\b/i,
    /\bmegrendeles torlese\b/i,
  ].some((pattern) => pattern.test(context));

  if (cancelled) {
    return {
      extraction: extraction({ orderNumber }),
      lifecycleEvent: 'cancelled',
      parserVersion: PARSER_VERSION,
      reasons: ['known_alza_sender', 'explicit_order_cancellation', 'explicit_order_number'],
    };
  }

  const delayed = [
    /\bmegrendeles(?:ed)? kesve erkezik\b/i,
    /\belnezest kerunk a kesesert\b/i,
    /\bkezbesites varhato uj idopontja\b/i,
  ].some((pattern) => pattern.test(context));

  if (delayed) {
    return {
      extraction: extraction({ orderNumber }),
      lifecycleEvent: 'delayed',
      parserVersion: PARSER_VERSION,
      reasons: ['known_alza_sender', 'explicit_order_delay', 'explicit_order_number'],
    };
  }

  return null;
}

export async function preprocessAlzaLifecycleNylasMessage(input: {
  grantId: string;
  messageId: string;
}): Promise<AlzaLifecyclePreprocessResult> {
  const db = getSupabaseAdmin() as any;

  const { data: connection, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) {
    throw new Error(`Failed to resolve Alza lifecycle parser grant: ${connectionError.message}`);
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

  const parsed = parseAlzaLifecycleEmail({
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
    lifecycle_event: parsed.lifecycleEvent,
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };
  const validatedResult = {
    ...(JSON.parse(JSON.stringify(validated)) as Record<string, unknown>),
    lifecycle_event: parsed.lifecycleEvent,
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,validated_result')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check Alza lifecycle source dedupe: ${existingError.message}`);
  }

  const existingLifecycle = existing?.validated_result
    && typeof existing.validated_result === 'object'
    ? (existing.validated_result as Record<string, unknown>).lifecycle_event
    : null;

  if (existing && existingLifecycle === parsed.lifecycleEvent) {
    return {
      matched: true,
      sourceEmailId: existing.id as string,
      lifecycleEvent: parsed.lifecycleEvent,
      parserVersion: parsed.parserVersion,
    };
  }

  if (existing) {
    const { error: updateError } = await db
      .from('source_emails')
      .update({
        classification: parsed.lifecycleEvent,
        structured_result: structuredResult,
        validated_result: validatedResult,
        validation_status: validated.validation_status,
        validated_at: now,
        processed_at: now,
        processing_status: 'review',
      })
      .eq('id', existing.id);
    if (updateError) {
      throw new Error(`Failed to update Alza lifecycle source email: ${updateError.message}`);
    }

    return {
      matched: true,
      sourceEmailId: existing.id as string,
      lifecycleEvent: parsed.lifecycleEvent,
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
      classification: parsed.lifecycleEvent,
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
    throw new Error(`Failed to save Alza lifecycle source email: ${insertError?.message ?? 'missing row'}`);
  }

  return {
    matched: true,
    sourceEmailId: inserted.id as string,
    lifecycleEvent: parsed.lifecycleEvent,
    parserVersion: parsed.parserVersion,
  };
}
