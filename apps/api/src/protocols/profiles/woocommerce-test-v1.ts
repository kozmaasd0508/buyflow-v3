import type { ProtocolProfile } from '../types.js';
import { WOOCOMMERCE_RESEARCH_V1 } from './woocommerce-research-v1.js';

/**
 * WooCommerce test profile.
 *
 * This promotes the already source-verified research rules into the explicit
 * test stage without making them production-eligible. The profile is consumed
 * only by the shadow/test registry and is intentionally absent from the
 * production registry.
 */
export const WOOCOMMERCE_TEST_V1: ProtocolProfile = {
  ...WOOCOMMERCE_RESEARCH_V1,
  protocol_version: '1.0.0-test.1',
  status: 'test',
  notes: [
    ...(WOOCOMMERCE_RESEARCH_V1.notes ?? []),
    'TEST ONLY: this profile is not registered for production recognition and cannot become production_eligible while status=test.',
    'Promotion to production requires observed rendered-email coverage, hard-negative regression coverage and benchmark safety with zero unsafe Purchase/link/lifecycle promotions.',
  ],
};
