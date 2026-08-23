import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveBuyFlowEmailRecipient,
  type ResolvedBuyFlowRecipient,
} from '../email/buyflow-address.js';
import type {
  SesSecurityDisposition,
  SesSecuritySignals,
} from '../email/ses-inbound.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  normalizedEmailToDeterministicInput,
  parseNormalizedDeterministicEmail,
} from '../ingestion/normalized-email-deterministic.js';
import { isShadowOnlyParserVersion } from './automatic-write-gate.js';
import { evaluateShoppingEmailPurpose } from './shopping-email-purpose-gate.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

export type NormalizedInboundStatus =
  | 'unknown_recipient'
  | 'security_rejected'
  | 'quarantined'
  | 'non_commerce_ignored'
  | 'review'
  | 'recognized';

export interface NormalizedInboundSecurity {
  disposition: SesSecurityDisposition;
  signals?: SesSecuritySignals;
}

export interface NormalizedInboundPlan {
  status: Exclude<NormalizedInboundStatus, 'unknown_recipient'>;
  processingStatus: 'ignored' | 'review';
  classification: string | null;
  parserVersion: string | null;
  structuredResult: Record<string, unknown>;
  validatedResult: Record<string, unknown> | null;
  validationStatus: 'validated' | 'guardrailed' | 'review' | null;
}

export interface NormalizedInboundPersistResult {
  status: NormalizedInboundStatus;
  sourceEmailId?: string;
  recipient?: ResolvedBuyFlowRecipient;
  classification?: string | null;
  parserVersion?: string | null;
  deduped?: boolean;
  purchaseWrites: 0;
  shipmentWrites: 0;
  documentWrites: 0;
  aiCalls: 0;
}

function securitySnapshot(security: NormalizedInboundSecurity | undefined) {
  if (!security) return undefined;
  return {
    disposition: security.disposition,
    ...(security.signals ? {
      spam: security.signals.spam,
      virus: security.signals.virus,
      spf: security.signals.spf,
      dkim: security.signals.dkim,
      dmarc: security.signals.dmarc,
    } : {}),
  };
}

function baseDiagnostic(input: {
  email: NormalizedEmail;
  security?: NormalizedInboundSecurity;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    ingestion_source: 'normalized-inbound',
    provider: input.email.provider,
    shopping_email_purpose: 'shopping_only',
    ...(input.security ? { gateway_security: securitySnapshot(input.security) } : {}),
  };
}

export function planNormalizedInboundEmail(input: {
  email: NormalizedEmail;
  security?: NormalizedInboundSecurity;
}): NormalizedInboundPlan {
  const diagnostic = baseDiagnostic(input);

  if (input.security?.disposition === 'reject') {
    return {
      status: 'security_rejected',
      processingStatus: 'ignored',
      classification: 'security_rejected',
      parserVersion: null,
      structuredResult: {
        ...diagnostic,
        reason: 'gateway_security_reject',
      },
      validatedResult: null,
      validationStatus: null,
    };
  }

  if (input.security?.disposition === 'quarantine') {
    return {
      status: 'quarantined',
      processingStatus: 'review',
      classification: 'security_quarantine',
      parserVersion: null,
      structuredResult: {
        ...diagnostic,
        reason: 'gateway_security_quarantine',
      },
      validatedResult: null,
      validationStatus: 'review',
    };
  }

  const purpose = evaluateShoppingEmailPurpose(input.email);
  if (purpose.action === 'ignore') {
    return {
      status: 'non_commerce_ignored',
      processingStatus: 'ignored',
      classification: 'non_commerce',
      parserVersion: null,
      structuredResult: {
        ...diagnostic,
        reason: purpose.reason,
        stored: false,
      },
      validatedResult: null,
      validationStatus: null,
    };
  }

  const deterministicInput = normalizedEmailToDeterministicInput(input.email);
  const parsed = parseNormalizedDeterministicEmail(input.email);
  if (!parsed) {
    return {
      status: 'review',
      processingStatus: 'review',
      classification: null,
      parserVersion: null,
      structuredResult: {
        ...diagnostic,
        reason: 'no_deterministic_match',
      },
      validatedResult: null,
      validationStatus: 'review',
    };
  }

  const validated = validateEmailExtraction({
    extraction: parsed.extraction,
    senderDomains: deterministicInput.senderDomains,
    subject: deterministicInput.subject,
    bodyText: deterministicInput.bodyText,
  });

  const shadowOnly = isShadowOnlyParserVersion(parsed.parserVersion);
  if (shadowOnly) {
    validated.validation_status = 'review';
    validated.eligible_for_purchase_creation = false;
    validated.reasons = [
      ...new Set([
        ...validated.reasons,
        'normalized_inbound_shadow_only',
      ]),
    ];
  }

  const structuredResult: Record<string, unknown> = {
    schema_version: 2,
    ...parsed.extraction,
    ...(parsed.shipmentPhase ? { shipment_phase: parsed.shipmentPhase } : {}),
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
    ingestion_source: 'normalized-inbound',
    shopping_email_purpose: 'shopping_only',
    ...(input.security ? { gateway_security: securitySnapshot(input.security) } : {}),
    ...(shadowOnly ? { shadow_only: true, would_write: false } : {}),
  };

  const validatedResult = JSON.parse(JSON.stringify(validated)) as Record<string, unknown>;
  validatedResult.extraction_source = 'deterministic';
  validatedResult.parser_version = parsed.parserVersion;
  validatedResult.parser_reasons = parsed.reasons;
  validatedResult.ingestion_source = 'normalized-inbound';
  validatedResult.shopping_email_purpose = 'shopping_only';
  if (input.security) validatedResult.gateway_security = securitySnapshot(input.security);
  if (parsed.shipmentPhase) validatedResult.shipment_phase = parsed.shipmentPhase;
  if (shadowOnly) {
    validatedResult.shadow_only = true;
    validatedResult.would_write = false;
  }

  return {
    status: shadowOnly ? 'review' : 'recognized',
    processingStatus: 'review',
    classification: parsed.extraction.event_type,
    parserVersion: parsed.parserVersion,
    structuredResult,
    validatedResult,
    validationStatus: validated.validation_status,
  };
}

