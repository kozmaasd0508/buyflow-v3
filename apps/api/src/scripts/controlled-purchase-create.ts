import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { selectControlledPurchaseCandidate } from '../resolution/controlled-purchase-creation.js';
import {
  resolvePurchaseCandidates,
  type ResolutionEvidence,
  type ResolutionEventType,
} from '../resolution/purchase-resolution.js';

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

function toEvidence(row: any): ResolutionEvidence | null {
  const result = row.validated_result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;

  const eventType = result.event_type;
  const confidence = result.confidence;
  if (
    typeof row.id !== 'string' ||
    typeof row.user_id !== 'string' ||
    typeof row.received_at !== 'string' ||
    typeof eventType !== 'string' ||
    !ALLOWED_EVENT_TYPES.has(eventType as ResolutionEventType) ||
    typeof confidence !== 'number'
  ) {
    return null;
  }

  return {
    sourceEmailId: row.id,
    userId: row.user_id,
    senderDomain: senderDomain(row.from_address),
    eventType: eventType as ResolutionEventType,
    merchant: typeof result.merchant === 'string' ? result.merchant : null,
    orderNumber:
      typeof result.order_number === 'string' ? result.order_number : null,
    confidence,
    receivedAt: row.received_at,
  };
}

async function main() {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;

  const { data: rows, error } = await db
    .from('source_emails')
    .select('id,user_id,from_address,received_at,validated_result')
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load validated source emails: ${error.message}`);
  }

  const evidence = (rows ?? [])
    .map(toEvidence)
    .filter((row: ResolutionEvidence | null): row is ResolutionEvidence => Boolean(row));

  const candidates = resolvePurchaseCandidates(evidence);
  const candidate = selectControlledPurchaseCandidate(candidates);
  const candidateEvidence = evidence.filter((row) =>
    candidate.sourceEmailIds.includes(row.sourceEmailId),
  );

  if (candidateEvidence.length !== candidate.sourceEmailIds.length) {
    throw new Error('Controlled candidate evidence set is incomplete');
  }

  if (candidateEvidence.some((row) => row.userId !== candidate.userId)) {
    throw new Error('Controlled candidate contains cross-user evidence');
  }

  const orderCreatedEvidence = candidateEvidence
    .filter((row) => row.eventType === 'order_created')
    .sort((a, b) => b.confidence - a.confidence);
  const primaryOrderEvidence = orderCreatedEvidence[0];

  if (!primaryOrderEvidence) {
    throw new Error('Controlled candidate has no order_created evidence');
  }

  const { data: existingRows, error: existingError } = await db
    .from('purchases')
    .select('id')
    .eq('user_id', candidate.userId)
    .eq('merchant_domain', candidate.senderDomain)
    .eq('order_number', candidate.orderNumber)
    .limit(1);

  if (existingError) {
    throw new Error(`Failed to check existing purchase: ${existingError.message}`);
  }

  const existedBefore = Array.isArray(existingRows) && existingRows.length > 0;
  const sources = candidateEvidence.map((row) => ({
    source_email_id: row.sourceEmailId,
    relation_type: row.eventType,
    confidence: row.confidence,
  }));

  const { data: purchaseId, error: createError } = await db.rpc(
    'controlled_create_purchase_with_sources',
    {
      p_user_id: candidate.userId,
      p_merchant_name: candidate.merchant,
      p_merchant_domain: candidate.senderDomain,
      p_order_number: candidate.orderNumber,
      p_ordered_at: primaryOrderEvidence.receivedAt,
      p_confidence: candidate.confidence,
      p_sources: sources,
    },
  );

  if (createError) {
    throw new Error(`Controlled purchase RPC failed: ${createError.message}`);
  }

  if (typeof purchaseId !== 'string' || !purchaseId) {
    throw new Error('Controlled purchase RPC returned no purchase id');
  }

  const { count: linkedSourceCount, error: sourceCountError } = await db
    .from('purchase_sources')
    .select('source_email_id', { count: 'exact', head: true })
    .eq('purchase_id', purchaseId);

  if (sourceCountError) {
    throw new Error(`Failed to verify purchase sources: ${sourceCountError.message}`);
  }

  if (linkedSourceCount !== candidate.sourceEmailIds.length) {
    throw new Error(
      `Controlled purchase source verification failed: expected ${candidate.sourceEmailIds.length}, got ${linkedSourceCount ?? 0}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'controlled_purchase_creation',
        safety: {
          maxCreateCandidates: 1,
          requiresCorroboratedDecision: true,
          requiresAtLeastThreeEvidenceEmails: true,
          requiresAtLeastTwoCorroboratingEmails: true,
          userScopedResolution: true,
          databaseUniqueIdentityGuard: true,
          atomicPurchaseAndSourceWrite: true,
          shipmentWrites: false,
          documentWrites: false,
          openAiCalls: false,
          publicLogContainsIdentifiers: false,
        },
        action: existedBefore ? 'reused_idempotently' : 'created',
        candidateDecision: candidate.decision,
        evidenceLinked: linkedSourceCount,
        purchaseWrites: existedBefore ? 0 : 1,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    'Controlled purchase creation failed:',
    error instanceof Error ? error.message.replace(/[0-9a-f-]{20,}/gi, '[redacted]') : 'UnknownError',
  );
  process.exit(1);
});
