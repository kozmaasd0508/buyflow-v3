import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import {
  htmlToCompactText,
  type EmailExtraction,
} from '../ai/openai-email-extractor.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';
import { parseAlzaLifecycleEmail } from './alza-lifecycle-adapter.js';

const PARSER_VERSION = 'deterministic-lifecycle-v1';

export type DeterministicLifecycleEvent =
  | 'payment_failed'
  | 'cancelled'
  | 'delayed';

export interface DeterministicLifecycleParseResult {
  extraction: EmailExtraction;
  lifecycleEvent: DeterministicLifecycleEvent;
  parserVersion: string;
  reasons: string[];
}

export interface DeterministicLifecyclePreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  lifecycleEvent?: DeterministicLifecycleEvent;
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

function gyerekjatekboltOrderNumber(context: string): string | null {
  const labelled = context.match(/\brendelesszam\s*[:#-]?\s*#?(\d{5,12})\b/i);
  if (labelled?.[1]) return labelled[1];

  const sentence = context.match(
    /\b(?:a\(z\)\s+)?(\d{5,12})\.?\s+szamu\s+rendeles(?:hez|t|ed|e)?\b/i,
  );
  return sentence?.[1] ?? null;
}

function parseGyerekjatekbolt(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicLifecycleParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'gyerekjatekbolt.com'))) {
    return null;
  }

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
      extraction: lifecycleExtraction({
        merchant: 'Gyerekjatekbolt.com',
        orderNumber,
        paymentStatus: 'failed',
      }),
      lifecycleEvent: 'payment_failed',
      parserVersion: PARSER_VERSION,
      reasons: [
        'known_gyerekjatekbolt_sender',
        'explicit_payment_failure',
        'explicit_order_number',
      ],
    };
  }

  const explicitCancellation = [
    /\bjelenlegi allapot\s*:\s*torolve\b/i,
    /\brendeles(?:enek)?\s+(?:aktualis\s+)?(?:allapota|statusza)\s*:\s*torolve\b/i,
    /\bmegrendeles(?:e)?\s+torolve\b/i,
  ].some((pattern) => pattern.test(context));

  if (explicitCancellation) {
    return {
      extraction: lifecycleExtraction({
        merchant: 'Gyerekjatekbolt.com',
        orderNumber,
      }),
      lifecycleEvent: 'cancelled',
      parserVersion: PARSER_VERSION,
      reasons: [
        'known_gyerekjatekbolt_sender',
        'explicit_order_cancelled_state',
        'explicit_order_number',
      ],
    };
  }

  return null;
}

function parseGymBeam(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicLifecycleParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'service.gymbeam.hu'))) {
    return null;
  }

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');

  if (!/\bellenorizzuk a kezbesitest\b/i.test(subject)) return null;

  const delayMatch = body.match(/\ba\(z\)\s+(\d{8,20})\s+rendelese\s+kesik\b/i)
    ?? body.match(/\b(\d{8,20})\s+szamu\s+rendeles(?:ed|e)?\s+kesik\b/i);
  if (!delayMatch?.[1]) return null;

  return {
    extraction: lifecycleExtraction({
      merchant: 'GymBeam',
      orderNumber: delayMatch[1],
    }),
    lifecycleEvent: 'delayed',
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_gymbeam_sender',
      'explicit_delivery_check_subject',
      'explicit_order_delay_sentence',
      'explicit_order_number',
    ],
  };
}

export function parseDeterministicLifecycleEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): DeterministicLifecycleParseResult | null {
  return parseGyerekjatekbolt(input)
    ?? parseGymBeam(input)
    ?? parseAlzaLifecycleEmail(input);
}

export async function preprocessDeterministicLifecycleNylasMessage(input: {
  grantId: string;
  messageId: string;
}): Promise<DeterministicLifecyclePreprocessResult> {
  const db = getSupabaseAdmin() as any;

  const { data: connection, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) {
    throw new Error(`Failed to resolve lifecycle parser grant: ${connectionError.message}`);
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

  const parsed = parseDeterministicLifecycleEmail({
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
    throw new Error(`Failed to check lifecycle source dedupe: ${existingError.message}`);
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
      throw new Error(`Failed to update lifecycle source email: ${updateError.message}`);
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
    throw new Error(`Failed to save lifecycle source email: ${insertError?.message ?? 'missing row'}`);
  }

  return {
    matched: true,
    sourceEmailId: inserted.id as string,
    lifecycleEvent: parsed.lifecycleEvent,
    parserVersion: parsed.parserVersion,
  };
}
