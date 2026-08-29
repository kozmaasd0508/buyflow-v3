import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { EvidenceClaim, EvidenceField, ResolvedCommerceEvent, ResolvedField } from '../extraction-v2/types.js';
import { extractExplicitOrderRelation } from './explicit-order-relation.js';
import { normalizeMerchantToken, normalizeStableIdentifier } from './identifier-normalizer.js';
import type {
  CanonicalEvent,
  CanonicalEventType,
  EvidenceConflict,
  EvidenceProvenance,
  EvidenceReference,
  SourceRole,
} from './types.js';

export interface ExtractionV2MerchantIdentityResolver {
  resolve(input: {
    merchantRaw: string;
    senderDomain: string | null;
    provenance: EvidenceProvenance[];
    observedAt?: string | null;
  }): string | null;
}

export interface ExtractionV2CarrierIdentityResolver {
  resolve(input: {
    carrierRaw: string;
    senderDomain: string | null;
    provenance: EvidenceProvenance[];
  }): string | null;
}

/**
 * Optional semantic-only override for the primary lifecycle event. It may select
 * a CanonicalEventType but cannot supply or mutate any identity field. Fixed
 * provenance qualifiers make that trust boundary visible downstream.
 */
export interface SemanticEventOverride {
  eventType: CanonicalEventType;
  semanticLabel: string;
  sourceId: string;
  sourceVersion: string;
}

export interface CanonicalEventFromExtractionV2Input {
  userId: string;
  document: EmailDocumentV1;
  extraction: ExtractionEngineV2Result;
  merchantResolver?: ExtractionV2MerchantIdentityResolver;
  carrierResolver?: ExtractionV2CarrierIdentityResolver;
  semanticEventOverride?: SemanticEventOverride;
}

const FIELD_NAMES: EvidenceField[] = [
  'event_type',
  'merchant',
  'order_number',
  'total',
  'currency',
  'carrier',
  'tracking_number',
  'payment_status',
  'invoice_number',
  'payment_reference',
  'product',
];

function fieldByName(event: ResolvedCommerceEvent, field: EvidenceField): ResolvedField {
  switch (field) {
    case 'event_type': return event.eventType;
    case 'merchant': return event.merchant;
    case 'order_number': return event.orderNumber;
    case 'total': return event.total;
    case 'currency': return event.currency;
    case 'carrier': return event.carrier;
    case 'tracking_number': return event.trackingNumber;
    case 'payment_status': return event.paymentStatus;
    case 'invoice_number': return event.invoiceNumber;
    case 'payment_reference': return event.paymentReference;
    case 'product': return event.products;
  }
}

function resolvedValue<T>(field: ResolvedField<T>): T | null {
  return field.status === 'resolved' ? field.value : null;
}

function mapEventType(value: string | null): CanonicalEventType {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'order_created': return 'order_created';
    case 'order_updated': return 'order_updated';
    case 'payment_completed': return 'payment_completed';
    case 'shipment': return 'shipment_created';
    case 'delivery': return 'delivered';
    case 'invoice_or_receipt': return 'invoice_created';
    case 'refund': return 'refund_created';
    case 'return': return 'return_created';
    case 'cancellation':
    case 'cancelled': return 'cancelled';
    default: return 'other';
  }
}

function evidenceReference(claim: EvidenceClaim): EvidenceReference {
  return {
    field: claim.field,
    value: claim.value,
    source: claim.source,
    confidence: Number.isFinite(claim.confidence) ? claim.confidence : null,
    extractorId: claim.extractorId || null,
    extractorVersion: claim.extractorVersion || null,
    qualifiers: [...(claim.qualifiers ?? [])],
  };
}

function provenanceFromClaim(claim: EvidenceClaim): EvidenceProvenance {
  return {
    field: claim.field,
    source: claim.source,
    parserVersion: null,
    extractorId: claim.extractorId || null,
    extractorVersion: claim.extractorVersion || null,
    confidence: Number.isFinite(claim.confidence) ? claim.confidence : null,
    qualifiers: [...(claim.qualifiers ?? [])],
  };
}

function semanticProvenance(override: SemanticEventOverride): EvidenceProvenance {
  return {
    field: 'semantic_event_type',
    source: 'provider_adapter',
    parserVersion: override.sourceVersion,
    extractorId: override.sourceId,
    extractorVersion: override.sourceVersion,
    confidence: null,
    qualifiers: [
      'semantic_only',
      'non_authoritative',
      'no_identity_evidence_from_ai',
      `semantic_label:${override.semanticLabel}`,
    ],
  };
}

function resolvedProvenance(event: ResolvedCommerceEvent): EvidenceProvenance[] {
  return FIELD_NAMES.flatMap((field) => fieldByName(event, field).provenance.map(provenanceFromClaim));
}

function conflictFromResolved(field: EvidenceField, resolved: ResolvedField): EvidenceConflict | null {
  if (resolved.status !== 'conflict') return null;
  const evidence = resolved.provenance.map(evidenceReference);
  return {
    field,
    values: evidence.map((item) => item.value),
    evidence,
    severity: 'hard',
    explanation: `Extraction Engine v2 strongest ${field} evidence conflicts.`,
  };
}

