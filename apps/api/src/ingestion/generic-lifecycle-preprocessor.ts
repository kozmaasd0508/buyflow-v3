import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';
import { canReplaceAiOffFallbackWithDeterministic } from './deterministic-commerce-parser.js';
import {
  GENERIC_LIFECYCLE_PARSER_VERSION,
  parseGenericLifecycleEmail,
} from './generic-lifecycle-adapter.js';
import {
  linkGenericLifecycleSource,
  type GenericLifecycleLinkDecision,
} from './generic-lifecycle-linker.js';

const BODY_MAX_CHARS = 80_000;

export interface GenericLifecyclePreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  parserVersion?: string;
  linkDecision?: GenericLifecycleLinkDecision;
  linkedPurchaseId?: string;
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(from
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@')))];
}

export async function preprocessGenericLifecycleNylasMessage(input: {
  grantId: string;
  messageId: string;
}): Promise<GenericLifecyclePreprocessResult> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db.from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) throw new Error(`Generic lifecycle grant lookup failed: ${connectionError.message}`);
  if (!connection) return { matched: false };

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: input.grantId });
  const email = await provider.getMessage(input.messageId);
  const domains = senderDomains(email.from);
  const bodyText = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, BODY_MAX_CHARS)
    : (email.snippet ?? '').trim().slice(0, BODY_MAX_CHARS);
  const parsed = parseGenericLifecycleEmail({
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
  validated.validation_status = 'review';
  validated.eligible_for_purchase_creation = false;
  validated.reasons = [
    ...new Set([
      ...validated.reasons,
      'generic_lifecycle_link_only',
      'generic_lifecycle_no_purchase_creation',
      'generic_lifecycle_no_state_mutation',
    ]),
  ];

  const now = new Date().toISOString();
  const structuredResult = {
    schema_version: 2,
    ...parsed.extraction,
    ...(parsed.shipmentPhase ? { shipment_phase: parsed.shipmentPhase } : {}),
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
    link_only: true,
    would_create_purchase: false,
    would_mutate_purchase_state: false,
  };
  const validatedResult = JSON.parse(JSON.stringify(validated)) as Record<string, unknown>;
  validatedResult.extraction_source = 'deterministic';
  validatedResult.parser_version = parsed.parserVersion;
  validatedResult.parser_reasons = parsed.reasons;
  validatedResult.link_only = true;
  validatedResult.would_create_purchase = false;
  validatedResult.would_mutate_purchase_state = false;
  if (parsed.shipmentPhase) validatedResult.shipment_phase = parsed.shipmentPhase;

  const { data: existing, error: existingError } = await db.from('source_emails')
    .select('id,validated_result,validation_status,processing_status')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) throw new Error(`Generic lifecycle source dedupe failed: ${existingError.message}`);

  const existingParser = existing?.validated_result && typeof existing.validated_result === 'object'
    ? (existing.validated_result as Record<string, unknown>).parser_version
    : null;
  const replaceFallback = existing
    ? canReplaceAiOffFallbackWithDeterministic({
        validatedResult: existing.validated_result,
        validationStatus: existing.validation_status,
        processingStatus: existing.processing_status,
      })
    : false;

  let sourceEmailId: string;
  if (existing && existingParser !== GENERIC_LIFECYCLE_PARSER_VERSION && !replaceFallback) {
    return {
      matched: true,
      sourceEmailId: existing.id as string,
      parserVersion: parsed.parserVersion,
      linkDecision: 'unmatched',
    };
  }

  if (existing) {
    sourceEmailId = existing.id as string;
    const { error: updateError } = await db.from('source_emails').update({
      classification: parsed.extraction.event_type,
      structured_result: structuredResult,
      validated_result: validatedResult,
      validation_status: 'review',
      validated_at: now,
      processed_at: now,
      processing_status: 'review',
    }).eq('id', sourceEmailId);
    if (updateError) throw new Error(`Generic lifecycle source update failed: ${updateError.message}`);
  } else {
    const { data: inserted, error: insertError } = await db.from('source_emails').insert({
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
      validation_status: 'review',
      validated_at: now,
      processed_at: now,
      processing_status: 'review',
    }).select('id').single();
    if (insertError || !inserted) {
      throw new Error(`Generic lifecycle source insert failed: ${insertError?.message ?? 'missing row'}`);
    }
    sourceEmailId = inserted.id as string;
  }

  const link = await linkGenericLifecycleSource({
    userId: connection.user_id as string,
    sourceEmailId,
    senderDomain: parsed.senderDomain,
    orderNumber: parsed.extraction.order_number,
    trackingNumber: parsed.extraction.tracking_number,
    confidence: parsed.extraction.confidence,
  });

  const linked = link.decision === 'linked_order_domain'
    || link.decision === 'linked_tracking'
    || link.decision === 'already_linked';
  validatedResult.generic_lifecycle_link_decision = link.decision;
  validatedResult.generic_lifecycle_link_reason = link.reason;
  if (link.purchaseId) validatedResult.linked_purchase_id = link.purchaseId;

  const { error: finalUpdateError } = await db.from('source_emails').update({
    validated_result: validatedResult,
    processing_status: linked ? 'processed' : 'review',
    processed_at: now,
  }).eq('id', sourceEmailId);
  if (finalUpdateError) throw new Error(`Generic lifecycle link result update failed: ${finalUpdateError.message}`);

  return {
    matched: true,
    sourceEmailId,
    parserVersion: parsed.parserVersion,
    linkDecision: link.decision,
    ...(link.purchaseId ? { linkedPurchaseId: link.purchaseId } : {}),
  };
}
