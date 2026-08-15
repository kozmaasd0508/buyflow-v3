import type {
  ProtocolEvidence,
  ProtocolProfile,
  ProtocolProvenanceLevel,
} from './types.js';

export type ProtocolFactDomain =
  | 'commerce_identity'
  | 'logistics_state'
  | 'payment_state'
  | 'invoice_state';

export type ProtocolAuthoritySource =
  | 'generic_email'
  | 'merchant'
  | 'commerce_protocol'
  | 'carrier_direct'
  | 'payment_provider_direct'
  | 'invoice_provider_direct'
  | 'invoice_pdf';

const PRODUCTION_PROVENANCE = new Set<ProtocolProvenanceLevel>([
  'observed_real_email',
  'official_documentation',
  'verified_template',
]);

const AUTHORITY: Record<ProtocolFactDomain, Partial<Record<ProtocolAuthoritySource, number>>> = {
  commerce_identity: {
    generic_email: 20,
    commerce_protocol: 45,
    merchant: 70,
    invoice_pdf: 80,
  },
  logistics_state: {
    generic_email: 15,
    commerce_protocol: 35,
    merchant: 55,
    carrier_direct: 90,
  },
  payment_state: {
    generic_email: 15,
    commerce_protocol: 35,
    merchant: 55,
    payment_provider_direct: 90,
  },
  invoice_state: {
    generic_email: 15,
    commerce_protocol: 35,
    merchant: 50,
    invoice_provider_direct: 90,
    invoice_pdf: 95,
  },
};

export const PROTOCOL_PRODUCTION_EVIDENCE_MIN_CONFIDENCE = 0.85;

export function provenanceCanSupportProduction(
  levels: ProtocolProvenanceLevel[],
): boolean {
  return levels.some((level) => PRODUCTION_PROVENANCE.has(level));
}

export function protocolEvidenceMayEnterAutomaticDecision(
  profile: ProtocolProfile,
  evidence: Pick<
    ProtocolEvidence,
    'confidence' | 'provenance_levels' | 'blocked_by_negative_evidence'
  >,
): boolean {
  return (
    profile.status === 'production'
    && !evidence.blocked_by_negative_evidence
    && evidence.confidence >= PROTOCOL_PRODUCTION_EVIDENCE_MIN_CONFIDENCE
    && provenanceCanSupportProduction(evidence.provenance_levels)
  );
}

export function compareProtocolAuthority(input: {
  domain: ProtocolFactDomain;
  left: ProtocolAuthoritySource;
  right: ProtocolAuthoritySource;
}): number {
  const left = AUTHORITY[input.domain][input.left] ?? 0;
  const right = AUTHORITY[input.domain][input.right] ?? 0;
  return left - right;
}

export function protocolAuthorityScore(
  domain: ProtocolFactDomain,
  source: ProtocolAuthoritySource,
): number {
  return AUTHORITY[domain][source] ?? 0;
}
