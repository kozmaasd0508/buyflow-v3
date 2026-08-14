export type ExistingPurchaseResolutionEventType =
  | 'order_updated'
  | 'payment_completed'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'refund'
  | 'return';

export interface ExistingPurchaseIdentity {
  purchaseId: string;
  userId: string;
  merchantDomain: string | null;
  merchantName: string | null;
  orderNumber: string | null;
  totalAmount: number | null;
  currency: string | null;
  orderedAt: string | null;
}

export interface ExistingShipmentIdentity {
  purchaseId: string;
  userId: string;
  trackingNumber: string | null;
}

export interface LinkedThreadIdentity {
  purchaseId: string;
  userId: string;
  providerThreadId: string | null;
}

export interface ExistingPurchaseEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  providerThreadId: string | null;
  eventType: ExistingPurchaseResolutionEventType;
  merchant: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  total: number | null;
  currency: string | null;
  confidence: number;
  receivedAt: string;
}

export type ExistingPurchaseResolutionDecision = 'linkable' | 'review' | 'unmatched';

export interface ExistingPurchaseResolutionCandidate {
  sourceEmailId: string;
  userId: string;
  purchaseId: string | null;
  decision: ExistingPurchaseResolutionDecision;
  score: number;
  runnerUpScore: number;
  reasons: string[];
}

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function merchantLooksSame(a: string | null, b: string | null): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left === right || (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left)));
}

function currencyEqual(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.trim().toUpperCase() === b.trim().toUpperCase());
}

function amountClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
}

function dayDistance(a: string, b: string | null): number | null {
  if (!b) return null;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.abs(left - right) / 86_400_000;
}

export function resolveExistingPurchase(
  evidence: ExistingPurchaseEvidence,
  purchases: ExistingPurchaseIdentity[],
  shipments: ExistingShipmentIdentity[] = [],
  linkedThreads: LinkedThreadIdentity[] = [],
): ExistingPurchaseResolutionCandidate {
  const ownPurchases = purchases.filter((purchase) => purchase.userId === evidence.userId);
  const tracking = normalizeIdentifier(evidence.trackingNumber);
  const order = normalizeIdentifier(evidence.orderNumber);
  const sender = normalizeDomain(evidence.senderDomain);

  const trackingPurchaseIds = new Set(
    shipments
      .filter((shipment) => shipment.userId === evidence.userId && tracking && normalizeIdentifier(shipment.trackingNumber) === tracking)
      .map((shipment) => shipment.purchaseId),
  );
  const threadPurchaseIds = new Set(
    linkedThreads
      .filter((thread) => thread.userId === evidence.userId && evidence.providerThreadId && thread.providerThreadId === evidence.providerThreadId)
      .map((thread) => thread.purchaseId),
  );

  const scored = ownPurchases.map((purchase) => {
    let score = 0;
    const reasons: string[] = [];
    const purchaseOrder = normalizeIdentifier(purchase.orderNumber);

    if (tracking && trackingPurchaseIds.has(purchase.purchaseId)) {
      score += 140;
      reasons.push('exact_tracking_match');
    }
    if (evidence.providerThreadId && threadPurchaseIds.has(purchase.purchaseId)) {
      score += 130;
      reasons.push('linked_email_thread_match');
    }
    if (order && purchaseOrder && order === purchaseOrder) {
      const points = order.length >= 6 ? 105 : order.length === 5 ? 75 : 55;
      score += points;
      reasons.push('exact_order_number_match');
    }
    if (sender && normalizeDomain(purchase.merchantDomain) === sender) {
      score += 35;
      reasons.push('merchant_domain_match');
    }
    if (merchantLooksSame(evidence.merchant, purchase.merchantName)) {
      score += 25;
      reasons.push('merchant_name_match');
    }
    if (amountClose(evidence.total, purchase.totalAmount) && currencyEqual(evidence.currency, purchase.currency)) {
      score += 25;
      reasons.push('amount_currency_match');
    }

    const distance = dayDistance(evidence.receivedAt, purchase.orderedAt);
    if (distance !== null) {
      if (distance <= 2) {
        score += 15;
        reasons.push('within_2_days');
      } else if (distance <= 7) {
        score += 10;
        reasons.push('within_7_days');
      } else if (distance <= 30) {
        score += 4;
        reasons.push('within_30_days');
      }
    }

    return { purchase, score, reasons };
  }).sort((a, b) => b.score - a.score || a.purchase.purchaseId.localeCompare(b.purchase.purchaseId));

  const best = scored[0];
  const runnerUpScore = scored[1]?.score ?? 0;
  if (!best || best.score === 0) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: null,
      decision: 'unmatched',
      score: 0,
      runnerUpScore,
      reasons: ['no_matching_purchase_signals'],
    };
  }

  const strongAnchor = best.reasons.some((reason) =>
    reason === 'exact_tracking_match' ||
    reason === 'linked_email_thread_match' ||
    (reason === 'exact_order_number_match' && order.length >= 6),
  );
  const shortOrderWithSecondary =
    best.reasons.includes('exact_order_number_match') &&
    order.length > 0 &&
    order.length < 6 &&
    best.reasons.some((reason) => ['merchant_domain_match', 'merchant_name_match', 'amount_currency_match'].includes(reason));
  const ambiguous = runnerUpScore > 0 && best.score >= 80 && best.score - runnerUpScore < 30;

  if (evidence.confidence < 0.8) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: best.purchase.purchaseId,
      decision: 'review',
      score: best.score,
      runnerUpScore,
      reasons: [...best.reasons, 'source_confidence_below_auto_link_threshold'],
    };
  }

  if (best.score >= 110 && (strongAnchor || shortOrderWithSecondary) && !ambiguous) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: best.purchase.purchaseId,
      decision: 'linkable',
      score: best.score,
      runnerUpScore,
      reasons: best.reasons,
    };
  }

  if (best.score >= 80) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: best.purchase.purchaseId,
      decision: 'review',
      score: best.score,
      runnerUpScore,
      reasons: [...best.reasons, ...(ambiguous ? ['top_candidates_too_close'] : ['insufficient_safe_link_score'])],
    };
  }

  return {
    sourceEmailId: evidence.sourceEmailId,
    userId: evidence.userId,
    purchaseId: null,
    decision: 'unmatched',
    score: best.score,
    runnerUpScore,
    reasons: [...best.reasons, 'insufficient_match_score'],
  };
}
