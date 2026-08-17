import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';
import { canReplaceAiOffFallbackWithDeterministic } from './deterministic-commerce-parser.js';
import {
  GENERIC_LIFECYCLE_PARSER_VERSION,
  parseGenericLifecycleObservations,
  type GenericLifecycleParseResult,
} from './generic-lifecycle-adapter.js';
import {
  linkGenericLifecycleSource,
  type GenericLifecycleLinkDecision,
} from './generic-lifecycle-linker.js';

const BODY_MAX_CHARS = 80_000;
const GENERIC_LIFECYCLE_VERSION_PATTERN = /^generic-lifecycle-v\d+(?:\.\d+)*$/;

export interface GenericLifecyclePreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  parserVersion?: string;
  linkDecision?: GenericLifecycleLinkDecision;
  linkedPurchaseId?: string;
  observationCount?: number;
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(from
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@')))];
}

function reviewValidation(input: {
  parsed: GenericLifecycleParseResult;
  domains: string[];
  subject?: string | null;
  bodyText: string;
}): Record<string, unknown> {
  const validated = validateEmailExtraction({
    extraction: input.parsed.extraction,
    senderDomains: input.domains,
    subject: input.subject,
    bodyText: input.bodyText,
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
  const result = JSON.parse(JSON.stringify(validated)) as Record<string, unknown>;
  result.extraction_source = 'deterministic';
  result.parser_version = input.parsed.parserVersion;
  result.parser_reasons = input.parsed.reasons;
  result.link_only = true;
  result.would_create_purchase = false;
  result.would_mutate_purchase_state = false;
  result.would_mutate_shipment_state = false;
  result.would_create_document = false;
  if (input.parsed.shipmentPhase) result.shipment_phase = input.parsed.shipmentPhase;
  return result;
}

function observationPayload(parsed: GenericLifecycleParseResult): Record<string, unknown> {
  return {
    schema_version: 1,
    ...parsed.extraction,
    ...(parsed.shipmentPhase ? { shipment_phase: parsed.shipmentPhase } : {}),
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
    validation_status: 'review',
    link_only: true,
    would_create_purchase: false,
    would_mutate_purchase_state: false,
    would_mutate_shipment_state: false,
    would_create_document: false,
  };
}

export function buildGenericLifecycleValidatedEnvelope(
  validatedObservations: Array<Record<string, unknown>>,
): Record<string, unknown> {
  if (validatedObservations.length === 0) {
    throw new Error('Generic lifecycle validated envelope requires at least one observation');
  }
  const result: Record<string, unknown> = { ...validatedObservations[0]! };
  result.generic_lifecycle_observations = validatedObservations;
  result.generic_lifecycle_observation_count = validatedObservations.length;
  result.generic_lifecycle_multi_observation = validatedObservations.length > 1;
  return result;
}

function canReplacePriorGenericLifecycle(existing: {
  parserVersion: unknown;
  validationStatus: unknown;
}): boolean {
  return typeof existing.parserVersion === 'string'
    && GENERIC_LIFECYCLE_VERSION_PATTERN.test(existing.parserVersion)
    && existing.validationStatus === 'review';
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
  const observations = parseGenericLifecycleObservations({ senderDomains: domains, subject: email.subject, bodyText });
  if (observations.length === 0) return { matched: false };

  const parsed = observations[0]!;
  const validatedObservations = observations.map((observation) => reviewValidation({ parsed: observation, domains, subject: email.subject, bodyText }));
  const validatedResult = buildGenericLifecycleValidatedEnvelope(validatedObservations);

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
    would_mutate_shipment_state: false,
    would_create_document: false,
    generic_lifecycle_observations: observations.map(observationPayload),
    generic_lifecycle_observation_count: observations.length,
    generic_lifecycle_multi_observation: observations.length > 1,
  };

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await db.from('source_emails')
    .select('id,validated_result,validation_status,processing_status')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) throw new Error(`Generic lifecycle source dedupe failed: ${existingError.message}`);

  const existingParser = existing?.validated_result && typeof existing.validated_result === 'object'
    ? (existing.validated_result as Record<string, unknown>).parser_version
    : null;
  const replaceFallback = existing ? canReplaceAiOffFallbackWithDeterministic({
    validatedResult: existing.validated_result,
    validationStatus: existing.validation_status,
    processingStatus: existing.processing_status,
  }) : false;
  const replacePriorGeneric = existing ? canReplacePriorGenericLifecycle({
    parserVersion: existingParser,
    validationStatus: existing.validation_status,
  }) : false;

  let sourceEmailId: string;
  if (existing && existingParser !== GENERIC_LIFECYCLE_PARSER_VERSION && !replaceFallback && !replacePriorGeneric) {
    return {
      matched: true,
      sourceEmailId: existing.id as string,
      parserVersion: parsed.parserVersion,
      linkDecision: 'unmatched',
      observationCount: observations.length,
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
    if (insertError || !inserted) throw new Error(`Generic lifecycle source insert failed: ${insertError?.message ?? 'missing row'}`);
    sourceEmailId = inserted.id as string;
  }

  const orderNumber = observations.map((observation) => observation.extraction.order_number)
    .find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
  const trackingNumber = observations.map((observation) => observation.extraction.tracking_number)
    .find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
  const confidence = Math.max(...observations.map((observation) => observation.extraction.confidence));

  const link = await linkGenericLifecycleSource({
    userId: connection.user_id as string,
    sourceEmailId,
    senderDomain: parsed.senderDomain,
    orderNumber,
    trackingNumber,
    confidence,
  });

  const linked = link.decision === 'linked_order_domain' || link.decision === 'linked_tracking' || link.decision === 'already_linked';
  validatedResult.generic_lifecycle_link_decision = link.decision;
  validatedResult.generic_lifecycle_link_reason = link.reason;
  if (link.purchaseId) validatedResult.linked_purchase_id = link.purchaseId;
  for (const observation of validatedObservations) {
    observation.generic_lifecycle_link_decision = link.decision;
    observation.generic_lifecycle_link_reason = link.reason;
    if (link.purchaseId) observation.linked_purchase_id = link.purchaseId;
  }

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
    observationCount: observations.length,
    ...(link.purchaseId ? { linkedPurchaseId: link.purchaseId } : {}),
  };
}
