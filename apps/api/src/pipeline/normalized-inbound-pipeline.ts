import { env, requireEmailSourceArchiveRetentionConfig } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveBuyFlowEmailRecipient,
  type ResolvedBuyFlowRecipient,
} from '../email/buyflow-address.js';
import {
  mailLensSemanticEmailV1,
  normalizeEmailDocumentV1,
} from '../email/normalize-document-v1.js';
import type {
  SesSecurityDisposition,
  SesSecuritySignals,
} from '../email/ses-inbound.js';
import {
  prepareNormalizedEmailSourceV1,
  sha256EmailArchiveBytes,
  SupabaseEmailArchiveObjectStore,
  writePreparedEmailSourceArchiveV1,
  type ArchivedEmailSourceV1,
  type EmailArchiveObjectStore,
  type RawEmailSourceV1,
} from '../email/source-archive-v1.js';
import {
  assertExistingArchivedRawMatches,
  markEmailSourceArchiveCommitted,
  stageEmailSourceArchiveManifest,
} from '../email/source-archive-manifest.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  normalizedEmailToDeterministicInput,
  parseNormalizedDeterministicEmail,
} from '../ingestion/normalized-email-deterministic.js';
import { runShoppingEmailIdentityShadow } from '../purchase-identity-v2/shopping-email-shadow-runtime.js';
import { isShadowOnlyParserVersion } from './automatic-write-gate.js';
import { evaluateShoppingEmailPurpose } from './shopping-email-purpose-gate.js';
import { runUniversalCommerceGrammarShadow } from './universal-commerce-grammar-shadow.js';
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
  sourceArchived?: boolean;
  traceId?: string;
  purchaseWrites: 0;
  shipmentWrites: 0;
  documentWrites: 0;
  aiCalls: 0;
}

export interface EmailSourceArchiveRetentionDays {
  rawDays: number;
  normalizedDays: number;
}

export interface PersistResolvedNormalizedEmailInput {
  email: NormalizedEmail;
  recipient: ResolvedBuyFlowRecipient;
  security?: NormalizedInboundSecurity;
  sourceQuery?: string;
  rawSource?: RawEmailSourceV1;
  sourceArchiveStore?: EmailArchiveObjectStore;
  sourceArchiveEnabled?: boolean;
  sourceArchiveRetentionDays?: EmailSourceArchiveRetentionDays;
  db?: any;
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

  // MailLens is the canonical representation boundary for all semantic stages.
  // Raw provider HTML/body remains available in the archived document, while
  // downstream legacy consumers receive only the bounded current semantic view.
  const mailLens = normalizeEmailDocumentV1(input.email);
  const semanticEmail = mailLensSemanticEmailV1(input.email);
  const mailLensDiagnostic = {
    normalizer_version: mailLens.normalizerVersion,
    body_text_source: mailLens.normalization.bodyTextSource,
    body_text_truncated: mailLens.normalization.bodyTextTruncated,
    semantic_text_truncated: mailLens.normalization.semanticTextTruncated,
    hidden_html_removed: mailLens.normalization.hiddenHtmlRemoved,
    quoted_history_detected: mailLens.normalization.quotedHistoryDetected,
  };

  const purpose = evaluateShoppingEmailPurpose(semanticEmail);
  if (purpose.action === 'ignore') {
    return {
      status: 'non_commerce_ignored',
      processingStatus: 'ignored',
      classification: 'non_commerce',
      parserVersion: null,
      structuredResult: {
        ...diagnostic,
        mail_lens: mailLensDiagnostic,
        reason: purpose.reason,
        stored: false,
      },
      validatedResult: null,
      validationStatus: null,
    };
  }

