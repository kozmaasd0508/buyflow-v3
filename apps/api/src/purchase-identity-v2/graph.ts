import { decideCorrelation } from './decision-engine.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import type {
  CanonicalEvent,
  CorrelationDecision,
  InvoiceIdentity,
  OrderIdentity,
  PaymentIdentity,
  PurchaseIdentity,
  PurchaseIdentitySnapshot,
  ShipmentIdentity,
} from './types.js';

export interface GraphApplyResult {
  decision: CorrelationDecision;
  snapshot: PurchaseIdentitySnapshot;
  mutated: boolean;
  productionWrites: 0;
  aiCalls: 0;
}

export interface ParentChildOrderHint {
  parentOrderId: string;
  childOrderId: string;
  merchantId: string | null;
  relation: 'child' | 'split_child' | 'replacement';
}

export class PurchaseIdentityGraph {
  private snapshotState: PurchaseIdentitySnapshot;

  constructor(initial?: PurchaseIdentitySnapshot) {
    this.snapshotState = initial ? cloneSnapshot(initial) : emptySnapshot();
  }

  snapshot(): PurchaseIdentitySnapshot {
    return cloneSnapshot(this.snapshotState);
  }

  applyEvent(event: CanonicalEvent): GraphApplyResult {
    const decision = decideCorrelation(event, this.snapshotState);

    if (decision.kind === 'REVIEW' || decision.kind === 'UNLINKED') {
      return this.result(decision, false);
    }

    if (decision.kind === 'NEW_PURCHASE') {
      const purchaseId = `purchase:${event.userId}:${event.merchantId}:${normalizeStableIdentifier(event.orderIdNormalized ?? event.orderIdRaw)}`;
      if (!this.snapshotState.purchases.some((item) => item.purchaseId === purchaseId)) {
        const orderIdentityId = `order:${purchaseId}:primary`;
        this.snapshotState.purchases.push({
          purchaseId,
          userId: event.userId,
          canonicalMerchantId: event.merchantId,
          primaryOrderIdentityId: orderIdentityId,
          state: stateFromEvent(event),
        });
        this.snapshotState.orders.push({
          orderIdentityId,
          purchaseId,
          merchantId: event.merchantId,
          orderId: event.orderIdNormalized ?? event.orderIdRaw ?? '',
          relation: 'primary',
          parentOrderIdentityId: null,
        });
      }
      this.attachEventEntities(event, purchaseId);
      return this.result(decision, true);
    }

    this.attachEventEntities(event, decision.purchaseId);
    const purchase = this.snapshotState.purchases.find((item) => item.purchaseId === decision.purchaseId);
    if (purchase) purchase.state = mergeState(purchase.state, stateFromEvent(event));
    return this.result(decision, true);
  }

  addParentChildOrder(userId: string, hint: ParentChildOrderHint): boolean {
    const parentId = normalizeStableIdentifier(hint.parentOrderId);
    const childId = normalizeStableIdentifier(hint.childOrderId);
    if (!parentId || !childId || parentId === childId) return false;

    const parentCandidates = this.snapshotState.orders.filter((order) => {
      if (normalizeStableIdentifier(order.orderId) !== parentId) return false;
      const purchase = this.snapshotState.purchases.find((item) => item.purchaseId === order.purchaseId);
      return purchase?.userId === userId && (!hint.merchantId || order.merchantId === hint.merchantId);
    });
    if (parentCandidates.length !== 1) return false;

    const parent = parentCandidates[0]!;
    const conflictingChild = this.snapshotState.orders.filter((order) => {
      if (normalizeStableIdentifier(order.orderId) !== childId) return false;
      const purchase = this.snapshotState.purchases.find((item) => item.purchaseId === order.purchaseId);
      return purchase?.userId === userId;
    });
    if (conflictingChild.some((order) => order.purchaseId !== parent.purchaseId)) return false;

    if (!conflictingChild.some((order) => order.purchaseId === parent.purchaseId)) {
      this.snapshotState.orders.push({
        orderIdentityId: `order:${parent.purchaseId}:${childId}`,
        purchaseId: parent.purchaseId,
        merchantId: hint.merchantId ?? parent.merchantId,
        orderId: hint.childOrderId,
        relation: hint.relation,
        parentOrderIdentityId: parent.orderIdentityId,
      });
    }
    return true;
  }

