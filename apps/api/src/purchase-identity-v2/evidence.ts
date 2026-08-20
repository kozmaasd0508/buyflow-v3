import type { CanonicalEvent, EvidenceEdge, PurchaseIdentitySnapshot } from './types.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';

export function buildEvidenceForCandidate(
  event: CanonicalEvent,
  purchaseId: string,
  snapshot: PurchaseIdentitySnapshot,
): EvidenceEdge[] {
  const purchase = snapshot.purchases.find((item) => item.purchaseId === purchaseId);
  if (!purchase) return [];

  const edges: EvidenceEdge[] = [];
  const orderId = normalizeStableIdentifier(event.orderIdNormalized ?? event.orderIdRaw);
  const trackingId = normalizeStableIdentifier(event.trackingIdNormalized ?? event.trackingIdRaw);
  const paymentReference = normalizeStableIdentifier(event.paymentReference);
  const invoiceId = normalizeStableIdentifier(event.invoiceIdNormalized ?? event.invoiceIdRaw);

  const orders = snapshot.orders.filter((item) => item.purchaseId === purchaseId);
  const shipments = snapshot.shipments.filter((item) => item.purchaseId === purchaseId);
  const payments = snapshot.payments.filter((item) => item.purchaseId === purchaseId);
  const invoices = snapshot.invoices.filter((item) => item.purchaseId === purchaseId);

  if (orderId && orders.some((item) => normalizeStableIdentifier(item.orderId) === orderId)) {
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: event.eventType === 'invoice_created' ? 'INVOICE_ORDER_ID_EXACT' : 'ORDER_ID_EXACT',
      strength: 'hard',
      score: 100,
      explanation: `exact normalized order id ${orderId}`,
    });
  }

  if (trackingId && shipments.some((item) => normalizeStableIdentifier(item.trackingId) === trackingId)) {
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'TRACKING_ID_EXACT',
      strength: 'hard',
      score: 100,
      explanation: `exact normalized tracking id ${trackingId}`,
    });
  }

  if (paymentReference && payments.some((item) => normalizeStableIdentifier(item.paymentReference) === paymentReference)) {
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'PAYMENT_REFERENCE_EXACT',
      strength: 'hard',
      score: 100,
      explanation: `exact payment reference ${paymentReference}`,
    });
  }

  if (invoiceId && invoices.some((item) => normalizeStableIdentifier(item.invoiceId) === invoiceId)) {
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'INVOICE_ORDER_ID_EXACT',
      strength: 'hard',
      score: 95,
      explanation: `exact invoice id ${invoiceId}`,
    });
  }

  if (event.merchantId && purchase.canonicalMerchantId && event.merchantId === purchase.canonicalMerchantId) {
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'MERCHANT_ID_MATCH',
      strength: 'soft',
      score: 20,
      explanation: `canonical merchant ${event.merchantId}`,
    });
  }

  return edges;
}
