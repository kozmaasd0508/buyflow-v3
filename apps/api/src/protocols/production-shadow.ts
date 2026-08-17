import type { NormalizedEmail } from '../email/types.js';
import { detectProtocolEvidence } from './detect.js';
import { protocolDetectionInputFromEmail } from './email-input.js';
import { emitGenericCommerceShadowEmailObservation } from './generic-commerce-shadow.js';
import { assertValidProtocolProfile } from './profile-validator.js';
import { ALZA_MERCHANT_TEST_V1 } from './profiles/alza-merchant-test-v1.js';
import { DPD_HUNGARY_CARRIER_TEST_V1 } from './profiles/dpd-hungary-carrier-test-v1.js';
import { EXPRESSONE_CARRIER_TEST_V1 } from './profiles/expressone-carrier-test-v1.js';
import { FOXPOST_CARRIER_TEST_V1 } from './profiles/foxpost-carrier-test-v1.js';
import { GLS_HUNGARY_CARRIER_TEST_V1 } from './profiles/gls-hungary-carrier-test-v1.js';
import { GYMBEAM_MERCHANT_TEST_V1 } from './profiles/gymbeam-merchant-test-v1.js';
import { MPL_CARRIER_TEST_V1 } from './profiles/mpl-carrier-test-v1.js';
import { SIMPLEPAY_PAYMENT_TEST_V1 } from './profiles/simplepay-payment-test-v1.js';
import type {
  ProtocolDetectionInput,
  ProtocolEvidenceField,
  ProtocolEventCandidate,
  ProtocolKind,
  ProtocolProfile,
  ProtocolProhibition,
  ProtocolProvenanceLevel,
} from './types.js';

/**
 * Gate B is deliberately separate from registry.ts.
 *
 * These are the profiles explicitly marked GREEN in the 2026-08-17 readiness
 * review. Keeping this allowlist here prevents a YELLOW/RED research profile
 * from entering live production-shadow observation merely because it exists in
 * test-registry.ts.
 */
const PRODUCTION_SHADOW_PROFILES: ProtocolProfile[] = [
  DPD_HUNGARY_CARRIER_TEST_V1,
  FOXPOST_CARRIER_TEST_V1,
  EXPRESSONE_CARRIER_TEST_V1,
  GLS_HUNGARY_CARRIER_TEST_V1,
  MPL_CARRIER_TEST_V1,
  GYMBEAM_MERCHANT_TEST_V1,
  ALZA_MERCHANT_TEST_V1,
  SIMPLEPAY_PAYMENT_TEST_V1,
];

const EXPECTED_GREEN_PROFILE_IDS = [
  'carrier.hu.dpd',
  'carrier.hu.foxpost',
  'carrier.hu.expressone',
  'carrier.hu.gls',
  'carrier.hu.mpl',
  'merchant.hu.gymbeam',
  'merchant.hu.alza',
  'payment.hu.simplepay',
] as const;

for (const profile of PRODUCTION_SHADOW_PROFILES) {
  assertValidProtocolProfile(profile);
  if (profile.status !== 'test') {
    throw new Error(
      `Production-shadow profile ${profile.protocol_id}@${profile.protocol_version} must remain status=test.`,
    );
  }
}

const actualGreenIds = PRODUCTION_SHADOW_PROFILES.map((profile) => profile.protocol_id);
if (
  actualGreenIds.length !== EXPECTED_GREEN_PROFILE_IDS.length ||
  actualGreenIds.some((id, index) => id !== EXPECTED_GREEN_PROFILE_IDS[index])
) {
  throw new Error('Production-shadow GREEN allowlist drifted from the reviewed Gate B profile set.');
}

