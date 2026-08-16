import { detectProtocolEvidence } from './detect.js';
import { registeredTestProtocolProfiles } from './test-registry.js';
import type { ProtocolDetectionInput, ProtocolEvidence } from './types.js';

/**
 * Runs protocol candidates in shadow/test mode only.
 *
 * This function returns evidence for measurement and regression tests. It does
 * not register profiles for production, write Purchases/Shipments/Documents or
 * bypass any existing BuyFlow classifier/resolution gates.
 */
export function detectShadowProtocolEvidence(
  input: ProtocolDetectionInput,
): ProtocolEvidence[] {
  return detectProtocolEvidence(input, registeredTestProtocolProfiles());
}
