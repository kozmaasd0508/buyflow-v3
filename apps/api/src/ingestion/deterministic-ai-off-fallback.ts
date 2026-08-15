import { env } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { filterCommerceEmail } from './commerce-email-filter.js';

const FALLBACK_VERSION = 'deterministic-ai-off-fallback-v1';
const ALLEGRO_ORDER_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

export interface DeterministicAiOffFallbackResult {
  guarded: boolean;
  sourceEmailId?: string;
  reason?: 'ai_enabled' | 'not_relevant' | 'already_extracted' | 'guarded_for_review';
}

function safeFallbackResult(filterReasons: string[]) {
  return {
    schema_version: 2,
    event_type: 'other',
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
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0,
    validation_status: 'review',
    guardrail_reasons: ['ai_disabled_unmatched_deterministic'],
    extraction_source: 'deterministic_fallback',
    parser_version: FALLBACK_VERSION,
    parser_reasons: filterReasons,
  };
}

function hasToken(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function allegroDiagnostics(input: {
  from: Array<{ email: string }>;
  bodyHtml?: string | null;
  snippet?: string | null;
}): string[] {
  const allegro = input.from.some(({ email }) => /@(?:[a-z0-9-]+\.)*allegro\.(?:com|hu|pl|cz|sk)$/i.test(email.trim()));
  if (!allegro) return [];

  const html = input.bodyHtml ?? '';
  const compact80 = html
    ? htmlToCompactText(html, 80_000)
    : (input.snippet ?? '').trim().slice(0, 80_000);
  const compact500 = html
    ? htmlToCompactText(html, 500_000)
    : compact80;

  const signals = (prefix: string, text: string): string[] => [
    `${prefix}_chars:${text.length}`,
    `${prefix}_uuid:${hasToken(text, ALLEGRO_ORDER_UUID) ? '1' : '0'}`,
    `${prefix}_purchased:${/meg(?:v|w)[áa]s[áa]roltad/i.test(text) ? '1' : '0'}`,
    `${prefix}_total:${/\b(?:ÖSSZESEN|OSSZESEN)\b/i.test(text) ? '1' : '0'}`,
    `${prefix}_payment:${/fizet[eé]si\s+m[oó]d/i.test(text) ? '1' : '0'}`,
    `${prefix}_offer_url:${/\/ajanlat\//i.test(text) ? '1' : '0'}`,
  ];

  return [
    `allegro_diag_html_chars:${html.length}`,
    ...signals('allegro_diag_80k', compact80),
    ...signals('allegro_diag_500k', compact500),
  ];
}

export async function guardNylasMessageWhenAiDisabled(input: {
  grantId: string;
  messageId: string;
  sourceQuery?: string;
}): Promise<DeterministicAiOffFallbackResult> {
  if (env.BUYFLOW_AI_ENABLED) {
    return { guarded: false, reason: 'ai_enabled' };
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
    throw new Error(`Failed to resolve AI-off fallback grant: ${connectionError.message}`);
  }
  if (!connection) return { guarded: false, reason: 'not_relevant' };

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: input.grantId });
  const email = await provider.getMessage(input.messageId);
  const filter = filterCommerceEmail(email);
  if (!filter.relevant) {
    return { guarded: false, reason: 'not_relevant' };
  }

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,validated_result')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check AI-off fallback source dedupe: ${existingError.message}`);
  }

  if (existing?.validated_result) {
    return {
      guarded: true,
      sourceEmailId: existing.id as string,
      reason: 'already_extracted',
    };
  }

  const bodyText = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml)
    : (email.snippet ?? '').trim().slice(0, 20_000);
  const result = safeFallbackResult([
    ...filter.reasons,
    bodyText ? 'deterministic_parser_no_match' : 'deterministic_parser_no_match_no_body',
    ...allegroDiagnostics({
      from: email.from,
      bodyHtml: email.bodyHtml,
      snippet: email.snippet,
    }),
  ]);
  const now = new Date().toISOString();

  if (existing) {
    const { error: updateError } = await db
      .from('source_emails')
      .update({
        classification: 'other',
        structured_result: result,
        validated_result: result,
        validation_status: 'review',
        validated_at: now,
        processed_at: now,
        processing_status: 'review',
      })
      .eq('id', existing.id);
    if (updateError) {
      throw new Error(`Failed to update AI-off fallback source: ${updateError.message}`);
    }
    return {
      guarded: true,
      sourceEmailId: existing.id as string,
      reason: 'guarded_for_review',
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
      source_query: input.sourceQuery ?? 'deterministic:ai-off',
      classification: 'other',
      structured_result: result,
      validated_result: result,
      validation_status: 'review',
      validated_at: now,
      processed_at: now,
      processing_status: 'review',
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(`Failed to save AI-off fallback source: ${insertError?.message ?? 'missing row'}`);
  }

  return {
    guarded: true,
    sourceEmailId: inserted.id as string,
    reason: 'guarded_for_review',
  };
}
