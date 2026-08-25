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

export type SourceRole =
  | 'merchant'
  | 'marketplace'
  | 'carrier'
  | 'payment_provider'
  | 'invoice_issuer'
  | 'customer'
  | 'unknown';

export type PurchaseCreationAuthority = 'authorized' | 'review' | 'none';

export interface EvidenceProvenance {
  field: string;
  source:
    | 'subject'
    | 'body'
    | 'sender'
    | 'header'
    | 'attachment'
    | 'document_structure'
    | 'provider_adapter';
  parserVersion: string | null;
  extractorId?: string | null;
  extractorVersion?: string | null;
  confidence?: number | null;
  qualifiers?: string[];
}

export interface EvidenceReference {
  field: string;
  value: unknown;
  source: EvidenceProvenance['source'];
  confidence: number | null;
  extractorId: string | null;
  extractorVersion: string | null;
  qualifiers: string[];
}

export interface EvidenceConflict {
  field: string;
  values: unknown[];
  evidence: EvidenceReference[];
  severity: 'hard' | 'soft';
  explanation: string;
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
  /**
   * Exact merchant-owned sender namespace for unknown merchants. This is not a
   * canonical merchant id and must never be populated for public/shared/carrier
   * infrastructure. It exists so same-order lifecycle events can correlate
   * before a Merchant Identity Registry entry exists.
   */
  merchantNamespace?: string | null;
  /**
   * Upstream semantic permission for creating a new Purchase. The graph may
   * use this for unknown merchants but must never infer it from order id alone.
   */
  purchaseCreationAuthority?: PurchaseCreationAuthority;
  purchaseCreationReasons?: string[];
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
  sourceRole?: SourceRole;
  carrierId?: string | null;
  paymentProviderId?: string | null;
  invoiceIssuerId?: string | null;
  platformMerchantId?: string | null;
  sellerMerchantId?: string | null;
  conflicts?: EvidenceConflict[];
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
  /** Exact sender-domain namespace captured when the merchant was not yet canonicalized. */
  merchantNamespace?: string | null;
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

export type IdentityRecordStatus = 'active' | 'historical' | 'disabled';

export type MerchantIdentitySignalKind =
  | 'canonical_name'
  | 'storefront_alias'
  | 'domain'
  | 'sender_domain';

export interface MerchantIdentitySignalDefinition {
  kind: MerchantIdentitySignalKind;
  value: string;
  status?: IdentityRecordStatus;
  validFrom?: string | null;
  validTo?: string | null;
  evidenceSource?: string | null;
}

export interface MerchantIdentityDefinition {
  merchantId: string;
  canonicalName: string;
  domains: string[];
  senderDomains: string[];
  storefrontAliases: string[];
  invoiceIssuers: string[];
  paymentDescriptors: string[];
  status?: IdentityRecordStatus;
  validFrom?: string | null;
  validTo?: string | null;
  evidenceSource?: string | null;
  identitySignals?: MerchantIdentitySignalDefinition[];
}

export type EvidenceType =
  | 'ORDER_ID_EXACT'
  | 'ORDER_ID_DECORATED_REVIEW_ALIAS'
  | 'TRACKING_ID_EXACT'
  | 'PAYMENT_REFERENCE_EXACT'
  | 'INVOICE_ORDER_ID_EXACT'
  | 'ORDER_URL_EXACT'
  | 'MERCHANT_ID_MATCH'
  | 'MERCHANT_NAMESPACE_MATCH'
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
  | { kind: 'PENDING'; candidatePurchaseIds: string[]; reasons: EvidenceEdge[]; conflicts: EvidenceConflict[] }
  | { kind: 'UNLINKED'; reasons: EvidenceEdge[] };

export interface PurchaseIdentitySnapshot {
  purchases: PurchaseIdentity[];
  orders: OrderIdentity[];
  shipments: ShipmentIdentity[];
  payments: PaymentIdentity[];
  invoices: InvoiceIdentity[];
}
