import type { Json } from '../db/database.types.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { filterCommerceEmail } from '../ingestion/commerce-email-filter.js';
import {
  extractEmailWithOpenAIResult,
  htmlToCompactText,
  type EmailExtraction,
} from '../ai/openai-email-extractor.js';
import { requireOpenAIConfig } from '../config.js';
import {
  validateEmailExtraction,
  isCarrierSenderDomain,
  type ValidatedEmailExtraction,
} from '../validation/email-extraction-validator.js';
import {
  resolvePurchaseCandidates,
  type ResolutionEvidence,
  type ResolutionEventType,
} from '../resolution/purchase-resolution.js';
import {
  resolveShipmentCandidates,
  type ShipmentPurchaseIdentity,
  type ShipmentResolutionEvidence,
} from '../resolution/shipment-resolution.js';
import {
  resolveDocumentCandidates,
  type DocumentPurchaseIdentity,
  type DocumentResolutionEvidence,
} from '../resolution/document-resolution.js';
import {
  canAutomaticallyWriteDocument,
  canAutomaticallyWritePurchase,
  canAutomaticallyWriteShipment,
  isTrustedAutomaticEvidence,
} from './automatic-write-gate.js';

const PROMPT_VERSION = 'nano-email-extraction-v1';
const RECONCILIATION_WINDOW_DAYS = 45;

export type AutomationMode = 'observe' | 'write';

export interface AutomaticPipelineResult {
  ok: boolean;
  status:
    | 'ignored'
    | 'already_processing'
    | 'processed'
    | 'review'
    | 'unknown_grant';
  sourceEmailId?: string;
  purchaseWrites: number;
  shipmentWrites: number;
  documentWrites: number;
  aiCalls: number;
}

interface SourceRow {
  id: string;
  user_id: string;
  provider_message_id: string;
  from_address: string | null;
  received_at: string;
  processing_status: string;
  validation_status: string | null;
  structured_result: Record<string, unknown> | null;
  validated_result: Record<string, unknown> | null;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_domain: string | null;
  order_number: string | null;
  current_state: string;
}

const ALLOWED_EVENT_TYPES = new Set<ResolutionEventType>([
  'order_created',
  'order_updated',
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'subscription',
  'refund',
  'return',
  'other',
]);

function senderDomain(fromAddress: string | null): string {
  if (!fromAddress) return '';
  const match = fromAddress.toLowerCase().match(/@([^>\s,;]+)/);
  return (match?.[1] ?? '').replace(/[)>]+$/, '').trim();
}

function senderDomains(email: NormalizedEmail): string[] {
  return [...new Set(
    email.from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractionToJson(extraction: EmailExtraction): Json {
  return {
    event_type: extraction.event_type,
    merchant: extraction.merchant,
    order_number: extraction.order_number,
    tracking_number: extraction.tracking_number,
    carrier: extraction.carrier,
    invoice_number: extraction.invoice_number,
    total: extraction.total,
    currency: extraction.currency,
    confidence: extraction.confidence,
  };
}

function toJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function toPurchaseEvidence(row: SourceRow): ResolutionEvidence | null {
  const result = row.validated_result;
  if (!result || !isTrustedAutomaticEvidence(row.validation_status, result)) return null;
  const eventType = result.event_type;
  const confidence = numberOrNull(result.confidence);
  if (
    typeof eventType !== 'string' ||
    !ALLOWED_EVENT_TYPES.has(eventType as ResolutionEventType) ||
    confidence === null
  ) return null;

  return {
    sourceEmailId: row.id,
    userId: row.user_id,
    senderDomain: senderDomain(row.from_address),
    eventType: eventType as ResolutionEventType,
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    confidence,
    receivedAt: row.received_at,
  };
}

function toShipmentEvidence(row: SourceRow): ShipmentResolutionEvidence | null {
  const result = row.validated_result;
  if (
    !result ||
    !isTrustedAutomaticEvidence(row.validation_status, result) ||
    (result.event_type !== 'shipment' && result.event_type !== 'delivery')
  ) return null;
  const confidence = numberOrNull(result.confidence);
  if (confidence === null) return null;
  return {
    sourceEmailId: row.id,
    userId: row.user_id,
    senderDomain: senderDomain(row.from_address),
    eventType: result.event_type,
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    trackingNumber: stringOrNull(result.tracking_number),
    carrier: stringOrNull(result.carrier),
    confidence,
    receivedAt: row.received_at,
  };
}

function toDocumentEvidence(row: SourceRow): DocumentResolutionEvidence | null {
  const result = row.validated_result;
  if (
    !result ||
    !isTrustedAutomaticEvidence(row.validation_status, result) ||
    result.event_type !== 'invoice_or_receipt'
  ) return null;
  const confidence = numberOrNull(result.confidence);
  if (confidence === null) return null;
  return {
    sourceEmailId: row.id,
    userId: row.user_id,
    senderDomain: senderDomain(row.from_address),
    eventType: 'invoice_or_receipt',
    orderNumber: stringOrNull(result.order_number),
    invoiceNumber: stringOrNull(result.invoice_number),
    confidence,
    receivedAt: row.received_at,
  };
}

function canonicalCarrierName(slug: string): string {
  const known: Record<string, string> = {
    'express-one': 'Express One',
    dpd: 'DPD',
    gls: 'GLS',
    foxpost: 'Foxpost',
    packeta: 'Packeta',
  };
  return known[slug] ?? slug;
}

function earliest(rows: ShipmentResolutionEvidence[]): string | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]?.receivedAt ?? null;
}

function latest(rows: ShipmentResolutionEvidence[]): string | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]?.receivedAt ?? null;
}

