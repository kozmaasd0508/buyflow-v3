import type { ProtocolProfile } from './types.js';
import { assertValidProtocolProfile } from './profile-validator.js';
import { GYEREKJATEKBOLT_SHOPRENTER_TEST_V1 } from './profiles/gyerekjatekbolt-shoprenter-test-v1.js';
import { SHOPIFY_TEST_V1 } from './profiles/shopify-test-v1.js';
import { SHOPRENTER_TEST_V1 } from './profiles/shoprenter-test-v1.js';
import { UNAS_TEST_V1 } from './profiles/unas-test-v1.js';
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
  SHOPIFY_TEST_V1,
  UNAS_TEST_V1,
  SHOPRENTER_TEST_V1,
  GYEREKJATEKBOLT_SHOPRENTER_TEST_V1,
];

for (const profile of TEST_PROTOCOL_PROFILES) {
  assertValidProtocolProfile(profile);
}

export function registeredTestProtocolProfiles(): readonly ProtocolProfile[] {
  return TEST_PROTOCOL_PROFILES;
}
