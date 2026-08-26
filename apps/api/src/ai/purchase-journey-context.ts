import { isCarrierSenderDomain, isPublicMailboxSenderDomain } from '../email/sender-role.js';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { normalizeStableIdentifier } from '../purchase-identity-v2/identifier-normalizer.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';

export interface PurchaseJourneyMemoryEvent {
  purchaseId: string;
  eventType: string;
  receivedAt: string;
  sourceRole: string | null;
  merchantNamespace: string | null;
  orderId: string | null;
  trackingId: string | null;
  carrierId: string | null;
  invoiceId: string | null;
  paymentReference: string | null;
  amount: number | null;
  currency: string | null;
}

export interface PurchaseJourneyContextSummary {
  candidateCount: number;
  candidates: Array<{
    purchaseId: string;
    state: string;
    matchReasons: string[];
    orderIds: string[];
    shipments: Array<{ trackingId: string | null; carrierId: string | null; status: string | null }>;
    invoiceIds: Array<string | null>;
    paymentReferences: Array<string | null>;
    recentEvents: Array<{
      eventType: string;
      receivedAt: string;
      sourceRole: string | null;
      merchantNamespace: string | null;
      orderId: string | null;
      trackingId: string | null;
      carrierId: string | null;
      invoiceId: string | null;
      paymentReference: string | null;
      amount: number | null;
      currency: string | null;
    }>;
  }>;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function senderNamespace(document: EmailDocumentV1): string | null {
  const domain = document.sender.primaryDomain?.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '') ?? '';
  if (!domain || isCarrierSenderDomain(domain) || isPublicMailboxSenderDomain(domain)) return null;
  return `sender-domain:${domain}`;
}

export function buildStructuredEmailEvidence(document: EmailDocumentV1): string {
  const evidence = {
    sections: document.sections.map((section) => ({ type: section.type, text: section.text })).slice(0, 20),
    signals: {
      orderNumbers: document.signals.orderNumbers.slice(0, 20),
      trackingNumbers: document.signals.trackingNumbers.slice(0, 20),
      amounts: document.signals.amounts.slice(0, 30).map(({ amount, currency }) => ({ amount, currency })),
      shippingAmounts: document.signals.shippingAmounts.slice(0, 10).map(({ amount, currency }) => ({ amount, currency })),
      codAmounts: document.signals.codAmounts.slice(0, 10).map(({ amount, currency }) => ({ amount, currency })),
      couriers: document.signals.couriers.slice(0, 10),
      paymentMethods: document.signals.paymentMethods.slice(0, 10),
      shippingMethods: document.signals.shippingMethods.slice(0, 10),
      products: document.signals.products.slice(0, 30).map((product) => ({
        name: product.name,
        quantity: product.quantity,
        unitPrice: product.unitPrice ?? null,
        totalPrice: product.totalPrice ?? null,
        currency: product.currency ?? null,
      })),
    },
    attachments: document.attachments.slice(0, 20).map((attachment) => ({
      filename: attachment.filename ?? null,
      contentType: attachment.contentType ?? null,
    })),
  };
  return JSON.stringify(evidence);
}

export function summarizePurchaseJourneyContext(
  document: EmailDocumentV1,
  snapshot: PurchaseIdentitySnapshot,
  maxCandidates = 5,
  priorEvents: PurchaseJourneyMemoryEvent[] = [],
): PurchaseJourneyContextSummary {
  const orderIds = new Set(document.signals.orderNumbers.map(normalizeStableIdentifier).filter(Boolean));
  const trackingIds = new Set(document.signals.trackingNumbers.map(normalizeStableIdentifier).filter(Boolean));
  const namespace = senderNamespace(document);
  const scores = new Map<string, number>();
  const reasons = new Map<string, Set<string>>();

  function addCandidate(purchaseId: string, score: number, reason: string) {
    scores.set(purchaseId, (scores.get(purchaseId) ?? 0) + score);
    const set = reasons.get(purchaseId) ?? new Set<string>();
    set.add(reason);
    reasons.set(purchaseId, set);
  }

  for (const order of snapshot.orders) {
    const normalized = normalizeStableIdentifier(order.orderId);
    if (normalized && orderIds.has(normalized)) addCandidate(order.purchaseId, 100, 'current_email_order_id_exact');
    if (namespace && order.merchantNamespace?.trim().toLowerCase() === namespace) {
      addCandidate(order.purchaseId, 30, 'same_merchant_sender_namespace');
    }
  }

  for (const shipment of snapshot.shipments) {
    const normalized = normalizeStableIdentifier(shipment.trackingId);
    if (normalized && trackingIds.has(normalized)) addCandidate(shipment.purchaseId, 120, 'current_email_tracking_id_exact');
  }

  for (const event of priorEvents) {
    const normalizedOrder = normalizeStableIdentifier(event.orderId);
    if (normalizedOrder && orderIds.has(normalizedOrder)) {
      addCandidate(event.purchaseId, 110, 'current_email_order_id_exact_prior_event');
    }
    const normalizedTracking = normalizeStableIdentifier(event.trackingId);
    if (normalizedTracking && trackingIds.has(normalizedTracking)) {
      addCandidate(event.purchaseId, 130, 'current_email_tracking_id_exact_prior_event');
    }
    if (namespace && event.merchantNamespace?.trim().toLowerCase() === namespace) {
      addCandidate(event.purchaseId, 35, 'same_merchant_sender_namespace_prior_event');
    }
  }

  const purchaseById = new Map(snapshot.purchases.map((purchase) => [purchase.purchaseId, purchase]));
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, maxCandidates));

  const candidates = ranked.flatMap(([purchaseId]) => {
    const purchase = purchaseById.get(purchaseId);
    if (!purchase) return [];
    const recentEvents = priorEvents
      .filter((event) => event.purchaseId === purchaseId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 12)
      .map((event) => ({
        eventType: event.eventType,
        receivedAt: event.receivedAt,
        sourceRole: event.sourceRole,
        merchantNamespace: event.merchantNamespace,
        orderId: event.orderId,
        trackingId: event.trackingId,
        carrierId: event.carrierId,
        invoiceId: event.invoiceId,
        paymentReference: event.paymentReference,
        amount: event.amount,
        currency: event.currency,
      }));
    return [{
      purchaseId,
      state: purchase.state,
      matchReasons: [...(reasons.get(purchaseId) ?? [])].sort(),
      orderIds: unique(snapshot.orders.filter((item) => item.purchaseId === purchaseId).map((item) => item.orderId)).slice(0, 10),
      shipments: snapshot.shipments.filter((item) => item.purchaseId === purchaseId).slice(0, 10).map((item) => ({
        trackingId: item.trackingId,
        carrierId: item.carrierId,
        status: item.status,
      })),
      invoiceIds: unique(snapshot.invoices.filter((item) => item.purchaseId === purchaseId).map((item) => item.invoiceId)).slice(0, 10),
      paymentReferences: unique(snapshot.payments.filter((item) => item.purchaseId === purchaseId).map((item) => item.paymentReference)).slice(0, 10),
      recentEvents,
    }];
  });

  return { candidateCount: candidates.length, candidates };
}

export function buildPurchaseJourneyContext(
  document: EmailDocumentV1,
  snapshot: PurchaseIdentitySnapshot,
  maxCandidates = 5,
  priorEvents: PurchaseJourneyMemoryEvent[] = [],
): string | null {
  const summary = summarizePurchaseJourneyContext(document, snapshot, maxCandidates, priorEvents);
  return summary.candidateCount > 0 ? JSON.stringify(summary) : null;
}