function sourceInsertPayload(input: {
  email: NormalizedEmail;
  recipient: ResolvedBuyFlowRecipient;
  plan: NormalizedInboundPlan;
  sourceQuery: string;
}) {
  const now = new Date().toISOString();
  return {
    user_id: input.recipient.userId,
    email_connection_id: input.recipient.emailConnectionId,
    provider_message_id: input.email.providerMessageId,
    provider_thread_id: input.email.providerThreadId ?? null,
    from_address: input.email.from[0]?.email ?? null,
    subject: input.email.subject ?? null,
    received_at: input.email.receivedAt,
    source_query: input.sourceQuery,
    classification: input.plan.classification,
    structured_result: input.plan.structuredResult,
    validated_result: input.plan.validatedResult,
    validation_status: input.plan.validationStatus,
    validated_at: input.plan.validatedResult ? now : null,
    processed_at: now,
    processing_status: input.plan.processingStatus,
  };
}

export async function persistNormalizedInboundEmail(input: {
  email: NormalizedEmail;
  recipientAddress: string;
  security?: NormalizedInboundSecurity;
  sourceQuery?: string;
  db?: any;
}): Promise<NormalizedInboundPersistResult> {
  const db = input.db ?? (getSupabaseAdmin() as any);
  const recipient = await resolveBuyFlowEmailRecipient({
    db,
    emailAddress: input.recipientAddress,
  });

  if (!recipient) {
    return {
      status: 'unknown_recipient',
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
      aiCalls: 0,
    };
  }

  const plan = planNormalizedInboundEmail({
    email: input.email,
    security: input.security,
  });

  // Strongly proven non-shopping mail is deliberately not persisted. The
  // BuyFlow address is a shopping inbox, not a general-purpose mailbox.
  // Unknown mail is NOT handled here: it remains REVIEW and is persisted.
  if (plan.status === 'non_commerce_ignored') {
    return {
      status: plan.status,
      recipient,
      classification: plan.classification,
      parserVersion: null,
      deduped: false,
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
      aiCalls: 0,
    };
  }

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,classification,processing_status,validated_result')
    .eq('email_connection_id', recipient.emailConnectionId)
    .eq('provider_message_id', input.email.providerMessageId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check normalized inbound dedupe: ${existingError.message}`);
  }

  if (existing) {
    return {
      status: existing.processing_status === 'ignored' ? 'security_rejected' : 'recognized',
      sourceEmailId: existing.id as string,
      recipient,
      classification: (existing.classification as string | null) ?? null,
      parserVersion: typeof existing.validated_result?.parser_version === 'string'
        ? existing.validated_result.parser_version
        : null,
      deduped: true,
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
      aiCalls: 0,
    };
  }

  const payload = sourceInsertPayload({
    email: input.email,
    recipient,
    plan,
    sourceQuery: input.sourceQuery ?? `normalized:${input.email.provider}`,
  });

  const { data: inserted, error: insertError } = await db
    .from('source_emails')
    .insert(payload)
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(`Failed to save normalized inbound source email: ${insertError?.message ?? 'missing row'}`);
  }

  return {
    status: plan.status,
    sourceEmailId: inserted.id as string,
    recipient,
    classification: plan.classification,
    parserVersion: plan.parserVersion,
    deduped: false,
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
    aiCalls: 0,
  };
}
