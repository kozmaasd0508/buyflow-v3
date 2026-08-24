import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type {
  TechnicalEvidenceShadowV15Result,
  TechnicalEvidenceV15,
  TechnicalEvidenceV15Kind,
  TechnicalEvidenceV15Source,
} from './technical-evidence-v1-5.js';

export const TECHNICAL_EVIDENCE_DIRECTION_GATE_V1_VERSION = '1.0.0' as const;

export type TechnicalEvidenceDirectionV1 =
  | 'buyer_inbound'
  | 'seller_outbound'
  | 'return_to_seller'
  | 'unknown';

export interface TechnicalEvidenceDirectionBlockedV1 {
  kind: TechnicalEvidenceV15Kind;
  source: TechnicalEvidenceV15Source;
  sourcePath: string;
  extractorId: string;
  reason: 'purchase_direction_ineligible';
}

export interface TechnicalEvidenceDirectionGateV1Result {
  schemaVersion: 1;
  gateVersion: typeof TECHNICAL_EVIDENCE_DIRECTION_GATE_V1_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  direction: TechnicalEvidenceDirectionV1;
  directionConfidence: number;
  reasons: string[];
  purchaseAuthorityEligible: boolean;
  /** Raw evidence is retained for runtime audit; do not persist this object to public logs. */
  evidence: TechnicalEvidenceV15[];
  /** Only evidence eligible to influence a buyer Purchase decision. */
  eligibleEvidence: TechnicalEvidenceV15[];
  /** Privacy-safe metadata about rows blocked from Purchase authority. */
  blockedEvidence: TechnicalEvidenceDirectionBlockedV1[];
}

export interface TechnicalEvidenceDirectionGateV1Summary {
  schemaVersion: 1;
  gateVersion: typeof TECHNICAL_EVIDENCE_DIRECTION_GATE_V1_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  direction: TechnicalEvidenceDirectionV1;
  directionConfidence: number;
  purchaseAuthorityEligible: boolean;
  evidenceCount: number;
  eligibleEvidenceCount: number;
  blockedEvidenceCount: number;
  blockedKinds: TechnicalEvidenceV15Kind[];
  reasons: string[];
}

const PURCHASE_AUTHORITY_KINDS = new Set<TechnicalEvidenceV15Kind>([
  'event',
  'merchant',
  'order_number',
  'tracking_number',
  'invoice_number',
  'payment_reference',
  'amount',
  'currency',
  'payment_method',
  'product',
  'date',
]);

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDirectCarrierEvidence(result: TechnicalEvidenceShadowV15Result): boolean {
  return result.evidence.some((row) => (
    row.kind === 'carrier'
    && row.source === 'carrier_semantic'
    && row.confidence >= 0.98
  ));
}

function classifyDirection(
  document: EmailDocumentV1,
  result: TechnicalEvidenceShadowV15Result,
): { direction: TechnicalEvidenceDirectionV1; confidence: number; reasons: string[] } {
  // Direction gating is intentionally restricted to authenticated/provider-qualified
  // direct-carrier evidence. A merchant email quoting carrier language must not be
  // reclassified merely because the same words appear in its body.
  if (!hasDirectCarrierEvidence(result)) {
    return { direction: 'unknown', confidence: 0, reasons: ['no_direct_carrier_authority'] };
  }

  const subject = normalize(document.subject ?? '');
  const text = normalize(document.text ?? '');
  const combined = `${subject} ${text}`;

  const sellerOutboundPatterns: Array<[RegExp, string]> = [
    [/\bon a csomagautomatan a feladas soran\b[\s\S]{0,260}\bcsomag feladasat rogzitette\b/, 'carrier_self_service_dropoff_recorded'],
    [/\barufelvetel(?:i)?\b[\s\S]{0,80}\bmegbizas(?:t|a|sal|bol|hoz|nak)?\b/, 'carrier_pickup_booking_language'],
    [/\b(?:pickup|collection) (?:request|booking|order)\b[\s\S]{0,180}\b(?:courier|driver)\b/, 'carrier_pickup_booking_language_en'],
  ];
  for (const [pattern, reason] of sellerOutboundPatterns) {
    if (pattern.test(combined)) {
      return { direction: 'seller_outbound', confidence: 0.995, reasons: ['direct_carrier_source', reason] };
    }
  }

  const returnToSellerPatterns: Array<[RegExp, string]> = [
    [/\bat nem vett\b[\s\S]{0,160}\bvisszaszallitott csomagja megerkezett\b/, 'undelivered_customer_parcel_returned'],
    [/\bundelivered\b[\s\S]{0,160}\b(?:returned|sent back)\b[\s\S]{0,160}\b(?:sender|shipper)\b/, 'undelivered_customer_parcel_returned_en'],
  ];
  for (const [pattern, reason] of returnToSellerPatterns) {
    if (pattern.test(combined)) {
      return { direction: 'return_to_seller', confidence: 0.995, reasons: ['direct_carrier_source', reason] };
    }
  }

  const buyerInboundPatterns: Array<[RegExp, string]> = [
    [/\bon reszere kezbesitendo\b/, 'parcel_addressed_to_recipient'],
    [/\badott fel szamodra\b/, 'merchant_shipped_to_recipient'],
    [/\bfelado most adta fel az on csomagjat\b/, 'merchant_shipped_to_recipient'],
    [/\bshipped by our partner\b/, 'parcel_shipped_by_partner_to_recipient'],
    [/\bcsomagod\b[\s\S]{0,140}\bpartnerunk atadta reszunkre\b/, 'merchant_handed_parcel_to_carrier'],
    [/\bcsomagod\b[\s\S]{0,120}\braktarunkban van\b/, 'parcel_in_carrier_warehouse_for_recipient'],
    [/\bcsomagkuldemenyt adtak fel onnek\b/, 'mpl_parcel_posted_to_recipient'],
    [/\bnemzetkozi csomagja megerkezett magyarorszagra\b[\s\S]{0,180}\bkezbesitunk onnek\b/, 'mpl_parcel_arrived_in_country_for_recipient'],
    [/\bcsomagjat kezbesitonk atvette\b[\s\S]{0,180}\bmai napon megkisereljuk\b[\s\S]{0,120}\bkezbesiteni\b/, 'mpl_out_for_delivery_to_recipient'],
    [/\bkuldemenye atveheto az alabbi postan\b/, 'mpl_ready_for_pickup_by_recipient'],
  ];
  for (const [pattern, reason] of buyerInboundPatterns) {
    if (pattern.test(combined)) {
      return { direction: 'buyer_inbound', confidence: 0.99, reasons: ['direct_carrier_source', reason] };
    }
  }

  return { direction: 'unknown', confidence: 0.5, reasons: ['direct_carrier_source', 'direction_not_proven'] };
}

