import type { EvidencePacketPrivacySummaryV1 } from '../ai/evidence-packet.js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { loadLegacyPurchaseIdentitySnapshot } from './legacy-snapshot-loader.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import { loadDurableUnresolvedSnapshotFromDb } from './source-email-unresolved-store.js';
import { buildTestProtocolMerchantIdentityRegistry } from './test-protocol-merchant-registry.js';
import type { CorrelationDecision } from './types.js';

export interface ShoppingEmailIdentityShadowDiagnostic {
  engine: 'purchase-identity-v2';
  mode: 'shadow';
  status: 'completed' | 'error';
  productionWrites: 0;
  aiCalls: 0;
  decisionKind: CorrelationDecision['kind'] | null;
  candidateCount: number;
  simulatedGraphMutated: boolean;
  snapshotComplete: boolean;
  snapshotCounts: {
    purchases: number;
    orders: number;
    shipments: number;
    invoices: number;
  } | null;
  eventType: string | null;
  identityCoverage: {
    merchant: boolean;
    carrier: boolean;
    paymentProvider: boolean;
    invoiceIssuer: boolean;
  } | null;
  durableUnresolved: {
    sourceRowsRead: number;
    eventsAccepted: number;
    eventsRejected: number;
  } | null;
  deferredResolution: {
    initialUnresolvedCount: number;
    unresolvedStored: boolean;
    recoveredEventCount: number;
    movedToReviewEventCount: number;
    unresolvedRemainingCount: number;
  } | null;
  evidencePacketSummary: EvidencePacketPrivacySummaryV1 | null;
  limitations: string[];
}

function candidateCount(decision: CorrelationDecision | null): number {
  if (!decision) return 0;
  if (decision.kind === 'LINKED') return 1;
  if (decision.kind === 'REVIEW' || decision.kind === 'PENDING') return decision.candidatePurchaseIds.length;
  return 0;
}

export async function runShoppingEmailIdentityShadow(input: {
  db: any;
  userId: string;
  email: NormalizedEmail;
}): Promise<ShoppingEmailIdentityShadowDiagnostic> {
  try {
    const loaded = await loadLegacyPurchaseIdentitySnapshot({ db: input.db, userId: input.userId });
    const durableUnresolved = await loadDurableUnresolvedSnapshotFromDb({
      db: input.db,
      userId: input.userId,
    });
    const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
    const shadow = runPurchaseIdentityShadow({
      userId: input.userId,
      document: buildEmailDocumentV1(input.email),
      snapshot: loaded.snapshot,
      unresolvedSnapshot: durableUnresolved.snapshot,
      merchantResolver,
    });

    const event = shadow.canonicalEvent;
    const limitations = [
      ...(!loaded.complete ? ['legacy_snapshot_incomplete'] : []),
      ...(durableUnresolved.eventsRejected > 0 ? ['durable_unresolved_rows_rejected'] : []),
      ...(event && !event.merchantId ? ['merchant_namespace_unresolved'] : []),
      ...(event?.paymentReference && !event.paymentProviderId ? ['payment_provider_namespace_unresolved'] : []),
      ...(event?.invoiceIdNormalized && !event.invoiceIssuerId ? ['invoice_issuer_namespace_unresolved'] : []),
    ];

    return {
      engine: 'purchase-identity-v2',
      mode: 'shadow',
      status: 'completed',
      productionWrites: 0,
      aiCalls: 0,
      decisionKind: shadow.decision?.kind ?? null,
      candidateCount: candidateCount(shadow.decision),
      simulatedGraphMutated: shadow.simulatedGraphMutated,
      snapshotComplete: loaded.complete,
      snapshotCounts: loaded.counts,
      eventType: event?.eventType ?? null,
      identityCoverage: event ? {
        merchant: Boolean(event.merchantId),
        carrier: Boolean(event.carrierId),
        paymentProvider: Boolean(event.paymentProviderId),
        invoiceIssuer: Boolean(event.invoiceIssuerId),
      } : null,
      durableUnresolved: {
        sourceRowsRead: durableUnresolved.sourceRowsRead,
        eventsAccepted: durableUnresolved.eventsAccepted,
        eventsRejected: durableUnresolved.eventsRejected,
      },
      deferredResolution: shadow.deferredResolution,
      evidencePacketSummary: shadow.evidencePacketSummary,
      limitations,
    };
  } catch {
    return {
      engine: 'purchase-identity-v2',
      mode: 'shadow',
      status: 'error',
      productionWrites: 0,
      aiCalls: 0,
      decisionKind: null,
      candidateCount: 0,
      simulatedGraphMutated: false,
      snapshotComplete: false,
      snapshotCounts: null,
      eventType: null,
      identityCoverage: null,
      durableUnresolved: null,
      deferredResolution: null,
      evidencePacketSummary: null,
      limitations: ['shadow_runtime_error'],
    };
  }
}
