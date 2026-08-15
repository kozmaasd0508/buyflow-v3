export type ProtocolKind =
  | 'commerce'
  | 'merchant'
  | 'carrier'
  | 'payment'
  | 'invoicing';

export type ProtocolStatus = 'research' | 'test' | 'production';

export type ProtocolEventCandidate =
  | 'ORDER_CREATED'
  | 'ORDER_PROCESSING'
  | 'ORDER_PACKING'
  | 'SHIPMENT_CREATED'
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'DELAYED'
  | 'CANCELLED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_ACTION_REQUIRED'
  | 'INVOICE'
  | 'RETURN'
  | 'REFUNDED'
  | 'WARRANTY'
  | 'OTHER';

export type ProtocolProvenanceLevel =
  | 'observed_real_email'
  | 'official_documentation'
  | 'verified_template'
  | 'community_example'
  | 'inferred'
  | 'unknown';

export type ProtocolEvidenceField =
  | 'sender_domain'
  | 'sender_address'
  | 'subject'
  | 'body'
  | 'html'
  | 'attachment_filename';

export type ProtocolProhibition =
  | 'DO_NOT_CREATE_PURCHASE'
  | 'DO_NOT_AUTO_LINK'
  | 'DO_NOT_SET_SHIPPED_AT'
  | 'DO_NOT_MARK_IN_TRANSIT'
  | 'DO_NOT_MARK_DELIVERED'
  | 'DO_NOT_MARK_REFUNDED';

export interface ProtocolIdentifierPatterns {
  order_id: string[];
  tracking_id: string[];
  invoice_id: string[];
  payment_reference: string[];
}

export interface ProtocolSourceReference {
  id: string;
  title: string;
  url?: string;
  provenance: ProtocolProvenanceLevel;
  observed_at?: string;
  notes?: string;
}

export interface ProtocolPatternRule {
  id: string;
  field: ProtocolEvidenceField;
  pattern: string;
  flags?: string;
  required?: boolean;
  confidence_delta?: number;
  source_ids: string[];
}

export interface ProtocolEventDefinition {
  event: ProtocolEventCandidate;
  base_confidence: number;
  positive_rules: ProtocolPatternRule[];
  negative_rules?: ProtocolPatternRule[];
  prohibitions?: ProtocolProhibition[];
}

export interface ProtocolProfile {
  protocol_id: string;
  protocol_version: string;
  kind: ProtocolKind;
  status: ProtocolStatus;
  display_name: string;
  country?: string;
  sender_domains: string[];
  sender_addresses?: string[];
  identifier_patterns: ProtocolIdentifierPatterns;
  events: ProtocolEventDefinition[];
  negative_patterns?: ProtocolPatternRule[];
  sources: ProtocolSourceReference[];
  notes?: string[];
}

export interface ProtocolIdentifiers {
  order_id: string | null;
  tracking_id: string | null;
  invoice_id: string | null;
  payment_reference: string | null;
}

export interface ProtocolMatchedEvidence {
  rule_id: string;
  field: ProtocolEvidenceField;
  source_ids: string[];
}

export interface ProtocolEvidence {
  protocol_id: string;
  protocol_version: string;
  protocol_kind: ProtocolKind;
  event_candidate: ProtocolEventCandidate;
  confidence: number;
  identifiers: ProtocolIdentifiers;
  evidence: ProtocolMatchedEvidence[];
  negative_evidence: ProtocolMatchedEvidence[];
  prohibitions: ProtocolProhibition[];
  provenance_levels: ProtocolProvenanceLevel[];
  production_eligible: boolean;
}

export interface ProtocolDetectionInput {
  senderDomains: string[];
  senderAddresses?: string[];
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  attachmentFilenames?: string[];
}
