import type { ProtocolProfile } from '../types.js';
import { SHOPIFY_RESEARCH_V1 } from './shopify-research-v1.js';

/**
 * Shopify test profile keeps the deliberately conservative research semantics:
 * the shared shopifyemail.com channel is platform evidence only and never
 * merchant identity or purchase lifecycle proof by itself.
 */
export const SHOPIFY_TEST_V1: ProtocolProfile = {
  ...SHOPIFY_RESEARCH_V1,
  protocol_version: '1.0.0-test.1',
  status: 'test',
  sources: [
    ...SHOPIFY_RESEARCH_V1.sources,
    {
      id: 'shopify-observed-shared-sender-marketing',
      title: 'Observed Shopify shared-sender promotional emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Observed shared Shopify sender infrastructure carrying promotional traffic confirms that the channel alone cannot establish a purchase or lifecycle event.',
    },
  ],
  notes: [
    ...(SHOPIFY_RESEARCH_V1.notes ?? []),
    'TEST ONLY: shared Shopify sender evidence remains OTHER with DO_NOT_CREATE_PURCHASE and DO_NOT_AUTO_LINK.',
    'No Shopify lifecycle parser is enabled until rendered transactional fingerprints are observed and verified.',
  ],
};