  const universalGrammarShadow = runUniversalCommerceGrammarShadow(semanticEmail);
  const deterministicInput = normalizedEmailToDeterministicInput(semanticEmail);
  const parsed = parseNormalizedDeterministicEmail(semanticEmail);
  if (!parsed) {
    return {
      status: 'review',
      processingStatus: 'review',
      classification: null,
      parserVersion: null,
      structuredResult: {
        ...diagnostic,
        mail_lens: mailLensDiagnostic,
        reason: 'no_deterministic_match',
        universal_commerce_grammar_shadow: universalGrammarShadow,
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
    mail_lens: mailLensDiagnostic,
    universal_commerce_grammar_shadow: universalGrammarShadow,
    ...(input.security ? { gateway_security: securitySnapshot(input.security) } : {}),
    ...(shadowOnly ? { shadow_only: true, would_write: false } : {}),
  };

  const validatedResult = JSON.parse(JSON.stringify(validated)) as Record<string, unknown>;
  validatedResult.extraction_source = 'deterministic';
  validatedResult.parser_version = parsed.parserVersion;
  validatedResult.parser_reasons = parsed.reasons;
  validatedResult.ingestion_source = 'normalized-inbound';
  validatedResult.shopping_email_purpose = 'shopping_only';
  validatedResult.mail_lens = mailLensDiagnostic;
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

function sourceArchiveDiagnostic(source: ArchivedEmailSourceV1) {
  return {
    schema_version: 1,
    archived: true,
    raw_archived: Boolean(source.rawRef),
    normalizer_version: source.document.normalizerVersion,
    structured_data_records: source.document.structuredData.length,
    links: source.document.links.length,
    authentication: {
      dkim: source.document.authentication.dkim,
      spf: source.document.authentication.spf,
      dmarc: source.document.authentication.dmarc,
      trusted: source.document.authentication.trusted,
      source: source.document.authentication.source,
    },
  };
}

function sourceInsertPayload(input: {
  email: NormalizedEmail;
  recipient: ResolvedBuyFlowRecipient;
  plan: NormalizedInboundPlan;
  sourceQuery: string;
  archivedSource?: ArchivedEmailSourceV1 | null;
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
    ...(input.archivedSource ? {
      archive_manifest_id: input.archivedSource.traceId,
      raw_object_key: input.archivedSource.rawRef?.objectKey ?? null,
      raw_sha256: input.archivedSource.rawRef?.sha256 ?? null,
      raw_size_bytes: input.archivedSource.rawRef?.sizeBytes ?? null,
      raw_content_type: input.archivedSource.rawRef?.contentType ?? null,
      raw_retention_until: input.archivedSource.rawRef?.retainedUntil ?? null,
      normalized_object_key: input.archivedSource.normalizedRef.objectKey,
      normalized_sha256: input.archivedSource.normalizedRef.sha256,
      normalized_size_bytes: input.archivedSource.normalizedRef.sizeBytes,
      normalized_content_type: input.archivedSource.normalizedRef.contentType,
      normalized_retention_until: input.archivedSource.normalizedRef.retainedUntil,
      normalizer_version: input.archivedSource.document.normalizerVersion,
      trace_id: input.archivedSource.traceId,
    } : {}),
  };
}

function retentionBoundary(days: number, nowMs: number): string {
  if (!Number.isInteger(days) || days <= 0 || days > 3650) {
    throw new Error('Email source archive retention days must be an integer between 1 and 3650');
  }
  return new Date(nowMs + days * 24 * 60 * 60_000).toISOString();
}

/**
 * Persist a normalized message for a connection whose ownership has already
 * been authenticated by the caller (for example a direct Gmail connection).
 * This does not grant Purchase/Shipment/Document or AI write authority.
 */
export async function persistNormalizedEmailForResolvedRecipient(
  input: PersistResolvedNormalizedEmailInput,
): Promise<NormalizedInboundPersistResult> {
  const db = input.db ?? (getSupabaseAdmin() as any);
  const recipient = input.recipient;
  const plan = planNormalizedInboundEmail({
    email: input.email,
    security: input.security,
  });

  // Strongly proven non-shopping mail is deliberately not persisted or archived.
  // Unknown mail is NOT dropped: it remains REVIEW and is persisted.
  if (plan.status === 'non_commerce_ignored') {
    return {
      status: plan.status,
      recipient,
      classification: plan.classification,
      parserVersion: null,
      deduped: false,
      sourceArchived: false,
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
      aiCalls: 0,
    };
  }

  const sourceArchiveEnabled = input.sourceArchiveEnabled
    ?? env.BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED;

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,classification,processing_status,validated_result,raw_sha256,normalized_sha256,archive_manifest_id,trace_id')
    .eq('email_connection_id', recipient.emailConnectionId)
    .eq('provider_message_id', input.email.providerMessageId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check normalized inbound dedupe: ${existingError.message}`);
  }

  if (existing) {
    if (sourceArchiveEnabled && input.rawSource) {
      const incomingBytes = Buffer.from(input.rawSource.bytes);
      if (incomingBytes.byteLength === 0) {
        throw new Error('Raw email source cannot be empty');
      }
      assertExistingArchivedRawMatches({
        existingRawSha256: existing.raw_sha256,
        incomingRawSha256: sha256EmailArchiveBytes(incomingBytes),
      });
    }
    return {
      status: existing.processing_status === 'ignored' ? 'security_rejected' : 'recognized',
      sourceEmailId: existing.id as string,
      recipient,
      classification: (existing.classification as string | null) ?? null,
      parserVersion: typeof existing.validated_result?.parser_version === 'string'
        ? existing.validated_result.parser_version
        : null,
      deduped: true,
      sourceArchived: Boolean(existing.archive_manifest_id || existing.raw_sha256 || existing.normalized_sha256),
      ...(typeof existing.trace_id === 'string' ? { traceId: existing.trace_id } : {}),
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
      aiCalls: 0,
    };
  }

  let archivedSource: ArchivedEmailSourceV1 | null = null;
  if (sourceArchiveEnabled) {
    const retention = input.sourceArchiveRetentionDays
      ?? requireEmailSourceArchiveRetentionConfig();
    const nowMs = Date.now();
    const rawRetainedUntil = retentionBoundary(retention.rawDays, nowMs);
    const normalizedRetainedUntil = retentionBoundary(retention.normalizedDays, nowMs);
    const store = input.sourceArchiveStore
      ?? new SupabaseEmailArchiveObjectStore(
        db,
        env.BUYFLOW_EMAIL_SOURCE_ARCHIVE_BUCKET,
      );
    const prepared = prepareNormalizedEmailSourceV1({
      userId: recipient.userId,
      emailConnectionId: recipient.emailConnectionId,
      email: input.email,
      normalizedRetainedUntil,
      nowMs,
      ...(input.rawSource ? {
        rawSource: {
          ...input.rawSource,
          retainedUntil: rawRetainedUntil,
        },
      } : {}),
    });

    // Durable two-phase boundary: the opaque manifest exists before any object
    // write. A crash or DB failure therefore leaves recoverable cleanup state.
    await stageEmailSourceArchiveManifest({ db, prepared });
    archivedSource = await writePreparedEmailSourceArchiveV1({ prepared, store });
    plan.structuredResult.modern_email_source_v1 = sourceArchiveDiagnostic(archivedSource);
  }

  // Purchase Identity Graph is diagnostic-only in this lane. It may read the
  // user's snapshot but cannot write purchases, shipments, documents or graph rows.
  if (plan.status === 'review' || plan.status === 'recognized') {
    const semanticEmail = mailLensSemanticEmailV1(input.email);
    plan.structuredResult.purchase_identity_shadow_v2 = await runShoppingEmailIdentityShadow({
      db,
      userId: recipient.userId,
      email: semanticEmail,
    });
  }

  const payload = sourceInsertPayload({
    email: input.email,
    recipient,
    plan,
    sourceQuery: input.sourceQuery ?? `normalized:${input.email.provider}`,
    archivedSource,
  });

  const { data: inserted, error: insertError } = await db
    .from('source_emails')
    .insert(payload)
    .select('id')
    .single();
  if (insertError || !inserted) {
    // Do not attempt ad-hoc object deletion here: the durable pending manifest is
    // the crash-safe cleanup/retry journal and will be reconciled separately.
    throw new Error(`Failed to save normalized inbound source email: ${insertError?.message ?? 'missing row'}`);
  }

  if (archivedSource) {
    await markEmailSourceArchiveCommitted({ db, source: archivedSource });
  }

  return {
    status: plan.status,
    sourceEmailId: inserted.id as string,
    recipient,
    classification: plan.classification,
    parserVersion: plan.parserVersion,
    deduped: false,
    sourceArchived: Boolean(archivedSource),
    ...(archivedSource ? { traceId: archivedSource.traceId } : {}),
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
    aiCalls: 0,
  };
}

export async function persistNormalizedInboundEmail(input: {
  email: NormalizedEmail;
  recipientAddress: string;
  security?: NormalizedInboundSecurity;
  sourceQuery?: string;
  rawSource?: RawEmailSourceV1;
  sourceArchiveStore?: EmailArchiveObjectStore;
  sourceArchiveEnabled?: boolean;
  sourceArchiveRetentionDays?: EmailSourceArchiveRetentionDays;
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

  return persistNormalizedEmailForResolvedRecipient({
    email: input.email,
    recipient,
    ...(input.security ? { security: input.security } : {}),
    ...(input.sourceQuery ? { sourceQuery: input.sourceQuery } : {}),
    ...(input.rawSource ? { rawSource: input.rawSource } : {}),
    ...(input.sourceArchiveStore ? { sourceArchiveStore: input.sourceArchiveStore } : {}),
    ...(input.sourceArchiveEnabled !== undefined
      ? { sourceArchiveEnabled: input.sourceArchiveEnabled }
      : {}),
    ...(input.sourceArchiveRetentionDays
      ? { sourceArchiveRetentionDays: input.sourceArchiveRetentionDays }
      : {}),
    db,
  });
}
