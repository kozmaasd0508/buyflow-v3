export { detectProtocolEvidence } from './detect.js';
export { registeredProtocolProfiles } from './registry.js';
export {
  compareProtocolAuthority,
  provenanceCanSupportProduction,
  protocolAuthorityScore,
  protocolEvidenceMayEnterAutomaticDecision,
  PROTOCOL_PRODUCTION_EVIDENCE_MIN_CONFIDENCE,
} from './safety.js';
export { assertValidProtocolProfile, validateProtocolProfile } from './profile-validator.js';
export type {
  ProtocolDetectionInput,
  ProtocolEvidence,
  ProtocolEventCandidate,
  ProtocolIdentifierPatterns,
  ProtocolKind,
  ProtocolPatternRule,
  ProtocolProfile,
  ProtocolProhibition,
  ProtocolProvenanceLevel,
  ProtocolSourceReference,
  ProtocolStatus,
} from './types.js';
