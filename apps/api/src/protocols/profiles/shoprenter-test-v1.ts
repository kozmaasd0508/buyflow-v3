import type { ProtocolProfile } from '../types.js';

/**
 * Shoprenter shadow profile based on official research plus sanitized
 * fingerprints observed in real rendered customer order-confirmation emails.
 *
 * Merchant-visible From addresses remain merchant identity. Platform identity
 * is established only through observed Shoprenter mail infrastructure plus a
 * rendered order-confirmation structure. Multiple real Shoprenter delivery
 * routes are represented separately so source provenance stays precise.
 * Test-only; no production activation.
 */
export const SHOPRENTER_TEST_V1: ProtocolProfile = {
  protocol_id: 'commerce.shoprenter',
  protocol_version: '1.0.0-test.2',
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
      id: 'shoprenter-observed-smtp-order-confirmations',
      title: 'Observed Shoprenter SMTP customer order confirmations (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Real merchant-branded confirmations exposed *.smtp.shoprenter.hu DKIM/return-path infrastructure plus the rendered Shoprenter order-confirmation structure. No private customer data is stored.',
    },
    {
      id: 'shoprenter-observed-webarena-order-confirmation',
      title: 'Observed WebArena Shoprenter order confirmation using alternate Shoprenter delivery route (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A real WebArena confirmation used DKIM d=shoprenter.hu, return-path mail2.shoprenter.hu and a Shoprenter-owned transport host while preserving the same rendered order-confirmation structure. No private customer data or real order id is stored.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 0.93,
      positive_rules: [
        {
          id: 'shoprenter.smtp.dkim-domain',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['shoprenter-observed-smtp-order-confirmations'],
        },
        {
          id: 'shoprenter.smtp.return-path-domain',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-observed-smtp-order-confirmations'],
        },
        {
          id: 'shoprenter.smtp.order-state-copy',
          field: 'body',
          pattern: 'Megrendel[eé]se meg[eé]rkezett, feldolgoz[aá]sa elkezd[oő]d[oö]tt',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-official-emails', 'shoprenter-observed-smtp-order-confirmations'],
        },
        {
          id: 'shoprenter.smtp.order-details',
          field: 'body',
          pattern: 'Rendel[eé]s r[eé]szletei[\\s\\S]{0,300}Rendel[eé]ssz[aá]m\\s*:\\s*#?[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-observed-smtp-order-confirmations'],
        },
      ],
    },
    {
      event: 'ORDER_CREATED',
      base_confidence: 0.93,
      positive_rules: [
        {
          id: 'shoprenter.alt.dkim-domain',
          field: 'dkim_domain',
          pattern: '^shoprenter\\.hu$',
          required: true,
          source_ids: ['shoprenter-observed-webarena-order-confirmation'],
        },
        {
          id: 'shoprenter.alt.return-path-domain',
          field: 'return_path_domain',
          pattern: '^mail[0-9]+\\.shoprenter\\.hu$',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-observed-webarena-order-confirmation'],
        },
        {
          id: 'shoprenter.alt.order-state-copy',
          field: 'body',
          pattern: 'Megrendel[eé]se meg[eé]rkezett, feldolgoz[aá]sa elkezd[oő]d[oö]tt',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-official-emails', 'shoprenter-observed-webarena-order-confirmation'],
        },
        {
          id: 'shoprenter.alt.order-details',
          field: 'body',
          pattern: 'Rendel[eé]s r[eé]szletei[\\s\\S]{0,300}Rendel[eé]ssz[aá]m\\s*:\\s*#?[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-observed-webarena-order-confirmation'],
        },
      ],
    },
  ],
  notes: [
    'Shoprenter merchants can customize visible sender, subject and body, so merchant From-domain or a generic subject is not sufficient platform proof.',
    'Observed Shoprenter order confirmations can use more than one platform-owned delivery route. Shadow recognition therefore models each verified route separately instead of assuming one fixed DKIM/return-path shape.',
    'Both routes still require explicit rendered order-confirmation structure and a stable order identity.',
    'Only ORDER_CREATED is enabled at the platform level. Merchant-configured status labels, tracking links and payment descriptions are not generalized across all Shoprenter stores.',
  ],
};