async function reconcileUser(userId: string, mode: AutomationMode) {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;
  const cutoff = new Date(Date.now() - RECONCILIATION_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: sourceRows, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,provider_message_id,from_address,received_at,processing_status,validation_status,structured_result,validated_result')
    .eq('user_id', userId)
    .not('validated_result', 'is', null)
    .gte('received_at', cutoff)
    .order('received_at', { ascending: true });
  if (sourceError) throw new Error(`Failed to load reconciliation evidence: ${sourceError.message}`);

  const rows = (sourceRows ?? []) as SourceRow[];
  const purchaseEvidence = rows
    .map(toPurchaseEvidence)
    .filter((row: ResolutionEvidence | null): row is ResolutionEvidence => Boolean(row));

  let purchaseWrites = 0;
  let shipmentWrites = 0;
  let documentWrites = 0;

  if (mode === 'write') {
    for (const candidate of resolvePurchaseCandidates(purchaseEvidence)) {
      if (!canAutomaticallyWritePurchase(candidate)) continue;

      const evidence = purchaseEvidence.filter((row) => candidate.sourceEmailIds.includes(row.sourceEmailId));
      const primary = evidence
        .filter((row) => row.eventType === 'order_created')
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (!primary) continue;

      const { data: before } = await db
        .from('purchases')
        .select('id')
        .eq('user_id', candidate.userId)
        .eq('merchant_domain', candidate.senderDomain)
        .eq('order_number', candidate.orderNumber)
        .limit(1);
      const existed = Array.isArray(before) && before.length > 0;

      const { error } = await db.rpc('controlled_create_purchase_with_sources', {
        p_user_id: candidate.userId,
        p_merchant_name: candidate.merchant,
        p_merchant_domain: candidate.senderDomain,
        p_order_number: candidate.orderNumber,
        p_ordered_at: primary.receivedAt,
        p_confidence: candidate.confidence,
        p_sources: evidence.map((row) => ({
          source_email_id: row.sourceEmailId,
          relation_type: row.eventType,
          confidence: row.confidence,
        })),
      });
      if (error) throw new Error(`Automatic purchase reconciliation failed: ${error.message}`);
      if (!existed) purchaseWrites += 1;
    }
  }

  const { data: purchaseRows, error: purchaseError } = await db
    .from('purchases')
    .select('id,user_id,merchant_domain,order_number,current_state')
    .eq('user_id', userId);
  if (purchaseError) throw new Error(`Failed to load purchases: ${purchaseError.message}`);
  const rawPurchases = (purchaseRows ?? []) as PurchaseRow[];

  const shipmentPurchases: ShipmentPurchaseIdentity[] = rawPurchases.map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
  }));
  const shipmentEvidence = rows
    .map(toShipmentEvidence)
    .filter((row: ShipmentResolutionEvidence | null): row is ShipmentResolutionEvidence => Boolean(row));

  if (mode === 'write') {
    for (const candidate of resolveShipmentCandidates(shipmentPurchases, shipmentEvidence)) {
      if (!canAutomaticallyWriteShipment(candidate)) continue;

      const evidence = shipmentEvidence.filter((row) => candidate.sourceEmailIds.includes(row.sourceEmailId));
      const merchantAnchor = evidence.find(
        (row) => !isCarrierSenderDomain(row.senderDomain) && Boolean(row.orderNumber),
      );
      if (!merchantAnchor) continue;

      const shippedAt = earliest(evidence.filter((row) => row.eventType === 'shipment'));
      const deliveredAt = earliest(evidence.filter((row) => row.eventType === 'delivery'));
      const lastEventAt = latest(evidence);
      if (!shippedAt || !lastEventAt) continue;
      if (candidate.recommendedStatus === 'delivered' && !deliveredAt) continue;

      const { data: before } = await db
        .from('shipments')
        .select('id')
        .eq('user_id', candidate.userId)
        .eq('carrier_slug', candidate.carrierSlug)
        .eq('tracking_number', candidate.trackingNumber)
        .limit(1);
      const existed = Array.isArray(before) && before.length > 0;

      const { error } = await db.rpc('controlled_upsert_shipment_with_sources', {
        p_user_id: candidate.userId,
        p_purchase_id: candidate.purchaseId,
        p_carrier: canonicalCarrierName(candidate.carrierSlug),
        p_carrier_slug: candidate.carrierSlug,
        p_tracking_number: candidate.trackingNumber,
        p_status: candidate.recommendedStatus,
        p_shipped_at: shippedAt,
        p_delivered_at: deliveredAt,
        p_last_event_at: lastEventAt,
        p_source_email_id: merchantAnchor.sourceEmailId,
        p_confidence: candidate.confidence,
        p_sources: evidence.map((row) => ({
          source_email_id: row.sourceEmailId,
          confidence: row.confidence,
        })),
      });
      if (error) throw new Error(`Automatic shipment reconciliation failed: ${error.message}`);
      if (!existed) shipmentWrites += 1;
    }
  }

  const documentPurchases: DocumentPurchaseIdentity[] = rawPurchases.map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
  }));
  const documentEvidence = rows
    .map(toDocumentEvidence)
    .filter((row: DocumentResolutionEvidence | null): row is DocumentResolutionEvidence => Boolean(row));

  if (mode === 'write') {
    for (const candidate of resolveDocumentCandidates(documentPurchases, documentEvidence)) {
      if (!canAutomaticallyWriteDocument(candidate)) continue;

      const evidence = documentEvidence.find((row) => row.sourceEmailId === candidate.sourceEmailId);
      const source = rows.find((row) => row.id === candidate.sourceEmailId);
      if (!evidence?.invoiceNumber || !source?.provider_message_id) continue;

      const { data: before } = await db
        .from('documents')
        .select('id')
        .eq('purchase_id', candidate.purchaseId)
        .eq('type', 'invoice')
        .eq('document_number', evidence.invoiceNumber)
        .limit(1);
      const existed = Array.isArray(before) && before.length > 0;

      const { error } = await db.rpc('controlled_upsert_document_with_source', {
        p_user_id: candidate.userId,
        p_purchase_id: candidate.purchaseId,
        p_source_email_id: candidate.sourceEmailId,
        p_document_type: 'invoice',
        p_document_number: evidence.invoiceNumber,
        p_issued_at: evidence.receivedAt,
        p_provider_message_id: source.provider_message_id,
        p_confidence: candidate.confidence,
      });
      if (error) throw new Error(`Automatic document reconciliation failed: ${error.message}`);
      if (!existed) documentWrites += 1;
    }
  }

  return { purchaseWrites, shipmentWrites, documentWrites };
}

