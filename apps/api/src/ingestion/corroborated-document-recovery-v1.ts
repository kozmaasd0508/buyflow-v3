import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveCorroboratedDocumentCandidates,
  type CorroboratedDocumentLink,
  type CorroboratedDocumentPurchase,
  type CorroboratedDocumentSource,
  type CorroboratedExistingDocument,
} from '../resolution/corroborated-document-resolution.js';

interface PurchaseSourceRow {
  purchase_id: string;
  source_email_id: string;
  relation_type: string | null;
  confidence: number | string | null;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  order_number: string | null;
}

interface SourceRow {
  id: string;
  user_id: string;
  provider_message_id: string | null;
  received_at: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
}

interface DocumentRow {
  purchase_id: string;
  provider_message_id: string | null;
  type: string;
  document_number: string | null;
}

export interface CorroboratedDocumentRecoveryV1Result {
  scannedInvoiceLinks: number;
  purchases: number;
  candidates: number;
  materialized: number;
  failed: number;
  aiCalls: number;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function effectiveValidationStatus(row: SourceRow): string | null {
  return stringOrNull(row.validated_result?.validation_status) ?? row.validation_status;
}

function toSource(row: SourceRow): CorroboratedDocumentSource | null {
  const result = row.validated_result;
  if (!result) return null;
  const confidence = numberOrNull(result.confidence);
  if (confidence === null) return null;
  return {
    sourceEmailId: row.id,
    userId: row.user_id,
    providerMessageId: row.provider_message_id,
    receivedAt: row.received_at,
    validationStatus: effectiveValidationStatus(row),
    eventType: stringOrNull(result.event_type),
    orderNumber: stringOrNull(result.order_number),
    invoiceNumber: stringOrNull(result.invoice_number),
    confidence,
  };
}

export async function drainCorroboratedDocumentRecoveryV1(
  mode: 'observe' | 'write',
  limit = 200,
): Promise<CorroboratedDocumentRecoveryV1Result> {
  const db = getSupabaseAdmin() as any;
  const result: CorroboratedDocumentRecoveryV1Result = {
    scannedInvoiceLinks: 0,
    purchases: 0,
    candidates: 0,
    materialized: 0,
    failed: 0,
    aiCalls: 0,
  };

  const { data: invoiceLinkData, error: invoiceLinkError } = await db
    .from('purchase_sources')
    .select('purchase_id,source_email_id,relation_type,confidence')
    .in('relation_type', ['invoice_or_receipt', 'document'])
    .order('created_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (invoiceLinkError) {
    throw new Error(`Corroborated Document V1 invoice-link read failed: ${invoiceLinkError.message}`);
  }

  const invoiceLinks = (invoiceLinkData ?? []) as PurchaseSourceRow[];
  result.scannedInvoiceLinks = invoiceLinks.length;
  if (invoiceLinks.length === 0) return result;

  const purchaseIds = [...new Set(invoiceLinks.map((row) => row.purchase_id))];
  result.purchases = purchaseIds.length;

  const { data: purchaseData, error: purchaseError } = await db
    .from('purchases')
    .select('id,user_id,order_number')
    .in('id', purchaseIds);
  if (purchaseError) {
    throw new Error(`Corroborated Document V1 purchase read failed: ${purchaseError.message}`);
  }
  const purchases: CorroboratedDocumentPurchase[] = ((purchaseData ?? []) as PurchaseRow[]).map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    orderNumber: row.order_number,
  }));

  const { data: allLinkData, error: allLinkError } = await db
    .from('purchase_sources')
    .select('purchase_id,source_email_id,relation_type,confidence')
    .in('purchase_id', purchaseIds);
  if (allLinkError) {
    throw new Error(`Corroborated Document V1 lifecycle-link read failed: ${allLinkError.message}`);
  }
  const allLinkRows = (allLinkData ?? []) as PurchaseSourceRow[];
  const links: CorroboratedDocumentLink[] = allLinkRows.map((row) => ({
    purchaseId: row.purchase_id,
    sourceEmailId: row.source_email_id,
    relationType: row.relation_type,
    confidence: numberOrNull(row.confidence),
  }));

  const sourceIds = [...new Set(allLinkRows.map((row) => row.source_email_id))];
  const { data: sourceData, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,provider_message_id,received_at,validation_status,validated_result')
    .in('id', sourceIds);
  if (sourceError) {
    throw new Error(`Corroborated Document V1 source read failed: ${sourceError.message}`);
  }
  const sources = ((sourceData ?? []) as SourceRow[])
    .map(toSource)
    .filter((row: CorroboratedDocumentSource | null): row is CorroboratedDocumentSource => Boolean(row));

  const { data: documentData, error: documentError } = await db
    .from('documents')
    .select('purchase_id,provider_message_id,type,document_number')
    .in('purchase_id', purchaseIds);
  if (documentError) {
    throw new Error(`Corroborated Document V1 document read failed: ${documentError.message}`);
  }
  const documents: CorroboratedExistingDocument[] = ((documentData ?? []) as DocumentRow[]).map((row) => ({
    purchaseId: row.purchase_id,
    providerMessageId: row.provider_message_id,
    type: row.type,
    documentNumber: row.document_number,
  }));

  const candidates = resolveCorroboratedDocumentCandidates(sources, links, purchases, documents)
    .filter((candidate) => invoiceLinks.some((row) => row.source_email_id === candidate.sourceEmailId));
  result.candidates = candidates.length;

  if (mode === 'observe') return result;

  for (const candidate of candidates) {
    try {
      const { data: documentId, error: upsertError } = await db.rpc('controlled_upsert_corroborated_document_with_source', {
        p_user_id: candidate.userId,
        p_purchase_id: candidate.purchaseId,
        p_source_email_id: candidate.sourceEmailId,
        p_document_type: candidate.documentType,
        p_document_number: candidate.documentNumber,
        p_issued_at: candidate.issuedAt,
        p_provider_message_id: candidate.providerMessageId,
        p_confidence: candidate.confidence,
      });
      if (upsertError || typeof documentId !== 'string' || !documentId) {
        throw new Error(`Corroborated Document V1 upsert failed: ${upsertError?.message ?? 'missing document id'}`);
      }
      result.materialized += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
