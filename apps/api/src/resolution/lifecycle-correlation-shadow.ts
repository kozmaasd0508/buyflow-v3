export type CorrelationEventType =
  | 'order_created'
  | 'order_updated'
  | 'payment_completed'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'refund'
  | 'return'
  | 'other';

export interface CorrelationEvidence {
  sourceEmailId: string;
  userId: string;
  eventType: CorrelationEventType;
  senderDomain: string;
  merchant: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  invoiceNumber: string | null;
  receivedAt: string;
}

export interface CorrelationAssignment {
  sourceEmailId: string;
  purchaseKey: string | null;
  decision: 'linked' | 'review' | 'unlinked';
  reason:
    | 'order_anchor'
    | 'exact_order_number'
    | 'exact_tracking_number'
    | 'invoice_order_number'
    | 'ambiguous_order_number'
    | 'ambiguous_tracking_number'
    | 'no_safe_anchor';
}

export interface CorrelationPurchaseGroup {
  purchaseKey: string;
  userId: string;
  merchant: string | null;
  orderNumber: string;
  sourceEmailIds: string[];
}

export interface CorrelationShadowResult {
  groups: CorrelationPurchaseGroup[];
  assignments: CorrelationAssignment[];
  productionWrites: 0;
  aiCalls: 0;
}

function normalizeId(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function canonicalMerchant(value: string | null | undefined): string {
  let merchant = normalizeText(value)
    .replace(/^www\./, '')
    .replace(/\.(hu|com|eu|net|shop)$/i, '')
    .trim();

  // Same storefront/merchant identity observed in real lifecycle data.
  // This mapping only canonicalizes identity; an exact normalized order
  // number is still required before any automatic correlation occurs.
  if (merchant === 'sport8') merchant = 'forproshop';

  return merchant;
}

function anchorKey(evidence: CorrelationEvidence): string | null {
  const order = normalizeId(evidence.orderNumber);
  if (!evidence.userId || !order) return null;
  const merchant = canonicalMerchant(evidence.merchant) || canonicalMerchant(evidence.senderDomain);
  return `${evidence.userId}::${merchant}::${order}`;
}

export function correlateLifecycleShadow(
  evidenceRows: CorrelationEvidence[],
): CorrelationShadowResult {
  const orderAnchors = evidenceRows.filter(
    (row) => row.eventType === 'order_created' && normalizeId(row.orderNumber),
  );

  const groups = new Map<string, CorrelationPurchaseGroup>();
  const anchorByOrder = new Map<string, string[]>();
  const trackingToKeys = new Map<string, Set<string>>();

  for (const anchor of orderAnchors) {
    const key = anchorKey(anchor);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.sourceEmailIds.includes(anchor.sourceEmailId)) existing.sourceEmailIds.push(anchor.sourceEmailId);
    } else {
      groups.set(key, {
        purchaseKey: key,
        userId: anchor.userId,
        merchant: anchor.merchant,
        orderNumber: anchor.orderNumber!.trim(),
        sourceEmailIds: [anchor.sourceEmailId],
      });
    }
    const order = normalizeId(anchor.orderNumber);
    const orderKey = `${anchor.userId}::${order}`;
    const keys = new Set(anchorByOrder.get(orderKey) ?? []);
    keys.add(key);
    anchorByOrder.set(orderKey, [...keys]);
    const tracking = normalizeId(anchor.trackingNumber);
    if (tracking) {
      const set = trackingToKeys.get(`${anchor.userId}::${tracking}`) ?? new Set<string>();
      set.add(key);
      trackingToKeys.set(`${anchor.userId}::${tracking}`, set);
    }
  }

  const assignments: CorrelationAssignment[] = [];

  for (const row of evidenceRows) {
    const directKey = anchorKey(row);
    if (row.eventType === 'order_created' && directKey && groups.has(directKey)) {
      assignments.push({
        sourceEmailId: row.sourceEmailId,
        purchaseKey: directKey,
        decision: 'linked',
        reason: 'order_anchor',
      });
      continue;
    }

    const order = normalizeId(row.orderNumber);
    if (order) {
      const matches = anchorByOrder.get(`${row.userId}::${order}`) ?? [];
      if (matches.length === 1) {
        const key = matches[0]!;
        const group = groups.get(key);
        if (group && !group.sourceEmailIds.includes(row.sourceEmailId)) group.sourceEmailIds.push(row.sourceEmailId);
        const tracking = normalizeId(row.trackingNumber);
        if (tracking) {
          const set = trackingToKeys.get(`${row.userId}::${tracking}`) ?? new Set<string>();
          set.add(key);
          trackingToKeys.set(`${row.userId}::${tracking}`, set);
        }
        assignments.push({
          sourceEmailId: row.sourceEmailId,
          purchaseKey: key,
          decision: 'linked',
          reason: row.eventType === 'invoice_or_receipt' ? 'invoice_order_number' : 'exact_order_number',
        });
        continue;
      }
      if (matches.length > 1) {
        assignments.push({
          sourceEmailId: row.sourceEmailId,
          purchaseKey: null,
          decision: 'review',
          reason: 'ambiguous_order_number',
        });
        continue;
      }
    }

    const tracking = normalizeId(row.trackingNumber);
    if (tracking) {
      const matches = [...(trackingToKeys.get(`${row.userId}::${tracking}`) ?? new Set<string>())];
      if (matches.length === 1) {
        const key = matches[0]!;
        const group = groups.get(key);
        if (group && !group.sourceEmailIds.includes(row.sourceEmailId)) group.sourceEmailIds.push(row.sourceEmailId);
        assignments.push({
          sourceEmailId: row.sourceEmailId,
          purchaseKey: key,
          decision: 'linked',
          reason: 'exact_tracking_number',
        });
        continue;
      }
      if (matches.length > 1) {
        assignments.push({
          sourceEmailId: row.sourceEmailId,
          purchaseKey: null,
          decision: 'review',
          reason: 'ambiguous_tracking_number',
        });
        continue;
      }
    }

    assignments.push({
      sourceEmailId: row.sourceEmailId,
      purchaseKey: null,
      decision: 'review',
      reason: 'no_safe_anchor',
    });
  }

  return {
    groups: [...groups.values()].sort((a, b) => a.purchaseKey.localeCompare(b.purchaseKey)),
    assignments,
    productionWrites: 0,
    aiCalls: 0,
  };
}
