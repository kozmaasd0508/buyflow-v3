import { getSupabaseAdmin } from '../db/supabase-admin.js';
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
    typeof eventType !== 'string' ||
    !ALLOWED_EVENT_TYPES.has(eventType as ResolutionEventType) ||
    typeof confidence !== 'number'
  ) {
    return null;
  }

  return {
    sourceEmailId: row.id,
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
    .select('id,from_address,received_at,validated_result')
    .not('validated_result', 'is', null)
    .order('received_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load validated source emails: ${error.message}`);
  }

  const evidence = (rows ?? [])
    .map(toEvidence)
    .filter((row: ResolutionEvidence | null): row is ResolutionEvidence => Boolean(row));

  const candidates = resolvePurchaseCandidates(evidence);
  const decisionCounts: Record<string, number> = {};
  let totalEvidenceInCreateCandidates = 0;

  for (const candidate of candidates) {
    decisionCounts[candidate.decision] =
      (decisionCounts[candidate.decision] ?? 0) + 1;

    if (
      candidate.decision === 'create_direct' ||
      candidate.decision === 'create_corroborated'
    ) {
      totalEvidenceInCreateCandidates += candidate.evidenceCount;
    }
  }

  const createCandidates = candidates.filter(
    (candidate) =>
      candidate.decision === 'create_direct' ||
      candidate.decision === 'create_corroborated',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'purchase_resolution_dry_run',
        safety: {
          databaseWrites: false,
          purchaseWrites: false,
          shipmentWrites: false,
          documentWrites: false,
          openAiCalls: false,
          publicLogContainsIdentifiers: false,
        },
        validatedEmailsLoaded: evidence.length,
        candidateGroups: candidates.length,
        decisionCounts,
        createCandidateCount: createCandidates.length,
        totalEvidenceInCreateCandidates,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    'Purchase resolution dry run failed:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exit(1);
});
