import type { CanonicalEvent, EvidenceEdge, PurchaseIdentitySnapshot } from './types.js';
import {
  invoiceIdentityKey,
  orderIdentityKey,
  paymentIdentityKey,
  shipmentIdentityKey,
} from './identity-keys.js';
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

  const matchingOrders = orderId
    ? orders.filter((item) => normalizeStableIdentifier(item.orderId) === orderId)
    : [];
  if (matchingOrders.length > 0) {
    const eventKey = orderIdentityKey(event.userId, event.merchantId, orderId);
    const namespaceMatch = Boolean(eventKey && matchingOrders.some(
      (item) => orderIdentityKey(event.userId, item.merchantId, item.orderId) === eventKey,
    ));
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: event.eventType === 'invoice_created' ? 'INVOICE_ORDER_ID_EXACT' : 'ORDER_ID_EXACT',
      strength: namespaceMatch ? 'hard' : 'soft',
      score: namespaceMatch ? 100 : 35,
      explanation: namespaceMatch
        ? `exact order identity ${eventKey}`
        : `order id ${orderId} matched without canonical merchant namespace agreement`,
    });
  }

  const matchingShipments = trackingId
    ? shipments.filter((item) => normalizeStableIdentifier(item.trackingId) === trackingId)
    : [];
  if (matchingShipments.length > 0) {
    const eventKey = shipmentIdentityKey(event.userId, event.carrierId, trackingId);
    const namespaceMatch = Boolean(eventKey && matchingShipments.some(
      (item) => shipmentIdentityKey(event.userId, item.carrierId, item.trackingId) === eventKey,
    ));
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'TRACKING_ID_EXACT',
      strength: namespaceMatch ? 'hard' : 'soft',
      score: namespaceMatch ? 100 : 35,
      explanation: namespaceMatch
        ? `exact shipment identity ${eventKey}`
        : `tracking id ${trackingId} matched without carrier namespace agreement`,
    });
  }

  const matchingPayments = paymentReference
    ? payments.filter((item) => normalizeStableIdentifier(item.paymentReference) === paymentReference)
    : [];
  if (matchingPayments.length > 0) {
    const eventKey = paymentIdentityKey(event.userId, event.paymentProviderId, paymentReference);
    const namespaceMatch = Boolean(eventKey && matchingPayments.some(
      (item) => paymentIdentityKey(event.userId, item.providerId, item.paymentReference) === eventKey,
    ));
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'PAYMENT_REFERENCE_EXACT',
      strength: namespaceMatch ? 'hard' : 'soft',
      score: namespaceMatch ? 100 : 35,
      explanation: namespaceMatch
        ? `exact payment identity ${eventKey}`
        : `payment reference ${paymentReference} matched without provider namespace agreement`,
    });
  }

  const matchingInvoices = invoiceId
    ? invoices.filter((item) => normalizeStableIdentifier(item.invoiceId) === invoiceId)
    : [];
  if (matchingInvoices.length > 0) {
    const eventKey = invoiceIdentityKey(event.userId, event.invoiceIssuerId, invoiceId);
    const namespaceMatch = Boolean(eventKey && matchingInvoices.some(
      (item) => invoiceIdentityKey(event.userId, item.issuerId, item.invoiceId) === eventKey,
    ));
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'INVOICE_ORDER_ID_EXACT',
      strength: namespaceMatch ? 'hard' : 'soft',
      score: namespaceMatch ? 95 : 30,
      explanation: namespaceMatch
        ? `exact invoice identity ${eventKey}`
        : `invoice id ${invoiceId} matched without issuer namespace agreement`,
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
