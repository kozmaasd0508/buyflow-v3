import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  processNylasMessage,
  type AutomationMode,
} from '../pipeline/automatic-email-pipeline.js';
import { materializeAuditBackfill } from './audit-backfill-materialization.js';

interface PendingAuditSourceRow {
  id: string;
  user_id: string;
  email_connection_id: string;
  provider_message_id: string;
}

interface AuditResultRow {
  source_email_id: string;
  ai_event_type: string | null;
  ai_validation_status: string | null;
  ai_error_code: string | null;
  ai_result: unknown;
  created_at: string;
}

interface EmailConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string | null;
  status: string;
}

export interface PendingAuditBackfillResult {
  scanned: number;
  materialized: number;
  ignored: number;
  review: number;
  routed: number;
  processed: number;
  unlinked: number;
  healed: number;
  invalid: number;
  failed: number;
  aiCalls: number;
  purchaseWrites: number;
  shipmentWrites: number;
  documentWrites: number;
}

async function healLinkedAuditSources(): Promise<number> {
  const db = getSupabaseAdmin() as any;
  const { data: candidates, error: candidateError } = await db
    .from('source_emails')
    .select('id')
    .eq('source_query', 'audit:full-inbox')
    .in('processing_status', ['review', 'unlinked'])
    .limit(1000);
  if (candidateError) throw new Error(`Pending audit healer source read failed: ${candidateError.message}`);

  const ids = (candidates ?? []).map((row: { id: string }) => row.id);
  if (ids.length === 0) return 0;

  const { data: links, error: linkError } = await db
    .from('purchase_sources')
    .select('source_email_id')
    .in('source_email_id', ids);
  if (linkError) throw new Error(`Pending audit healer link read failed: ${linkError.message}`);

  const linkedIds = [...new Set(
    (links ?? [])
      .map((row: { source_email_id: string | null }) => row.source_email_id)
      .filter((id: string | null): id is string => Boolean(id)),
  )];
  if (linkedIds.length === 0) return 0;

  const { error: updateError } = await db
    .from('source_emails')
    .update({ processing_status: 'processed' })
    .in('id', linkedIds);
  if (updateError) throw new Error(`Pending audit healer status update failed: ${updateError.message}`);
  return linkedIds.length;
}

export async function drainPendingAuditBackfillV1(
  mode: AutomationMode,
  limit = 150,
): Promise<PendingAuditBackfillResult> {
  const db = getSupabaseAdmin() as any;
  const result: PendingAuditBackfillResult = {
    scanned: 0,
    materialized: 0,
    ignored: 0,
    review: 0,
    routed: 0,
    processed: 0,
    unlinked: 0,
    healed: 0,
    invalid: 0,
    failed: 0,
    aiCalls: 0,
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
  };

  const { data: sourceData, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,email_connection_id,provider_message_id')
    .eq('source_query', 'audit:full-inbox')
    .eq('processing_status', 'pending')
    .is('validated_result', null)
    .order('received_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (sourceError) throw new Error(`Pending audit backfill source read failed: ${sourceError.message}`);

  const sources = (sourceData ?? []) as PendingAuditSourceRow[];
  result.scanned = sources.length;
  if (sources.length === 0) {
    result.healed = await healLinkedAuditSources();
    return result;
  }

  const sourceIds = sources.map((row) => row.id);
  const { data: auditData, error: auditError } = await db
    .from('email_audit_results')
    .select('source_email_id,ai_event_type,ai_validation_status,ai_error_code,ai_result,created_at')
    .in('source_email_id', sourceIds)
    .order('created_at', { ascending: false });
  if (auditError) throw new Error(`Pending audit backfill audit read failed: ${auditError.message}`);

  const latestAuditBySource = new Map<string, AuditResultRow>();
  for (const row of (auditData ?? []) as AuditResultRow[]) {
    if (!latestAuditBySource.has(row.source_email_id)) {
      latestAuditBySource.set(row.source_email_id, row);
    }
  }

  const connectionIds = [...new Set(sources.map((row) => row.email_connection_id))];
  const { data: connectionData, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider,provider_account_id,status')
    .in('id', connectionIds);
  if (connectionError) throw new Error(`Pending audit backfill connection read failed: ${connectionError.message}`);
  const connections = new Map(
    ((connectionData ?? []) as EmailConnectionRow[]).map((row) => [row.id, row]),
  );

  for (const source of sources) {
    const audit = latestAuditBySource.get(source.id);
    if (!audit) {
      result.invalid += 1;
      continue;
    }

    const materialized = materializeAuditBackfill({
      aiEventType: audit.ai_event_type,
      aiValidationStatus: audit.ai_validation_status,
      aiErrorCode: audit.ai_error_code,
      aiResult: audit.ai_result,
    });
    if (!materialized) {
      result.invalid += 1;
      const { error } = await db
        .from('source_emails')
        .update({ processing_status: 'review' })
        .eq('id', source.id)
        .eq('processing_status', 'pending');
      if (error) result.failed += 1;
      continue;
    }

    const now = new Date().toISOString();
    const { error: materializeError } = await db
      .from('source_emails')
      .update({
        classification: materialized.classification,
        structured_result: materialized.structuredResult,
        validated_result: materialized.validatedResult,
        validation_status: materialized.validationStatus,
        validated_at: audit.created_at || now,
        processed_at: now,
        processing_status: materialized.initialStatus,
      })
      .eq('id', source.id)
      .eq('processing_status', 'pending');
    if (materializeError) {
      result.failed += 1;
      continue;
    }

    result.materialized += 1;
    if (materialized.initialStatus === 'ignored') {
      result.ignored += 1;
      continue;
    }
    if (materialized.initialStatus === 'review') {
      result.review += 1;
      continue;
    }

    const connection = connections.get(source.email_connection_id);
    if (
      !connection ||
      connection.user_id !== source.user_id ||
      connection.provider !== 'nylas' ||
      connection.status !== 'active' ||
      !connection.provider_account_id
    ) {
      result.failed += 1;
      continue;
    }

    try {
      const pipeline = await processNylasMessage({
        grantId: connection.provider_account_id,
        messageId: source.provider_message_id,
        mode,
      });
      result.routed += 1;
      result.aiCalls += pipeline.aiCalls;
      result.purchaseWrites += pipeline.purchaseWrites;
      result.shipmentWrites += pipeline.shipmentWrites;
      result.documentWrites += pipeline.documentWrites;
      if (pipeline.status === 'processed') result.processed += 1;
      else if (pipeline.status === 'unlinked') result.unlinked += 1;
      else if (pipeline.status === 'ignored') result.ignored += 1;
      else result.review += 1;
    } catch {
      result.failed += 1;
      // Leave the already materialized V2 result in place. The normal pipeline can
      // safely retry it without another AI extraction because validated_result exists.
    }
  }

  result.healed = await healLinkedAuditSources();
  return result;
}
