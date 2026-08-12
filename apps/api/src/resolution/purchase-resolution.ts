import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';

export type ResolutionEventType =
  | 'order_created'
  | 'order_updated'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'subscription'
  | 'refund'
  | 'return'
  | 'other';

export interface ResolutionEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  eventType: ResolutionEventType;
  merchant: string | null;
  orderNumber: string | null;
  confidence: number;
  receivedAt: string;
}

export type PurchaseResolutionDecision =
  | 'create_direct'
  | 'create_corroborated'
  | 'review'
  | 'lifecycle_only';

export interface PurchaseResolutionCandidate {
  key: string;
  userId: string;
  senderDomain: string;
  merchant: string | null;
  orderNumber: string;
  decision: PurchaseResolutionDecision;
  confidence: number;
  evidenceCount: number;
  orderCreatedEvidenceCount: number;
  corroboratingEvidenceCount: number;
  reasons: string[];
  sourceEmailIds: string[];
}

const CORROBORATING_EVENT_TYPES = new Set<ResolutionEventType>([
  'order_updated',
  'shipment',
  'delivery',
  'invoice_or_receipt',
]);

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

function normalizeOrderNumber(orderNumber: string): string {
  return orderNumber.trim().toLowerCase();
}

function candidateKey(evidence: ResolutionEvidence): string | null {
  if (!evidence.userId || !evidence.orderNumber) return null;
  const senderDomain = normalizeDomain(evidence.senderDomain);
  const orderNumber = normalizeOrderNumber(evidence.orderNumber);
  if (!senderDomain || !orderNumber) return null;
  return `${evidence.userId}::${senderDomain}::${orderNumber}`;
}

export function resolvePurchaseCandidates(
  evidenceRows: ResolutionEvidence[],
): PurchaseResolutionCandidate[] {
  const groups = new Map<string, ResolutionEvidence[]>();

  for (const evidence of evidenceRows) {
    const key = candidateKey(evidence);
    if (!key) continue;
    const existing = groups.get(key) ?? [];
    existing.push(evidence);
    groups.set(key, existing);
  }

  const candidates: PurchaseResolutionCandidate[] = [];

  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt),
    );
    const userId = sorted[0]?.userId ?? '';
    const senderDomain = normalizeDomain(sorted[0]?.senderDomain ?? '');
    const orderNumber = sorted[0]?.orderNumber?.trim() ?? '';
    const carrierSender = isCarrierSenderDomain(senderDomain);
    const orderCreated = sorted.filter(
      (row) => row.eventType === 'order_created' && !carrierSender,
    );
    const supporting = sorted.filter(
      (row) => CORROBORATING_EVENT_TYPES.has(row.eventType),
    );
    const strongestOrder = orderCreated.reduce<ResolutionEvidence | null>(
      (best, row) => (!best || row.confidence > best.confidence ? row : best),
      null,
    );
    const merchant = strongestOrder?.merchant ?? sorted.find((row) => row.merchant)?.merchant ?? null;
    const reasons: string[] = [];

    let decision: PurchaseResolutionDecision;
    let confidence = strongestOrder?.confidence ?? 0;

    if (carrierSender) {
      decision = 'lifecycle_only';
      reasons.push('carrier_domain_never_creates_purchase');
    } else if (!strongestOrder) {
      decision = 'lifecycle_only';
      reasons.push('no_order_created_evidence');
    } else if (!strongestOrder.merchant || !strongestOrder.orderNumber) {
      decision = 'review';
      reasons.push('order_created_missing_identity');
    } else if (strongestOrder.confidence >= 0.9) {
      decision = 'create_direct';
      reasons.push('high_confidence_order_created');
    } else if (
      strongestOrder.confidence >= 0.8 &&
      supporting.some((row) => row.sourceEmailId !== strongestOrder.sourceEmailId)
    ) {
      decision = 'create_corroborated';
      confidence = Math.min(0.99, strongestOrder.confidence + 0.08);
      reasons.push('order_created_corroborated_by_independent_lifecycle_evidence');
    } else {
      decision = 'review';
      reasons.push('order_created_below_direct_threshold_without_corroboration');
    }

    candidates.push({
      key,
      userId,
      senderDomain,
      merchant,
      orderNumber,
      decision,
      confidence,
      evidenceCount: sorted.length,
      orderCreatedEvidenceCount: orderCreated.length,
      corroboratingEvidenceCount: supporting.length,
      reasons,
      sourceEmailIds: sorted.map((row) => row.sourceEmailId),
    });
  }

  return candidates.sort((a, b) => a.key.localeCompare(b.key));
}
