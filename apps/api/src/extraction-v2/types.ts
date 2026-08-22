export type EvidenceField =
  | 'event_type'
  | 'merchant'
  | 'order_number'
  | 'total'
  | 'currency'
  | 'carrier'
  | 'tracking_number'
  | 'payment_status'
  | 'product'
  | 'invoice_number'
  | 'payment_reference';

export type EvidenceSource =
  | 'subject'
  | 'body'
  | 'sender'
  | 'header'
  | 'attachment'
  | 'document_structure'
  | 'provider_adapter';

export interface EvidenceClaim<T = unknown> {
  field: EvidenceField;
  value: T;
  confidence: number;
  source: EvidenceSource;
  extractorId: string;
  extractorVersion: string;
  qualifiers?: string[];
}

export interface EvidenceBundle {
  claims: EvidenceClaim[];
}

export interface ResolvedField<T = unknown> {
  value: T | null;
  confidence: number | null;
  status: 'resolved' | 'missing' | 'conflict';
  // Provenance is intentionally independent from the resolved value type.
  // Aggregated values (for example Product[]) are resolved from individual
  // EvidenceClaim<Product> entries rather than EvidenceClaim<Product[]>.
  provenance: EvidenceClaim[];
}

export interface EvidenceProduct {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: 'HUF' | 'EUR' | 'USD' | 'GBP' | null;
}

export interface ResolvedCommerceEvent {
  eventType: ResolvedField<string>;
  merchant: ResolvedField<string>;
  orderNumber: ResolvedField<string>;
  total: ResolvedField<number>;
  currency: ResolvedField<string>;
  carrier: ResolvedField<string>;
  trackingNumber: ResolvedField<string>;
  paymentStatus: ResolvedField<string>;
  invoiceNumber: ResolvedField<string>;
  paymentReference: ResolvedField<string>;
  products: ResolvedField<EvidenceProduct[]>;
  reviewRequired: boolean;
  conflictFields: EvidenceField[];
}
