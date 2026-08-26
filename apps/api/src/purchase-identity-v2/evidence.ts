import type { CanonicalEvent, EvidenceEdge, PurchaseIdentitySnapshot } from './types.js';
import {
  invoiceIdentityKey,
  orderIdentityKey,
  paymentIdentityKey,
  shipmentIdentityKey,
} from './identity-keys.js';
import { decoratedOrderReviewBase, merchantNamespaceOrderKey } from './candidate-index.js';
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
    const canonicalNamespaceMatch = Boolean(eventKey && matchingOrders.some(
      (item) => orderIdentityKey(event.userId, item.merchantId, item.orderId) === eventKey,
    ));
    const senderNamespaceKey = merchantNamespaceOrderKey(event.userId, event.merchantNamespace, orderId);
    const senderNamespaceMatch = event.sourceRole === 'merchant' && Boolean(senderNamespaceKey && matchingOrders.some(
      (item) => merchantNamespaceOrderKey(event.userId, item.merchantNamespace, item.orderId) === senderNamespaceKey,
    ));
    const hardNamespaceMatch = canonicalNamespaceMatch || senderNamespaceMatch;
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: event.eventType === 'invoice_created' ? 'INVOICE_ORDER_ID_EXACT' : 'ORDER_ID_EXACT',
      strength: hardNamespaceMatch ? 'hard' : 'soft',
      score: hardNamespaceMatch ? 100 : 35,
      explanation: canonicalNamespaceMatch
        ? `exact canonical order identity ${eventKey}`
        : senderNamespaceMatch
          ? `exact order identity inside merchant sender namespace ${senderNamespaceKey}`
          : `order id ${orderId} matched without merchant namespace agreement`,
    });
    if (senderNamespaceMatch) {
      edges.push({
        sourceEventId: event.eventId,
        candidatePurchaseId: purchaseId,
        evidenceType: 'MERCHANT_NAMESPACE_MATCH',
        strength: 'soft',
        score: 25,
        explanation: `merchant sender namespace ${event.merchantNamespace}`,
      });
    }
  }

  const relation = event.orderRelation;
  const relationParent = normalizeStableIdentifier(relation?.parentOrderIdNormalized ?? relation?.parentOrderIdRaw);
  const relationChild = normalizeStableIdentifier(relation?.childOrderIdNormalized ?? relation?.childOrderIdRaw);
  const validRelationShape = Boolean(
    relation
    && relationParent
    && relationChild
    && orderId
    && relationParent !== relationChild
    && relationChild === orderId,
  );
  const matchingParentOrders = validRelationShape
    ? orders.filter((item) => normalizeStableIdentifier(item.orderId) === relationParent)
    : [];

  if (relation && matchingParentOrders.length > 0) {
    const canonicalParentKey = orderIdentityKey(event.userId, event.merchantId, relationParent);
    const canonicalNamespaceMatch = Boolean(canonicalParentKey && matchingParentOrders.some(
      (item) => orderIdentityKey(event.userId, item.merchantId, item.orderId) === canonicalParentKey,
    ));
    const senderParentKey = merchantNamespaceOrderKey(event.userId, event.merchantNamespace, relationParent);
    const senderNamespaceMatch = event.sourceRole === 'merchant' && Boolean(senderParentKey && matchingParentOrders.some(
      (item) => merchantNamespaceOrderKey(event.userId, item.merchantNamespace, item.orderId) === senderParentKey,
    ));
    const hasExplicitProvenance = relation.provenance.length > 0;
    const hardRelation = hasExplicitProvenance && (canonicalNamespaceMatch || senderNamespaceMatch);

    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'PARENT_CHILD_ORDER',
      strength: hardRelation ? 'hard' : 'soft',
      score: hardRelation ? 100 : 35,
      explanation: hardRelation
        ? `explicit ${relation.relation} order relation ${relationChild} -> parent ${relationParent} inside compatible merchant identity`
        : `explicit order relation ${relationChild} -> parent ${relationParent} found without sufficient merchant/provenance agreement`,
    });
  }

  const reviewIdentity = decoratedOrderReviewBase(orderId) ?? orderId;
  const reviewNamespaceKey = event.sourceRole === 'merchant'
    ? merchantNamespaceOrderKey(event.userId, event.merchantNamespace, reviewIdentity)
    : null;
  const decoratedReviewMatch = reviewNamespaceKey && orderId
    ? orders.find((item) => {
        const storedOrderId = normalizeStableIdentifier(item.orderId);
        if (!storedOrderId || storedOrderId === orderId) return false;
        const storedReviewIdentity = decoratedOrderReviewBase(storedOrderId) ?? storedOrderId;
        return merchantNamespaceOrderKey(event.userId, item.merchantNamespace, storedReviewIdentity) === reviewNamespaceKey;
      })
    : undefined;

  if (decoratedReviewMatch) {
    const storedOrderId = normalizeStableIdentifier(decoratedReviewMatch.orderId);
    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'ORDER_ID_DECORATED_REVIEW_ALIAS',
      strength: 'soft',
      score: 15,
      explanation: `review-only decorated order-id relation ${orderId} ~ ${storedOrderId} inside merchant sender namespace ${event.merchantNamespace}`,
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

    // Journey-memory bridge: a merchant shipment email may establish a tracking
    // identity before the carrier is known. A later authenticated/known carrier
    // event may safely fill that missing namespace only when this tracking id is
    // unique for the user and the stored shipment has no conflicting carrier.
    const sameUserTrackingShipments = snapshot.shipments.filter((item) => {
      if (!trackingId || normalizeStableIdentifier(item.trackingId) !== trackingId) return false;
      const owner = snapshot.purchases.find((candidate) => candidate.purchaseId === item.purchaseId);
      return owner?.userId === event.userId;
    });
    const uniqueCarrierNamespaceUpgrade = Boolean(
      event.sourceRole === 'carrier'
      && event.carrierId
      && sameUserTrackingShipments.length === 1
      && !sameUserTrackingShipments[0]?.carrierId,
    );
    const hardTrackingMatch = namespaceMatch || uniqueCarrierNamespaceUpgrade;

    edges.push({
      sourceEventId: event.eventId,
      candidatePurchaseId: purchaseId,
      evidenceType: 'TRACKING_ID_EXACT',
      strength: hardTrackingMatch ? 'hard' : 'soft',
      score: hardTrackingMatch ? 100 : 35,
      explanation: namespaceMatch
        ? `exact shipment identity ${eventKey}`
        : uniqueCarrierNamespaceUpgrade
          ? `unique tracking identity ${trackingId} upgraded from unknown carrier namespace to ${event.carrierId}`
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
