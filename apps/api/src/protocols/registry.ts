import type { ProtocolProfile } from './types.js';
import { assertValidProtocolProfile } from './profile-validator.js';

/**
 * Production protocol profiles are registered here deliberately.
 *
 * Foundation V1 intentionally ships with an empty registry so adding the
 * protocol library cannot change current BuyFlow recognition behavior.
 * Merchant/system/carrier/payment/invoicing profiles are added only after
 * source research plus positive and hard-negative regression coverage.
 */
const PROTOCOL_PROFILES: ProtocolProfile[] = [];

for (const profile of PROTOCOL_PROFILES) {
  assertValidProtocolProfile(profile);
}

export function registeredProtocolProfiles(): readonly ProtocolProfile[] {
  return PROTOCOL_PROFILES;
}
