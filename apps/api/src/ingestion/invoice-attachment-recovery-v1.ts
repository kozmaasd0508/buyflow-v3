import { createHash } from 'node:crypto';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { EmailAttachmentMetadata, NormalizedEmail } from '../email/types.js';
import { resolveInvoiceAttachmentPurchase, type InvoiceAttachmentPurchaseIdentity } from '../resolution/invoice-attachment-resolution.js';
import { parseInvoiceAttachmentText } from './invoice-attachment-parser.js';
import { extractPdfText } from './pdf-text-extractor.js';

const LOOKBACK_DAYS = 90;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const STORAGE_BUCKET = 'buyflow-purchase-documents';
const PARSER_VERSION = 'pdf-invoice-v1';

const PUBLIC_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'freemail.hu',
  'citromail.hu',
]);

interface SourceRow {
  id: string;
  user_id: string;
  email_connection_id: string;
  provider_message_id: string;
  from_address: string | null;
  subject: string | null;
  received_at: string;
  processing_status: string;
  validation_status: string | null;
  validated_result: Record<string, unknown> | null;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  provider: 'nylas' | 'gmail';
  provider_account_id: string | null;
  status: string;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_name: string | null;
  merchant_domain: string | null;
  order_number: string | null;
}

interface AttachmentRow {
  id: string;
  processing_status: string;
  attempts: number;
  storage_bucket: string | null;
  storage_path: string | null;
  content_sha256: string | null;
}

export interface InvoiceAttachmentRecoveryV1Result {
  scannedSources: number;
  discoveredAttachments: number;
  linkedDocuments: number;
  documentWrites: number;
  reviewAttachments: number;
  ignoredAttachments: number;
  failedAttachments: number;
  aiCalls: number;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function domainFromAddress(value: string | null | undefined): string {
  const address = (value ?? '').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).replace(/^www\./, '') : '';
}

function senderDomains(email: NormalizedEmail): string[] {
  return [...new Set(email.from
    .map((row) => domainFromAddress(row.email))
    .filter(Boolean))];
}

function isInvoiceSource(row: SourceRow): boolean {
  const eventType = row.validated_result?.event_type;
  if (eventType === 'invoice_or_receipt') return true;
  return /\b(szamla|invoice|receipt|bizonylat)\b/i.test(normalizeText(row.subject));
}