export interface ProductionShadowDiagnostic {
  mode: 'production-shadow';
  would_write: false;
  protocol_id: string;
  protocol_version: string;
  protocol_kind: ProtocolKind;
  event_candidate: ProtocolEventCandidate;
  confidence: number;
  blocked_by_negative_evidence: boolean;
  production_eligible: false;
  identifiers_present: {
    order_id: boolean;
    tracking_id: boolean;
    invoice_id: boolean;
    payment_reference: boolean;
  };
  authentication_evidence_present: {
    dkim: boolean;
    return_path: boolean;
    transport: boolean;
  };
  matched_rule_ids: string[];
  negative_rule_ids: string[];
  matched_fields: ProtocolEvidenceField[];
  source_ids: string[];
  prohibitions: ProtocolProhibition[];
  provenance_levels: ProtocolProvenanceLevel[];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function registeredProductionShadowProfiles(): readonly ProtocolProfile[] {
  return PRODUCTION_SHADOW_PROFILES;
}

/**
 * Evaluate only the reviewed GREEN profiles and return sanitized diagnostics.
 *
 * This function has no database dependency and no write callback. Raw message
 * content, sender addresses, provider message IDs and extracted identifier
 * values are intentionally absent from the returned diagnostics.
 */
export function observeProductionShadowProtocolEvidence(
  input: ProtocolDetectionInput,
): ProductionShadowDiagnostic[] {
  const evidence = detectProtocolEvidence(input, PRODUCTION_SHADOW_PROFILES);

  if (evidence.some((row) => row.production_eligible)) {
    throw new Error(
      'Production-shadow safety invariant violated: shadow evidence became production eligible.',
    );
  }

  return evidence.map((row) => ({
    mode: 'production-shadow',
    would_write: false,
    protocol_id: row.protocol_id,
    protocol_version: row.protocol_version,
    protocol_kind: row.protocol_kind,
    event_candidate: row.event_candidate,
    confidence: row.confidence,
    blocked_by_negative_evidence: row.blocked_by_negative_evidence,
    production_eligible: false,
    identifiers_present: {
      order_id: row.identifiers.order_id !== null,
      tracking_id: row.identifiers.tracking_id !== null,
      invoice_id: row.identifiers.invoice_id !== null,
      payment_reference: row.identifiers.payment_reference !== null,
    },
    authentication_evidence_present: {
      dkim: (input.dkimDomains?.length ?? 0) > 0,
      return_path: (input.returnPathDomains?.length ?? 0) > 0,
      transport: (input.transportHosts?.length ?? 0) > 0,
    },
    matched_rule_ids: row.evidence.map((match) => match.rule_id),
    negative_rule_ids: row.negative_evidence.map((match) => match.rule_id),
    matched_fields: unique(row.evidence.map((match) => match.field)),
    source_ids: unique([
      ...row.evidence.flatMap((match) => match.source_ids),
      ...row.negative_evidence.flatMap((match) => match.source_ids),
    ]),
    prohibitions: [...row.prohibitions],
    provenance_levels: [...row.provenance_levels],
  }));
}

export function observeProductionShadowEmail(
  email: NormalizedEmail,
): ProductionShadowDiagnostic[] {
  return observeProductionShadowProtocolEvidence(protocolDetectionInputFromEmail(email));
}

/**
 * Emit privacy-reduced observation payloads suitable for production logs.
 * The same already-fetched message is also passed through the generic commerce
 * shadow lane, which emits only when the central deterministic parser truly
 * falls through to the generic order-confirmation parser.
 */
export function emitProductionShadowEmailObservation(
  email: NormalizedEmail,
  log: (label: string, payload: string) => void = console.info,
): ProductionShadowDiagnostic[] {
  const rows = observeProductionShadowEmail(email);
  log(
    '[protocol-production-shadow]',
    JSON.stringify({
      mode: 'production-shadow',
      would_write: false,
      reviewed_profiles: PRODUCTION_SHADOW_PROFILES.length,
      matched_rows: rows.length,
      rows,
    }),
  );
  emitGenericCommerceShadowEmailObservation(email, log);
  return rows;
}
