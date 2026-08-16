import type { ProtocolProfile } from '../types.js';

/**
 * UNAS shadow profile based on official platform research plus sanitized
 * fingerprints observed in real rendered customer order-confirmation emails.
 *
 * The platform is identified through mail transport infrastructure, not the
 * merchant From domain. This stays test-only and cannot become production
 * eligible while status=test.
 */
export const UNAS_TEST_V1: ProtocolProfile = {
  protocol_id: 'commerce.unas',
  protocol_version: '1.0.0-test.1',
  kind: 'commerce',
  status: 'test',
  display_name: 'UNAS',
  sender_domains: [],
  identifier_patterns: {
    order_id: [
      'Megrendel[eé]s adatok[\\s\\S]{0,240}Azonos[ií]t[oó]\\s*([A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*)',
    ],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'unas-official-notifications',
      title: 'UNAS notification and order template documentation',
      url: 'https://unas.hu/tudastar/admin/ertesitesek',
      provenance: 'official_documentation',
    },
    {
      id: 'unas-observed-order-confirmations',
      title: 'Observed UNAS customer order confirmations (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple merchant-branded customer confirmations shared UNAS transport infrastructure and the same order-details structural block. No private customer data is stored in this profile.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 0.92,
      positive_rules: [
        {
          id: 'unas.observed.transport-host',
          field: 'transport_host',
          pattern: '^s\\d+\\.unas\\.hu$',
          required: true,
          source_ids: ['unas-observed-order-confirmations'],
        },
        {
          id: 'unas.observed.order-structure',
          field: 'body',
          pattern: 'Megrendel[eé]s adatok[\\s\\S]{0,500}Azonos[ií]t[oó][\\s\\S]{0,500}Sz[aá]ll[ií]t[aá]si m[oó]d[\\s\\S]{0,500}Fizet[eé]si m[oó]d',
          required: true,
          confidence_delta: 0.03,
          source_ids: ['unas-official-notifications', 'unas-observed-order-confirmations'],
        },
        {
          id: 'unas.observed.order-intent',
          field: 'body',
          pattern: '(?:Web[aá]ruh[aá]zunkban rendel[eé]st adott le|Megrendel[eé]sedet sikeresen leadtad|automata visszaigazol[aá]s a megrendel[eé]s lead[aá]s[aá]r[oó]l)',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['unas-observed-order-confirmations'],
        },
      ],
    },
  ],
  notes: [
    'UNAS merchants control their visible sender, subject and much of the email copy; merchant From-domain alone does not identify the platform.',
    'The test profile therefore requires observed UNAS transport infrastructure plus a stable rendered order-details structure and explicit order intent.',
    'This profile recognizes order creation only. Status-change, payment and shipment semantics remain research-only until separately observed and verified.',
  ],
};
