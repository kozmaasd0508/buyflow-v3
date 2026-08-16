import type { ProtocolProfile } from './types.js';
import { assertValidProtocolProfile } from './profile-validator.js';
import { WOOCOMMERCE_TEST_V1 } from './profiles/woocommerce-test-v1.js';

/**
 * Test/shadow registry.
 *
 * Profiles listed here are deliberately isolated from registry.ts, which is
 * the production registry. This makes it possible to measure candidate rules
 * without changing live BuyFlow recognition or writes.
 */
const TEST_PROTOCOL_PROFILES: ProtocolProfile[] = [
  WOOCOMMERCE_TEST_V1,
];

for (const profile of TEST_PROTOCOL_PROFILES) {
  assertValidProtocolProfile(profile);
}

export function registeredTestProtocolProfiles(): readonly ProtocolProfile[] {
  return TEST_PROTOCOL_PROFILES;
}