function validationConflicts(extraction: ExtractionEngineV2Result): EvidenceConflict[] {
  return extraction.validation.issues
    .filter((issue) => issue.severity === 'review')
    .map((issue) => {
      const evidence = issue.fields.flatMap((field) => fieldByName(extraction.resolved, field).provenance.map(evidenceReference));
      const values = issue.fields.map((field) => ({
        field,
        value: resolvedValue(fieldByName(extraction.resolved, field)),
      }));
      return {
        field: issue.fields.join('+'),
        values,
        evidence,
        severity: 'hard' as const,
        explanation: `${issue.code}: ${issue.message}`,
      };
    });
}

function conflictsFromExtraction(extraction: ExtractionEngineV2Result): EvidenceConflict[] {
  const fieldConflicts = FIELD_NAMES
    .map((field) => conflictFromResolved(field, fieldByName(extraction.resolved, field)))
    .filter((conflict): conflict is EvidenceConflict => Boolean(conflict));
  return [...fieldConflicts, ...validationConflicts(extraction)];
}

function hasQualifier(extraction: ExtractionEngineV2Result, qualifier: string): boolean {
  return extraction.evidence.bundle.claims.some((claim) => claim.qualifiers?.includes(qualifier));
}

function sourceRole(extraction: ExtractionEngineV2Result): SourceRole {
  if (hasQualifier(extraction, 'authenticated_direct_carrier_sender') || hasQualifier(extraction, 'direct_carrier_sender')) {
    return 'carrier';
  }
  const merchant = extraction.resolved.merchant;
  if (merchant.status === 'resolved' && merchant.provenance.some((claim) =>
    claim.qualifiers?.includes('sender_commercial_identity') || claim.qualifiers?.includes('sender_transactional_identity')
  )) {
    return 'merchant';
  }
  return 'unknown';
}

function productFingerprints(extraction: ExtractionEngineV2Result): string[] {
  const products = resolvedValue(extraction.resolved.products) ?? [];
  return products.map((product) => {
    const name = product.name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return [name, product.quantity ?? '', product.currency ?? ''].join('|');
  }).filter((value) => value.split('|')[0]);
}

/**
 * Read-only bridge from frozen Extraction Engine v2 output into the Purchase
 * Identity Graph v2 contract. It never reads legacy parser output and never
 * mutates extraction results.
 *
 * A semanticEventOverride can replace only the primary CanonicalEventType. All
 * order/tracking/invoice/payment/merchant/carrier fields remain exclusively
 * sourced from Extraction v2. This permits a local classifier to answer "what
 * happened?" without giving it any authority over "which Purchase is this?".
 *
 * Merchant identity is deliberately not invented from display text. A caller
 * must provide a canonical merchant resolver. Carrier values may fall back to a
 * deterministic normalized carrier token because the Extraction v2 carrier
 * field already resolves a carrier identity. Payment provider and invoice issuer
 * remain null until those namespaces are explicitly evidenced upstream.
 */
export function canonicalEventFromExtractionV2(input: CanonicalEventFromExtractionV2Input): CanonicalEvent | null {
  const { document, extraction } = input;
  const resolvedEventType = resolvedValue(extraction.resolved.eventType);
  const eventTypeConflict = extraction.resolved.eventType.status === 'conflict';
  if (!resolvedEventType && !eventTypeConflict && !input.semanticEventOverride) return null;

  const orderIdRaw = resolvedValue(extraction.resolved.orderNumber);
  const relationExtraction = extractExplicitOrderRelation(document, orderIdRaw);
  const provenance = [
    ...resolvedProvenance(extraction.resolved),
    ...(relationExtraction.relation?.provenance ?? []),
    ...(input.semanticEventOverride ? [semanticProvenance(input.semanticEventOverride)] : []),
  ];
  const merchantRaw = resolvedValue(extraction.resolved.merchant);
  const carrierRaw = resolvedValue(extraction.resolved.carrier);
  const senderDomain = document.sender.primaryDomain;
  const merchantId = merchantRaw && input.merchantResolver
    ? input.merchantResolver.resolve({
        merchantRaw,
        senderDomain,
        provenance,
        observedAt: document.receivedAt,
      })
    : null;
  const carrierId = carrierRaw
    ? input.carrierResolver?.resolve({ carrierRaw, senderDomain, provenance }) ?? normalizeMerchantToken(carrierRaw)
    : null;

  const trackingIdRaw = resolvedValue(extraction.resolved.trackingNumber);
  const invoiceIdRaw = resolvedValue(extraction.resolved.invoiceNumber);
  const paymentReferenceRaw = resolvedValue(extraction.resolved.paymentReference);

  return {
    eventId: `${document.provider}:${document.providerMessageId}:extraction-v2`,
    userId: input.userId,
    eventType: input.semanticEventOverride?.eventType ?? mapEventType(resolvedEventType),
    sourceProvider: document.provider,
    sourceMessageId: document.providerMessageId,
    senderDomain,
    receivedAt: document.receivedAt,
    occurredAt: null,
    merchantRaw,
    merchantId,
    orderRelation: relationExtraction.relation,
    orderIdRaw,
    orderIdNormalized: normalizeStableIdentifier(orderIdRaw),
    trackingIdRaw,
    trackingIdNormalized: normalizeStableIdentifier(trackingIdRaw),
    invoiceIdRaw,
    invoiceIdNormalized: normalizeStableIdentifier(invoiceIdRaw),
    paymentReference: normalizeStableIdentifier(paymentReferenceRaw),
    amount: resolvedValue(extraction.resolved.total),
    currency: resolvedValue(extraction.resolved.currency),
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: productFingerprints(extraction),
    provenance,
    sourceRole: sourceRole(extraction),
    carrierId,
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [...conflictsFromExtraction(extraction), ...relationExtraction.conflicts],
  };
}