  private attachEventEntities(event: CanonicalEvent, purchaseId: string) {
    const trackingId = event.trackingIdNormalized ?? event.trackingIdRaw;
    if (trackingId) this.upsertShipment(purchaseId, trackingId, event);

    const paymentReference = event.paymentReference;
    if (paymentReference) this.upsertPayment(purchaseId, paymentReference, event);

    const invoiceId = event.invoiceIdNormalized ?? event.invoiceIdRaw;
    if (invoiceId || event.eventType === 'invoice_created') this.upsertInvoice(purchaseId, invoiceId, event);
  }

  private upsertShipment(purchaseId: string, trackingId: string, event: CanonicalEvent) {
    const normalized = normalizeStableIdentifier(trackingId);
    if (!normalized) return;
    const existing = this.snapshotState.shipments.find(
      (shipment) => shipment.purchaseId === purchaseId && normalizeStableIdentifier(shipment.trackingId) === normalized,
    );
    if (existing) {
      existing.status = shipmentStatus(event);
      return;
    }
    const shipment: ShipmentIdentity = {
      shipmentId: `shipment:${purchaseId}:${normalized}`,
      purchaseId,
      carrierId: null,
      trackingId,
      status: shipmentStatus(event),
    };
    this.snapshotState.shipments.push(shipment);
  }

  private upsertPayment(purchaseId: string, paymentReference: string, event: CanonicalEvent) {
    const normalized = normalizeStableIdentifier(paymentReference);
    if (!normalized) return;
    if (this.snapshotState.payments.some(
      (payment) => payment.purchaseId === purchaseId && normalizeStableIdentifier(payment.paymentReference) === normalized,
    )) return;
    const payment: PaymentIdentity = {
      paymentId: `payment:${purchaseId}:${normalized}`,
      purchaseId,
      providerId: null,
      paymentReference,
      amount: event.amount,
      currency: event.currency,
    };
    this.snapshotState.payments.push(payment);
  }

  private upsertInvoice(purchaseId: string, invoiceId: string | null, event: CanonicalEvent) {
    const normalized = normalizeStableIdentifier(invoiceId);
    if (normalized && this.snapshotState.invoices.some(
      (invoice) => invoice.purchaseId === purchaseId && normalizeStableIdentifier(invoice.invoiceId) === normalized,
    )) return;
    const invoice: InvoiceIdentity = {
      invoiceIdentityId: `invoice:${purchaseId}:${normalized ?? event.eventId}`,
      purchaseId,
      issuerId: null,
      invoiceId,
      orderId: event.orderIdNormalized ?? event.orderIdRaw,
    };
    this.snapshotState.invoices.push(invoice);
  }

  private result(decision: CorrelationDecision, mutated: boolean): GraphApplyResult {
    return {
      decision,
      snapshot: this.snapshot(),
      mutated,
      productionWrites: 0,
      aiCalls: 0,
    };
  }
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function cloneSnapshot(snapshot: PurchaseIdentitySnapshot): PurchaseIdentitySnapshot {
  return {
    purchases: snapshot.purchases.map((item) => ({ ...item })),
    orders: snapshot.orders.map((item) => ({ ...item })),
    shipments: snapshot.shipments.map((item) => ({ ...item })),
    payments: snapshot.payments.map((item) => ({ ...item })),
    invoices: snapshot.invoices.map((item) => ({ ...item })),
  };
}

function stateFromEvent(event: CanonicalEvent): PurchaseIdentity['state'] {
  if (event.eventType === 'cancelled') return 'cancelled';
  if (event.eventType === 'return_created') return 'returned';
  if (event.eventType === 'refund_created' || event.eventType === 'refund_completed') return 'refunded';
  if (event.eventType === 'delivered') return 'fulfilled';
  return 'open';
}

function mergeState(current: PurchaseIdentity['state'], incoming: PurchaseIdentity['state']): PurchaseIdentity['state'] {
  const rank: Record<PurchaseIdentity['state'], number> = {
    unknown: 0,
    open: 1,
    fulfilled: 2,
    cancelled: 3,
    returned: 4,
    refunded: 5,
  };
  return rank[incoming] >= rank[current] ? incoming : current;
}

function shipmentStatus(event: CanonicalEvent): string | null {
  if (event.eventType === 'shipment_created') return 'in_transit';
  if (event.eventType === 'out_for_delivery') return 'out_for_delivery';
  if (event.eventType === 'delivered') return 'delivered';
  return null;
}