export async function processNylasMessage(input: {
  grantId: string;
  messageId: string;
  mode: AutomationMode;
}): Promise<AutomaticPipelineResult> {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;

  const { data: connection, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();

  if (connectionError) throw new Error(`Failed to resolve webhook grant: ${connectionError.message}`);
  if (!connection) {
    return { ok: true, status: 'unknown_grant', purchaseWrites: 0, shipmentWrites: 0, documentWrites: 0, aiCalls: 0 };
  }

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: input.grantId });
  const email = await provider.getMessage(input.messageId);

  let sourceId: string;
  let sourceStatus: string;
  let validatedResult: Record<string, unknown> | null = null;

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,processing_status,validated_result')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to check webhook dedupe: ${existingError.message}`);

  if (existing) {
    sourceId = existing.id as string;
    sourceStatus = existing.processing_status as string;
    validatedResult = existing.validated_result as Record<string, unknown> | null;
  } else {
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
        processing_status: 'pending',
      })
      .select('id,processing_status')
      .single();
    if (insertError) throw new Error(`Failed to save webhook source email: ${insertError.message}`);
    sourceId = inserted.id as string;
    sourceStatus = inserted.processing_status as string;
  }

  if (sourceStatus === 'ignored') {
    return { ok: true, status: 'ignored', sourceEmailId: sourceId, purchaseWrites: 0, shipmentWrites: 0, documentWrites: 0, aiCalls: 0 };
  }

  let aiCalls = 0;

  if (!validatedResult) {
    const filter = filterCommerceEmail(email);
    if (!filter.relevant) {
      await db.from('source_emails').update({ processing_status: 'ignored' }).eq('id', sourceId);
      return { ok: true, status: 'ignored', sourceEmailId: sourceId, purchaseWrites: 0, shipmentWrites: 0, documentWrites: 0, aiCalls: 0 };
    }

    const { data: claim, error: claimError } = await db
      .from('source_emails')
      .update({ processing_status: 'processing' })
      .eq('id', sourceId)
      .in('processing_status', ['pending', 'error'])
      .select('id')
      .maybeSingle();
    if (claimError) throw new Error(`Failed to claim webhook source email: ${claimError.message}`);
    if (!claim && sourceStatus === 'processing') {
      return { ok: true, status: 'already_processing', sourceEmailId: sourceId, purchaseWrites: 0, shipmentWrites: 0, documentWrites: 0, aiCalls: 0 };
    }

    const openai = requireOpenAIConfig();
    const compactBody = email.bodyHtml
      ? htmlToCompactText(email.bodyHtml)
      : (email.snippet ?? '').trim().slice(0, 12_000);

    try {
      const result = await extractEmailWithOpenAIResult({
        apiKey: openai.apiKey,
        model: openai.model,
        subject: email.subject,
        fromDomains: senderDomains(email),
        bodyText: compactBody,
      });
      aiCalls = 1;
      const extraction = result.extraction;
      const extractionJson = extractionToJson(extraction);
      const validated: ValidatedEmailExtraction = validateEmailExtraction({
        extraction,
        senderDomains: senderDomains(email),
        subject: email.subject,
        bodyText: email.bodyHtml ?? email.snippet ?? '',
      });
      validatedResult = toJson(validated);
      const now = new Date().toISOString();

      const aiRunResult: Json = {
        extraction: extractionJson,
        openai_response_id: result.responseId,
        total_tokens: result.totalTokens,
        cached_input_tokens: result.cachedInputTokens,
      };

      const { error: runError } = await db.from('ai_processing_runs').insert({
        user_id: connection.user_id,
        source_email_id: sourceId,
        purchase_id: null,
        purpose: 'email_extraction',
        provider: 'openai',
        model: openai.model,
        prompt_version: PROMPT_VERSION,
        status: 'completed',
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        estimated_cost: null,
        confidence: extraction.confidence,
        result: aiRunResult,
      });
      if (runError) throw new Error(`Failed to save automatic AI run: ${runError.message}`);

      const { error: updateError } = await db
        .from('source_emails')
        .update({
          classification: extraction.event_type,
          structured_result: extractionJson,
          validated_result: validatedResult,
          validation_status: validated.validation_status,
          validated_at: now,
          processed_at: now,
          processing_status: 'review',
        })
        .eq('id', sourceId);
      if (updateError) throw new Error(`Failed to save automatic extraction: ${updateError.message}`);
    } catch (error) {
      await db.from('source_emails').update({ processing_status: 'error' }).eq('id', sourceId);
      throw error;
    }
  }

  const writes = await reconcileUser(connection.user_id as string, input.mode);

  const { count: linkedCount, error: linkedError } = await db
    .from('purchase_sources')
    .select('source_email_id', { count: 'exact', head: true })
    .eq('source_email_id', sourceId);
  if (linkedError) throw new Error(`Failed to verify automatic evidence link: ${linkedError.message}`);

  const finalStatus = (linkedCount ?? 0) > 0 ? 'processed' : 'review';
  await db.from('source_emails').update({ processing_status: finalStatus }).eq('id', sourceId);

  return {
    ok: true,
    status: finalStatus,
    sourceEmailId: sourceId,
    ...writes,
    aiCalls,
  };
}
