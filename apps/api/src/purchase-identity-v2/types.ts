export type CanonicalEventType =
  | 'order_created'
  | 'order_updated'
  | 'payment_completed'
  | 'shipment_created'
  | 'out_for_delivery'
  | 'delivered'
  | 'invoice_created'
  | 'refund_created'
  | 'refund_completed'
  | 'return_created'
  | 'cancelled'
  | 'other';

export interface EvidenceProvenance {
  field: string;
  source: 'subject' | 'body' | 'header' | 'attachment' | 'provider_adapter';
  parserVersion: string | null;
}

export interface CanonicalEvent {
  eventId: string;
  userId: string;
  eventType: CanonicalEventType;
  sourceProvider: string;
  sourceMessageId: string;
  senderDomain: string | null;
  receivedAt: string;
  occurredAt: string | null;
  merchantRaw: string | null;
  merchantId: string | null;
  orderIdRaw: string | null;
  orderIdNormalized: string | null;
  trackingIdRaw: string | null;
  trackingIdNormalized: string | null;
  invoiceIdRaw: string | null;
  invoiceIdNormalized: string | null;
  paymentReference: string | null;
  amount: number | null;
  currency: string | null;
  orderUrl: string | null;
  trackingUrl: string | null;
  productFingerprints: string[];
  provenance: EvidenceProvenance[];
}

export interface PurchaseIdentity {
  purchaseId: string;
  userId: string;
  canonicalMerchantId: string | null;
  primaryOrderIdentityId: string | null;
  state: 'open' | 'fulfilled' | 'cancelled' | 'returned' | 'refunded' | 'unknown';
}

export interface OrderIdentity {
  orderIdentityId: string;
  purchaseId: string;
  merchantId: string | null;
  orderId: string;
  relation: 'primary' | 'child' | 'split_child' | 'replacement';
  parentOrderIdentityId: string | null;
}

export interface ShipmentIdentity {
  shipmentId: string;
  purchaseId: string;
  carrierId: string | null;
  trackingId: string | null;
  status: string | null;
}

export interface PaymentIdentity {
  paymentId: string;
  purchaseId: string;
  providerId: string | null;
  paymentReference: string | null;
  amount: number | null;
  currency: string | null;
}

export interface InvoiceIdentity {
  invoiceIdentityId: string;
  purchaseId: string;
  issuerId: string | null;
  invoiceId: string | null;
  orderId: string | null;
}

export interface MerchantIdentityDefinition {
  merchantId: string;
  canonicalName: string;
  domains: string[];
  senderDomains: string[];
  storefrontAliases: string[];
  invoiceIssuers: string[];
  paymentDescriptors: string[];
}

export type EvidenceType =
  | 'ORDER_ID_EXACT'
  | 'TRACKING_ID_EXACT'
  | 'PAYMENT_REFERENCE_EXACT'
  | 'INVOICE_ORDER_ID_EXACT'
  | 'ORDER_URL_EXACT'
  | 'MERCHANT_ID_MATCH'
  | 'AMOUNT_CURRENCY_MATCH'
  | 'TIME_PROXIMITY'
  | 'PRODUCT_OVERLAP'
  | 'PARENT_CHILD_ORDER';

export interface EvidenceEdge {
  sourceEventId: string;
  candidatePurchaseId: string;
  evidenceType: EvidenceType;
  strength: 'hard' | 'soft';
  score: number;
  explanation: string;
}

export type CorrelationDecision =
  | { kind: 'NEW_PURCHASE'; reasons: EvidenceEdge[] }
  | { kind: 'LINKED'; purchaseId: string; reasons: EvidenceEdge[] }
  | { kind: 'REVIEW'; candidatePurchaseIds: string[]; reasons: EvidenceEdge[] }
  | { kind: 'UNLINKED'; reasons: EvidenceEdge[] };

export interface PurchaseIdentitySnapshot {
  purchases: PurchaseIdentity[];
  orders: OrderIdentity[];
  shipments: ShipmentIdentity[];
  payments: PaymentIdentity[];
  invoices: InvoiceIdentity[];
}
