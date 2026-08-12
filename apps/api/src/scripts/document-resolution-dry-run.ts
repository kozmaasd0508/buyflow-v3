import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  resolveDocumentCandidates,
  type DocumentPurchaseIdentity,
  type DocumentResolutionEvidence,
} from '../resolution/document-resolution.js';

interface SourceEmailRow {
  id: string;
  user_id: string;
  from_address: string | null;
  received_at: string;
  validated_result: Record<string, unknown> | null;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_domain: string | null;
  order_number: string | null;
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
      db.from('purchases').select('id,user_id,merchant_domain,order_number'),
      db
        .from('source_emails')
        .select('id,user_id,from_address,received_at,validated_result')
        .not('validated_result', 'is', null)
        .order('received_at', { ascending: true }),
    ]);

  if (purchaseError) throw new Error(`Failed to load purchases: ${purchaseError.message}`);
  if (emailError) throw new Error(`Failed to load validated emails: ${emailError.message}`);

  const purchases: DocumentPurchaseIdentity[] = ((purchaseRows ?? []) as PurchaseRow[]).map((row) => ({
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
  }));

  const evidence = ((emailRows ?? []) as SourceEmailRow[])
    .map(toEvidence)
    .filter((row: DocumentResolutionEvidence | null): row is DocumentResolutionEvidence => Boolean(row));

  const candidates = resolveDocumentCandidates(purchases, evidence);
  const decisionCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};

  for (const candidate of candidates) {
    decisionCounts[candidate.decision] = (decisionCounts[candidate.decision] ?? 0) + 1;
    typeCounts[candidate.documentType] = (typeCounts[candidate.documentType] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'document_resolution_dry_run',
        safety: {
          databaseWrites: false,
          documentWrites: false,
          purchaseUpdates: false,
          openAiCalls: false,
          exactUserMerchantOrderIdentityRequired: true,
          missingOrderNumberNeverGuessesPurchase: true,
          userScopedResolution: true,
          publicLogContainsIdentifiers: false,
        },
        purchasesLoaded: purchases.length,
        documentEmailsLoaded: evidence.length,
        candidatesEvaluated: candidates.length,
        decisionCounts,
        documentTypeCounts: typeCounts,
        linkableCandidateCount: decisionCounts.linkable ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    'Document resolution dry run failed:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exit(1);
});