function isPdfAttachment(attachment: EmailAttachmentMetadata): boolean {
  if (attachment.isInline === true) return false;
  const contentType = attachment.contentType.split(';', 1)[0]?.trim().toLowerCase();
  return contentType === 'application/pdf' || /\.pdf$/i.test(attachment.filename.trim());
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function storagePath(userId: string, sourceEmailId: string, attachmentId: string): string {
  return `${userId}/${sourceEmailId}/${sha256Hex(attachmentId).slice(0, 40)}.pdf`;
}

function attachmentExtractionResult(input: {
  invoiceNumber: string;
  orderNumber: string;
  confidence: number;
  reasons: string[];
  contentSha256: string;
}) {
  return {
    schema_version: 1,
    parser_version: PARSER_VERSION,
    document_type: 'invoice',
    invoice_number: input.invoiceNumber,
    order_number: input.orderNumber,
    confidence: input.confidence,
    reasons: input.reasons,
    content_sha256: input.contentSha256,
  };
}

function buildValidatedInvoiceResult(
  existing: Record<string, unknown> | null,
  purchase: PurchaseRow,
  parsed: { invoiceNumber: string; orderNumber: string; confidence: number; reasons: string[] },
) {
  return {
    ...(existing ?? {}),
    schema_version: 2,
    event_type: 'invoice_or_receipt',
    original_event_type: 'invoice_or_receipt',
    merchant: purchase.merchant_name,
    order_number: purchase.order_number,
    invoice_number: parsed.invoiceNumber,
    confidence: parsed.confidence,
    validation_status: 'validated',
    eligible_for_purchase_creation: false,
    parser_version: PARSER_VERSION,
    parser_reasons: parsed.reasons,
    extraction_source: 'pdf_attachment',
  };
}

async function loadOrCreateAttachmentRow(input: {
  db: any;
  source: SourceRow;
  attachment: EmailAttachmentMetadata;
}): Promise<AttachmentRow> {
  const { db, source, attachment } = input;
  const { data: existing, error: existingError } = await db
    .from('email_attachments')
    .select('id,processing_status,attempts,storage_bucket,storage_path,content_sha256')
    .eq('email_connection_id', source.email_connection_id)
    .eq('provider_message_id', source.provider_message_id)
    .eq('attachment_id', attachment.id)
    .maybeSingle();
  if (existingError) throw new Error(`attachment_metadata_read_failed:${existingError.message}`);
  if (existing) return existing as AttachmentRow;

  const { data: inserted, error: insertError } = await db
    .from('email_attachments')
    .insert({
      user_id: source.user_id,
      email_connection_id: source.email_connection_id,
      source_email_id: source.id,
      provider_message_id: source.provider_message_id,
      attachment_id: attachment.id,
      filename: attachment.filename,
      mime_type: 'application/pdf',
      size_bytes: attachment.size ?? null,
      processing_status: 'pending',
    })
    .select('id,processing_status,attempts,storage_bucket,storage_path,content_sha256')
    .single();
  if (insertError) throw new Error(`attachment_metadata_insert_failed:${insertError.message}`);
  return inserted as AttachmentRow;
}

async function markAttachmentReview(db: any, attachmentRowId: string, code: string, extractionResult?: Record<string, unknown>) {
  await db.from('email_attachments').update({
    processing_status: 'review',
    last_error_code: code,
    extraction_result: extractionResult ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', attachmentRowId);
}

export async function drainInvoiceAttachmentRecoveryV1(
  mode: 'observe' | 'write',
  limit = 40,
): Promise<InvoiceAttachmentRecoveryV1Result> {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;
  const result: InvoiceAttachmentRecoveryV1Result = {
    scannedSources: 0,
    discoveredAttachments: 0,
    linkedDocuments: 0,
    documentWrites: 0,
    reviewAttachments: 0,
    ignoredAttachments: 0,
    failedAttachments: 0,
    aiCalls: 0,
  };

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: sourceData, error: sourceError } = await db
    .from('source_emails')
    .select('id,user_id,email_connection_id,provider_message_id,from_address,subject,received_at,processing_status,validation_status,validated_result')
    .in('processing_status', ['review', 'unlinked'])
    .gte('received_at', cutoff)
    .order('received_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (sourceError) throw new Error(`Invoice attachment source read failed: ${sourceError.message}`);

  const sources = ((sourceData ?? []) as SourceRow[]).filter(isInvoiceSource);
  result.scannedSources = sources.length;
  if (sources.length === 0 || mode !== 'write') return result;

  const connectionIds = [...new Set(sources.map((row) => row.email_connection_id))];
  const userIds = [...new Set(sources.map((row) => row.user_id))];

  const { data: connectionData, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider,provider_account_id,status')
    .in('id', connectionIds)
    .eq('status', 'active');
  if (connectionError) throw new Error(`Invoice attachment connection read failed: ${connectionError.message}`);
  const connections = new Map(((connectionData ?? []) as ConnectionRow[]).map((row) => [row.id, row]));

  const { data: purchaseData, error: purchaseError } = await db
    .from('purchases')
    .select('id,user_id,merchant_name,merchant_domain,order_number')
    .in('user_id', userIds);
  if (purchaseError) throw new Error(`Invoice attachment purchase read failed: ${purchaseError.message}`);
  const purchases = (purchaseData ?? []) as PurchaseRow[];
  const purchaseIdentities: InvoiceAttachmentPurchaseIdentity[] = purchases.map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
  }));

  for (const source of sources) {
    const sourceSenderDomain = domainFromAddress(source.from_address);
    if (!sourceSenderDomain || PUBLIC_MAILBOX_DOMAINS.has(sourceSenderDomain)) continue;

    const connection = connections.get(source.email_connection_id);
    if (!connection?.provider_account_id || connection.user_id !== source.user_id || connection.provider !== 'nylas') continue;

    try {
      const provider = createEmailProvider({ provider: 'nylas', providerAccountId: connection.provider_account_id });
      const email = await provider.getMessage(source.provider_message_id);
      const emailSenderDomains = senderDomains(email);
      if (!emailSenderDomains.includes(sourceSenderDomain)) continue;

      const attachments = email.attachments.filter(isPdfAttachment);
      result.discoveredAttachments += attachments.length;

      for (const attachment of attachments) {
        let attachmentRow: AttachmentRow | null = null;
        try {
          attachmentRow = await loadOrCreateAttachmentRow({ db, source, attachment });
          if (['processed', 'review', 'ignored'].includes(attachmentRow.processing_status)) continue;
          if (attachmentRow.attempts >= MAX_ATTEMPTS) continue;

          if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) {
            await db.from('email_attachments').update({
              processing_status: 'ignored',
              last_error_code: 'attachment_too_large',
              updated_at: new Date().toISOString(),
            }).eq('id', attachmentRow.id);
            result.ignoredAttachments += 1;
            continue;
          }

          const { data: claimed, error: claimError } = await db.from('email_attachments').update({
            processing_status: 'processing',
            attempts: attachmentRow.attempts + 1,
            last_error_code: null,
            updated_at: new Date().toISOString(),
          }).eq('id', attachmentRow.id)
            .in('processing_status', ['pending', 'error'])
            .select('id')
            .maybeSingle();
          if (claimError) throw new Error(`attachment_claim_failed:${claimError.message}`);
          if (!claimed) continue;

          const bytes = await provider.downloadAttachment(source.provider_message_id, attachment.id);
          if (bytes.length > MAX_ATTACHMENT_BYTES) {
            await db.from('email_attachments').update({
              processing_status: 'ignored',
              last_error_code: 'attachment_too_large',
              size_bytes: bytes.length,
              updated_at: new Date().toISOString(),
            }).eq('id', attachmentRow.id);
            result.ignoredAttachments += 1;
            continue;
          }

          const contentSha256 = sha256Hex(bytes);
          const path = storagePath(source.user_id, source.id, attachment.id);
          const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, bytes, {
            contentType: 'application/pdf',
            upsert: true,
          });
          if (uploadError) throw new Error(`attachment_storage_failed:${uploadError.message}`);

          const text = await extractPdfText(bytes);
          if (!text) {
            await db.from('email_attachments').update({
              processing_status: 'review',
              storage_bucket: STORAGE_BUCKET,
              storage_path: path,
              content_sha256: contentSha256,
              last_error_code: 'pdf_text_layer_missing',
              updated_at: new Date().toISOString(),
            }).eq('id', attachmentRow.id);
            result.reviewAttachments += 1;
            continue;
          }

          const parsed = parseInvoiceAttachmentText({
            senderDomains: emailSenderDomains,
            filename: attachment.filename,
            text,
          });
          if (!parsed) {
            await db.from('email_attachments').update({
              processing_status: 'review',
              storage_bucket: STORAGE_BUCKET,
              storage_path: path,
              content_sha256: contentSha256,
              last_error_code: 'invoice_identity_not_found',
              updated_at: new Date().toISOString(),
            }).eq('id', attachmentRow.id);
            result.reviewAttachments += 1;
            continue;
          }

          const resolution = resolveInvoiceAttachmentPurchase({
            userId: source.user_id,
            senderDomain: sourceSenderDomain,
            orderNumber: parsed.orderNumber,
            purchases: purchaseIdentities,
          });
          const extractionResult = attachmentExtractionResult({
            invoiceNumber: parsed.invoiceNumber,
            orderNumber: parsed.orderNumber,
            confidence: parsed.confidence,
            reasons: [...parsed.reasons, ...resolution.reasons],
            contentSha256,
          });

          if (resolution.decision !== 'linkable' || !resolution.purchaseId) {
            await db.from('email_attachments').update({
              processing_status: 'review',
              storage_bucket: STORAGE_BUCKET,
              storage_path: path,
              content_sha256: contentSha256,
              extraction_result: extractionResult,
              last_error_code: resolution.reasons[0] ?? 'invoice_purchase_resolution_failed',
              updated_at: new Date().toISOString(),
            }).eq('id', attachmentRow.id);
            result.reviewAttachments += 1;
            continue;
          }

          const purchase = purchases.find((row) => row.id === resolution.purchaseId);
          if (!purchase) throw new Error('resolved_purchase_missing');

          const validatedResult = buildValidatedInvoiceResult(source.validated_result, purchase, parsed);
          const now = new Date().toISOString();

          const { error: attachmentUpdateError } = await db.from('email_attachments').update({
            storage_bucket: STORAGE_BUCKET,
            storage_path: path,
            content_sha256: contentSha256,
            size_bytes: bytes.length,
            extraction_result: extractionResult,
            updated_at: now,
          }).eq('id', attachmentRow.id).eq('processing_status', 'processing');
          if (attachmentUpdateError) throw new Error(`attachment_metadata_update_failed:${attachmentUpdateError.message}`);

          const { error: sourceUpdateError } = await db.from('source_emails').update({
            classification: 'invoice_or_receipt',
            validated_result: validatedResult,
            validation_status: 'validated',
            validated_at: now,
            processed_at: now,
          }).eq('id', source.id).eq('user_id', source.user_id);
          if (sourceUpdateError) throw new Error(`invoice_source_update_failed:${sourceUpdateError.message}`);

          const { data: before, error: beforeError } = await db.from('documents')
            .select('id')
            .eq('purchase_id', purchase.id)
            .eq('type', 'invoice')
            .eq('document_number', parsed.invoiceNumber)
            .limit(1);
          if (beforeError) throw new Error(`invoice_document_precheck_failed:${beforeError.message}`);
          const existed = Array.isArray(before) && before.length > 0;

          const { data: documentId, error: documentError } = await db.rpc('controlled_upsert_invoice_attachment_document', {
            p_user_id: source.user_id,
            p_purchase_id: purchase.id,
            p_source_email_id: source.id,
            p_attachment_row_id: attachmentRow.id,
            p_document_number: parsed.invoiceNumber,
            p_issued_at: source.received_at,
            p_provider_message_id: source.provider_message_id,
            p_attachment_id: attachment.id,
            p_filename: attachment.filename,
            p_mime_type: 'application/pdf',
            p_storage_bucket: STORAGE_BUCKET,
            p_storage_path: path,
            p_content_sha256: contentSha256,
            p_confidence: parsed.confidence,
          });
          if (documentError || typeof documentId !== 'string' || !documentId) {
            throw new Error(`invoice_attachment_document_write_failed:${documentError?.message ?? 'missing_document_id'}`);
          }

          const { error: finishError } = await db.from('email_attachments').update({
            processing_status: 'processed',
            last_error_code: null,
            processed_at: now,
            updated_at: now,
          }).eq('id', attachmentRow.id);
          if (finishError) throw new Error(`attachment_finish_failed:${finishError.message}`);

          await db.from('source_emails').update({ processing_status: 'processed' }).eq('id', source.id).eq('user_id', source.user_id);

          result.linkedDocuments += 1;
          if (!existed) result.documentWrites += 1;
        } catch {
          if (attachmentRow) {
            await db.from('email_attachments').update({
              processing_status: 'error',
              last_error_code: 'attachment_processing_failed',
              updated_at: new Date().toISOString(),
            }).eq('id', attachmentRow.id).eq('processing_status', 'processing');
          }
          result.failedAttachments += 1;
        }
      }
    } catch {
      result.failedAttachments += 1;
    }
  }

  return result;
}
