import { extractEmailWithOpenAIResult, htmlToCompactText } from '../ai/openai-email-extractor.js';
import { requireOpenAIConfig } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import type { NormalizedEmail } from '../email/types.js';
import { filterCommerceEmail } from './commerce-email-filter.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

const AUDIT_PROMPT_VERSION = 'nano-email-audit-benchmark-v2';

function senderDomains(email: NormalizedEmail): string[] {
  return [...new Set(
    email.from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && error.name
    ? error.name.slice(0, 80)
    : 'UnknownError';
}

async function ensureAuditSource(input: {
  userId: string;
  emailConnectionId: string;
  email: NormalizedEmail;
}): Promise<string> {
  const db = getSupabaseAdmin() as any;
  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id')
    .eq('email_connection_id', input.emailConnectionId)
    .eq('provider_message_id', input.email.providerMessageId)
    .maybeSingle();

  if (existingError) throw new Error(`Audit source lookup failed: ${existingError.message}`);
  if (existing?.id) return existing.id as string;

  const { data: inserted, error: insertError } = await db
    .from('source_emails')
    .insert({
      user_id: input.userId,
      email_connection_id: input.emailConnectionId,
      provider_message_id: input.email.providerMessageId,
      provider_thread_id: input.email.providerThreadId ?? null,
      from_address: input.email.from[0]?.email ?? null,
      subject: input.email.subject ?? null,
      received_at: input.email.receivedAt,
      source_query: 'audit:full-inbox',
      processing_status: 'pending',
    })
    .select('id')
    .single();

  if (insertError || !inserted?.id) {
    throw new Error(`Audit source insert failed: ${insertError?.message ?? 'missing id'}`);
  }
  return inserted.id as string;
}

async function linkedPurchaseForSource(userId: string, sourceEmailId: string): Promise<string | null> {
  const db = getSupabaseAdmin() as any;
  const { data: links, error } = await db
    .from('purchase_sources')
    .select('purchase_id,purchases!inner(user_id)')
    .eq('source_email_id', sourceEmailId)
    .limit(2);
  if (error) return null;
  const own = (links ?? []).find((row: any) => row.purchases?.user_id === userId);
  return typeof own?.purchase_id === 'string' ? own.purchase_id : null;
}

export interface AuditBenchmarkResult {
  sourceEmailId: string;
  aiCalled: boolean;
  aiEventType: string | null;
  filterRelevant: boolean;
  linkedPurchaseId: string | null;
  failed: boolean;
}

export async function processEmailForAuditBenchmark(input: {
  jobId: string;
  userId: string;
  emailConnectionId: string;
  email: NormalizedEmail;
}): Promise<AuditBenchmarkResult> {
  const db = getSupabaseAdmin() as any;
  const sourceEmailId = await ensureAuditSource(input);
  const filter = filterCommerceEmail(input.email);
  const gmailCategoryPurchases = input.email.folders
    .some((folder) => folder.toUpperCase() === 'CATEGORY_PURCHASES');
  const linkedPurchaseId = await linkedPurchaseForSource(input.userId, sourceEmailId);

  const { data: existingAudit, error: auditReadError } = await db
    .from('email_audit_results')
    .select('id,ai_event_type,filter_relevant,linked_purchase_id,ai_error_code')
    .eq('job_id', input.jobId)
    .eq('source_email_id', sourceEmailId)
    .maybeSingle();
  if (auditReadError) throw new Error(`Audit result lookup failed: ${auditReadError.message}`);
  if (existingAudit) {
    return {
      sourceEmailId,
      aiCalled: false,
      aiEventType: existingAudit.ai_event_type ?? null,
      filterRelevant: Boolean(existingAudit.filter_relevant),
      linkedPurchaseId: existingAudit.linked_purchase_id ?? null,
      failed: Boolean(existingAudit.ai_error_code),
    };
  }

  const compactBody = input.email.bodyHtml
    ? htmlToCompactText(input.email.bodyHtml)
    : (input.email.snippet ?? '').trim().slice(0, 20_000);
  const openai = requireOpenAIConfig();

  try {
    // Audit intentionally asks AI to inspect every inbox message, including
    // messages the cheap production pre-filter would normally skip.
    const ai = await extractEmailWithOpenAIResult({
      apiKey: openai.apiKey,
      model: openai.model,
      subject: input.email.subject,
      fromDomains: senderDomains(input.email),
      bodyText: compactBody,
    });
    const validated = validateEmailExtraction({
      extraction: ai.extraction,
      senderDomains: senderDomains(input.email),
      subject: input.email.subject,
      bodyText: compactBody,
    });

    const { error: insertError } = await db.from('email_audit_results').insert({
      job_id: input.jobId,
      user_id: input.userId,
      source_email_id: sourceEmailId,
      gmail_category_purchases: gmailCategoryPurchases,
      filter_relevant: filter.relevant,
      filter_reasons: filter.reasons,
      ai_event_type: validated.event_type,
      ai_confidence: validated.confidence,
      ai_validation_status: validated.validation_status,
      ai_result: {
        schema_version: 2,
        prompt_version: AUDIT_PROMPT_VERSION,
        model: openai.model,
        input_tokens: ai.inputTokens,
        output_tokens: ai.outputTokens,
        total_tokens: ai.totalTokens,
        extraction: ai.extraction,
        validated,
      },
      ai_error_code: null,
      linked_purchase_id: linkedPurchaseId,
    });
    if (insertError) throw new Error(`Audit result insert failed: ${insertError.message}`);

    return {
      sourceEmailId,
      aiCalled: true,
      aiEventType: validated.event_type,
      filterRelevant: filter.relevant,
      linkedPurchaseId,
      failed: false,
    };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    await db.from('email_audit_results').insert({
      job_id: input.jobId,
      user_id: input.userId,
      source_email_id: sourceEmailId,
      gmail_category_purchases: gmailCategoryPurchases,
      filter_relevant: filter.relevant,
      filter_reasons: filter.reasons,
      ai_event_type: null,
      ai_confidence: null,
      ai_validation_status: null,
      ai_result: null,
      ai_error_code: errorCode,
      linked_purchase_id: linkedPurchaseId,
    });
    return {
      sourceEmailId,
      aiCalled: true,
      aiEventType: null,
      filterRelevant: filter.relevant,
      linkedPurchaseId,
      failed: true,
    };
  }
}