/**
 * Source-role / direction gate for TechnicalEvidence v1.5.
 *
 * This does NOT delete or rewrite extractor output. It separates audit evidence
 * from evidence allowed to influence a buyer Purchase lifecycle. Strongly proven
 * seller-outbound and return-to-seller carrier messages keep diagnostic platform /
 * carrier / raw-signal rows but cannot authorize purchase events or identities.
 *
 * Unknown direction remains eligible in v1 so this safety layer does not reduce
 * recall merely because a provider lacks a direction template. Production use
 * should still require the normal conflict/identity gates downstream.
 */
export function applyTechnicalEvidenceDirectionGateV1(input: {
  document: EmailDocumentV1;
  technicalEvidence: TechnicalEvidenceShadowV15Result;
}): TechnicalEvidenceDirectionGateV1Result {
  if (input.technicalEvidence.productionWrites !== 0 || input.technicalEvidence.aiCalls !== 0) {
    throw new Error('technical_evidence_direction_gate_v1_shadow_invariant_failed');
  }

  const classified = classifyDirection(input.document, input.technicalEvidence);
  const blockedDirection = classified.direction === 'seller_outbound'
    || classified.direction === 'return_to_seller';

  const eligibleEvidence: TechnicalEvidenceV15[] = [];
  const blockedEvidence: TechnicalEvidenceDirectionBlockedV1[] = [];

  for (const row of input.technicalEvidence.evidence) {
    if (blockedDirection && PURCHASE_AUTHORITY_KINDS.has(row.kind)) {
      blockedEvidence.push({
        kind: row.kind,
        source: row.source,
        sourcePath: row.sourcePath,
        extractorId: row.extractorId,
        reason: 'purchase_direction_ineligible',
      });
      continue;
    }
    eligibleEvidence.push(row);
  }

  return {
    schemaVersion: 1,
    gateVersion: TECHNICAL_EVIDENCE_DIRECTION_GATE_V1_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    direction: classified.direction,
    directionConfidence: classified.confidence,
    reasons: classified.reasons,
    purchaseAuthorityEligible: !blockedDirection,
    evidence: [...input.technicalEvidence.evidence],
    eligibleEvidence,
    blockedEvidence,
  };
}

export function summarizeTechnicalEvidenceDirectionGateV1(
  result: TechnicalEvidenceDirectionGateV1Result,
): TechnicalEvidenceDirectionGateV1Summary {
  return {
    schemaVersion: 1,
    gateVersion: TECHNICAL_EVIDENCE_DIRECTION_GATE_V1_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    direction: result.direction,
    directionConfidence: result.directionConfidence,
    purchaseAuthorityEligible: result.purchaseAuthorityEligible,
    evidenceCount: result.evidence.length,
    eligibleEvidenceCount: result.eligibleEvidence.length,
    blockedEvidenceCount: result.blockedEvidence.length,
    blockedKinds: [...new Set(result.blockedEvidence.map((row) => row.kind))].sort(),
    reasons: [...result.reasons],
  };
}
