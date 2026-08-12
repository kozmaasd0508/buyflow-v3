import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { selectControlledDocumentCandidate } from '../resolution/controlled-document-creation.js';
import {
  resolveDocumentCandidates,
  type DocumentPurchaseIdentity,
  type DocumentResolutionEvidence,
} from '../resolution/document-resolution.js';

interface SourceEmailRow {
  id: string;
  user_id: string;
  provider_message_id: string;
  from_address: string | null;
  received_at: string;
  validated_result: Record<string, unknown> | null;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_domain: string | null;
  order_number: string | null;
  current_state: string;
}

function senderDomain(fromAddress: string | null): string {
  if (!fromAddress) return '';
  const match = fromAddress.toLowerCase().match(/@([^>\s,;]+)/);
  return (match?.[1] ?? '').replace(/[)>]+$/, '').trim();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toEvidence(row: SourceEmailRow): DocumentResolutionEvidence | null {
  const result = row.validated_result;
  if (!result || result.event_type !== 'invoice_or_receipt') return null;

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

async function main() {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;

  const [{ data: purchaseRows, error: purchaseError }, { data: emailRows, error: emailError }] =
    await Promise.all([
      db
        .from('purchases')
        .select('id,user_id,merchant_domain,order_number,current_state'),
      db
        .from('source_emails')
        .select('id,user_id,provider_message_id,from_address,received_at,validated_result')
        .not('validated_result', 'is', null)
        .order('received_at', { ascending: true }),
    ]);

  if (purchaseError) {
    throw new Error(`Failed to load purchases: ${purchaseError.message}`);
  }
  if (emailError) {
    throw new Error(`Failed to load validated source emails: ${emailError.message}`);
  }

  const rawPurchases = (purchaseRows ?? []) as PurchaseRow[];
  const purchases: DocumentPurchaseIdentity[] = rawPurchases.map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
  }));

  const rawEmails = (emailRows ?? []) as SourceEmailRow[];
  const evidence = rawEmails
    .map(toEvidence)
    .filter(
      (row: DocumentResolutionEvidence | null): row is DocumentResolutionEvidence => Boolean(row),
    );

  const candidates = resolveDocumentCandidates(purchases, evidence);
  const candidate = selectControlledDocumentCandidate(candidates);
  const source = rawEmails.find((row) => row.id === candidate.sourceEmailId);
  const candidateEvidence = evidence.find((row) => row.sourceEmailId === candidate.sourceEmailId);

  if (!source || !candidateEvidence) {
    throw new Error('Controlled document candidate source evidence is incomplete');
  }
  if (source.user_id !== candidate.userId || candidateEvidence.userId !== candidate.userId) {
    throw new Error('Controlled document candidate contains cross-user evidence');
  }

  const purchaseBefore = rawPurchases.find((row) => row.id === candidate.purchaseId);
  if (!purchaseBefore || purchaseBefore.user_id !== candidate.userId) {
    throw new Error('Controlled document candidate purchase is missing or cross-user');
  }

  const documentNumber = candidateEvidence.invoiceNumber;
  if (!documentNumber) {
    throw new Error('Controlled invoice candidate has no invoice number');
  }
  if (!source.provider_message_id) {
    throw new Error('Controlled document candidate has no provider message id');
  }

  const { data: existingByNumber, error: existingByNumberError } = await db
    .from('documents')
    .select('id,purchase_id,type,document_number,provider_message_id')
    .eq('purchase_id', candidate.purchaseId)
    .eq('type', candidate.documentType)
    .eq('document_number', documentNumber)
    .limit(1);

  if (existingByNumberError) {
    throw new Error(`Failed to check existing document number: ${existingByNumberError.message}`);
  }

  let existingRows = existingByNumber ?? [];
  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    const { data: existingByMessage, error: existingByMessageError } = await db
      .from('documents')
      .select('id,purchase_id,type,document_number,provider_message_id')
      .eq('purchase_id', candidate.purchaseId)
      .eq('type', candidate.documentType)
      .eq('provider_message_id', source.provider_message_id)
      .limit(1);

    if (existingByMessageError) {
      throw new Error(`Failed to check existing document message: ${existingByMessageError.message}`);
    }
    existingRows = existingByMessage ?? [];
  }

  const existedBefore = Array.isArray(existingRows) && existingRows.length > 0;
  if (existedBefore && existingRows[0]?.purchase_id !== candidate.purchaseId) {
    throw new Error('Existing document identity belongs to another purchase');
  }

  const { data: documentId, error: createError } = await db.rpc(
    'controlled_upsert_document_with_source',
    {
      p_user_id: candidate.userId,
      p_purchase_id: candidate.purchaseId,
      p_source_email_id: candidate.sourceEmailId,
      p_document_type: candidate.documentType,
      p_document_number: documentNumber,
      p_issued_at: candidateEvidence.receivedAt,
      p_provider_message_id: source.provider_message_id,
      p_confidence: candidate.confidence,
    },
  );

  if (createError) {
    throw new Error(`Controlled document RPC failed: ${createError.message}`);
  }
  if (typeof documentId !== 'string' || !documentId) {
    throw new Error('Controlled document RPC returned no document id');
  }

  const { data: documentRows, error: documentVerifyError } = await db
    .from('documents')
    .select('id,purchase_id,type,document_number,source_type,provider_message_id')
    .eq('id', documentId)
    .limit(1);

  if (documentVerifyError) {
    throw new Error(`Failed to verify document: ${documentVerifyError.message}`);
  }

  const document = documentRows?.[0];
  if (!document || document.purchase_id !== candidate.purchaseId) {
    throw new Error('Controlled document verification failed');
  }
  if (document.type !== 'invoice' || document.document_number !== documentNumber) {
    throw new Error('Controlled document identity verification failed');
  }
  if (document.source_type !== 'email_body') {
    throw new Error('Controlled document provenance verification failed');
  }

  const { count: linkedEvidenceCount, error: evidenceCountError } = await db
    .from('purchase_sources')
    .select('source_email_id', { count: 'exact', head: true })
    .eq('purchase_id', candidate.purchaseId)
    .eq('source_email_id', candidate.sourceEmailId);

  if (evidenceCountError) {
    throw new Error(`Failed to verify document evidence link: ${evidenceCountError.message}`);
  }
  if (linkedEvidenceCount !== 1) {
    throw new Error('Controlled document evidence verification failed');
  }

  const { data: purchaseAfterRows, error: purchaseAfterError } = await db
    .from('purchases')
    .select('current_state')
    .eq('id', candidate.purchaseId)
    .limit(1);

  if (purchaseAfterError) {
    throw new Error(`Failed to verify purchase state: ${purchaseAfterError.message}`);
  }

  const purchaseAfterState = purchaseAfterRows?.[0]?.current_state;
  if (purchaseAfterState !== purchaseBefore.current_state) {
    throw new Error('Controlled document write unexpectedly changed purchase state');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'controlled_document_creation',
        safety: {
          maxLinkableCandidates: 1,
          firstWriteRequiresInvoice: true,
          exactUserMerchantOrderIdentityRequired: true,
          invoiceNumberRequired: true,
          databaseDocumentIdentityGuard: true,
          atomicDocumentAndSourceWrite: true,
          purchaseStateUpdates: false,
          shipmentWrites: false,
          openAiCalls: false,
          publicLogContainsIdentifiers: false,
        },
        action: existedBefore ? 'reused_idempotently' : 'created',
        candidateDecision: candidate.decision,
        documentType: candidate.documentType,
        evidenceLinked: linkedEvidenceCount,
        documentWrites: existedBefore ? 0 : 1,
        purchaseStateChanged: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    'Controlled document creation failed:',
    error instanceof Error ? error.message.replace(/[0-9a-f-]{20,}/gi, '[redacted]') : 'UnknownError',
  );
  process.exit(1);
});
