import type { ProtocolProfile } from '../types.js';

/**
 * Shoprenter shadow profile based on official research plus sanitized
 * fingerprints observed in real rendered customer order-confirmation emails.
 *
 * Merchant-visible From addresses remain merchant identity. Platform identity
 * is established here only through Shoprenter mail infrastructure plus a
 * rendered order-confirmation structure. Test-only; no production activation.
 */
export const SHOPRENTER_TEST_V1: ProtocolProfile = {
  protocol_id: 'commerce.shoprenter',
  protocol_version: '1.0.0-test.1',
  kind: 'commerce',
  status: 'test',
  display_name: 'Shoprenter',
  sender_domains: [],
  identifier_patterns: {
    order_id: [
      'Rendel[eé]ssz[aá]m\\s*:\\s*#?([A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*)',
    ],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'shoprenter-official-emails',
      title: 'Shoprenter automatic email documentation',
      url: 'https://support.shoprenter.hu/hc/hu/articles/215106278-Automatikus-emailek',
      provenance: 'official_documentation',
    },
    {
      id: 'shoprenter-observed-order-confirmations',
      title: 'Observed Shoprenter customer order confirmations (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A real merchant-branded confirmation exposed Shoprenter DKIM/return-path infrastructure, while multiple real merchant confirmations shared the same visible order-confirmation structure. No private customer data is stored in this profile.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 0.93,
      positive_rules: [
        {
          id: 'shoprenter.observed.dkim-domain',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['shoprenter-observed-order-confirmations'],
        },
        {
          id: 'shoprenter.observed.return-path-domain',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-observed-order-confirmations'],
        },
        {
          id: 'shoprenter.observed.order-state-copy',
          field: 'body',
          pattern: 'Megrendel[eé]se meg[eé]rkezett, feldolgoz[aá]sa elkezd[oő]d[oö]tt',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-official-emails', 'shoprenter-observed-order-confirmations'],
        },
        {
          id: 'shoprenter.observed.order-details',
          field: 'body',
          pattern: 'Rendel[eé]s r[eé]szletei[\\s\\S]{0,300}Rendel[eé]ssz[aá]m\\s*:\\s*#?[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-observed-order-confirmations'],
        },
      ],
    },
  ],
  notes: [
    'Shoprenter merchants can customize visible sender, subject and body, so merchant From-domain or a generic subject is not sufficient platform proof.',
    'This test profile requires observed Shoprenter DKIM and return-path infrastructure plus explicit rendered order-confirmation structure.',
    'Only ORDER_CREATED is enabled here. Status changes, tracking links and payment descriptions remain research-only until separately observed and verified.',
  ],
};
