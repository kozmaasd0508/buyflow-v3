import type { ProtocolProfile } from '../types.js';

/**
 * Merchant-specific Shoprenter lifecycle profile derived from sanitized,
 * observed customer emails for Gyerekjatekbolt.com.
 *
 * This deliberately does NOT generalize merchant-configured Shoprenter status
 * labels to every Shoprenter store. Merchant identity, Shoprenter transport
 * identity and explicit event wording are all required.
 */
export const GYEREKJATEKBOLT_SHOPRENTER_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.gyerekjatekbolt',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'Gyerekjatekbolt.com (Shoprenter)',
  country: 'HU',
  sender_domains: ['gyerekjatekbolt.com'],
  sender_addresses: ['gyerekjatekbolt@gyerekjatekbolt.com'],
  identifier_patterns: {
    order_id: [
      'A\\(z\\)\\s*#?([0-9]{4,})\\.?\\s*sz[aá]m[uú] rendel[eé]st',
      'Rendel[eé]ssz[aá]m\\s*:\\s*#?([0-9]{4,})',
      'a\\(z\\)\\s*#?([0-9]{4,})\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota',
    ],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [
      'Tranzakci[oó] azonos[ií]t[oó]\\s*:\\s*([A-Za-z0-9._-]+)',
    ],
  },
  sources: [
    {
      id: 'shoprenter-official-emails',
      title: 'Shoprenter automatic email documentation',
      url: 'https://support.shoprenter.hu/hc/hu/articles/215106278-Automatikus-emailek',
      provenance: 'official_documentation',
    },
    {
      id: 'gyerekjatekbolt-observed-payment-success',
      title: 'Observed Gyerekjatekbolt successful-card-payment email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Verified merchant sender plus Shoprenter DKIM/return-path infrastructure, stable order identity and explicit accepted transaction evidence. No private customer data is stored.',
    },
    {
      id: 'gyerekjatekbolt-observed-courier-handoff',
      title: 'Observed Gyerekjatekbolt courier-handoff status email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Explicitly states that the order was handed to the courier. No private customer data is stored.',
    },
    {
      id: 'gyerekjatekbolt-observed-delivered',
      title: 'Observed Gyerekjatekbolt delivered status email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Explicit merchant-side delivered status. Direct carrier evidence remains higher authority for logistics. No private customer data is stored.',
    },
  ],
  events: [
    {
      event: 'PAYMENT_SUCCESS',
      base_confidence: 0.95,
      positive_rules: [
        {
          id: 'gyj.platform.dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-payment-success'],
        },
        {
          id: 'gyj.platform.return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-payment-success'],
        },
        {
          id: 'gyj.payment.subject',
          field: 'subject',
          pattern: '^Sikeres bankk[aá]rty[aá]s fizet[eé]s a Gyerekjatekbolt\\.com web[aá]ruh[aá]zban!$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-payment-success'],
        },
        {
          id: 'gyj.payment.order-paid',
          field: 'body',
          pattern: 'A\\(z\\)\\s*#?[0-9]{4,}\\.?\\s*sz[aá]m[uú] rendel[eé]st sikeresen befizette',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['gyerekjatekbolt-observed-payment-success'],
        },
        {
          id: 'gyj.payment.accepted-transaction',
          field: 'body',
          pattern: 'V[aá]laszk[oó]d\\s*:\\s*00[\\s\\S]{0,180}V[aá]lasz[uü]zenet\\s*:\\s*Tranzakci[oó] elfogadva',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['gyerekjatekbolt-observed-payment-success'],
        },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    },
    {
      event: 'SHIPPED',
      base_confidence: 0.94,
      positive_rules: [
        {
          id: 'gyj.shipped.platform-dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-courier-handoff'],
        },
        {
          id: 'gyj.shipped.platform-return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-courier-handoff'],
        },
        {
          id: 'gyj.shipped.status-subject',
          field: 'subject',
          pattern: '^Gyerekjatekbolt\\.com\\s*[-–]\\s*a\\(z\\)\\s*[0-9]{4,}\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota megv[aá]ltozott$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-courier-handoff'],
        },
        {
          id: 'gyj.shipped.order-identity',
          field: 'body',
          pattern: 'Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{4,}',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-courier-handoff'],
        },
        {
          id: 'gyj.shipped.explicit-handoff',
          field: 'body',
          pattern: 'jelenlegi [aá]llapot\\s*:\\s*Sz[aá]ll[ií]t[aá]s alatt[\\s\\S]{0,300}Rendel[eé]s[eé]t [aá]tadtuk a fut[aá]rszolg[aá]lat r[eé]sz[eé]re',
          required: true,
          confidence_delta: 0.03,
          source_ids: ['gyerekjatekbolt-observed-courier-handoff'],
        },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_DELIVERED'],
    },
    {
      event: 'DELIVERED',
      base_confidence: 0.92,
      positive_rules: [
        {
          id: 'gyj.delivered.platform-dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-delivered'],
        },
        {
          id: 'gyj.delivered.platform-return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-delivered'],
        },
        {
          id: 'gyj.delivered.status-subject',
          field: 'subject',
          pattern: '^Gyerekjatekbolt\\.com\\s*[-–]\\s*a\\(z\\)\\s*[0-9]{4,}\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota megv[aá]ltozott$',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-delivered'],
        },
        {
          id: 'gyj.delivered.order-identity',
          field: 'body',
          pattern: 'Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{4,}',
          required: true,
          source_ids: ['gyerekjatekbolt-observed-delivered'],
        },
        {
          id: 'gyj.delivered.explicit-status',
          field: 'body',
          pattern: 'jelenlegi [aá]llapot\\s*:\\s*Rendel[eé]s k[eé]zbes[ií]tve',
          required: true,
          confidence_delta: 0.03,
          source_ids: ['gyerekjatekbolt-observed-delivered'],
        },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    },
  ],
  notes: [
    'This profile is merchant-specific. Shoprenter status labels and templates are configurable and must never be generalized from this merchant to every Shoprenter store.',
    'Observed Gyerekjatekbolt order identities are numeric; this test profile intentionally does not accept arbitrary punctuation-bearing order tokens.',
    'PAYMENT_SUCCESS requires explicit accepted transaction evidence; a status label alone is insufficient.',
    'SHIPPED requires explicit physical courier handoff, not merely the merchant-defined label Szállítás alatt.',
    'DELIVERED is merchant-side delivery evidence. Direct carrier delivery evidence remains higher authority under the Protocol Library authority matrix.',
    'The profile is shadow-only. status=test means none of these candidates can become production_eligible or write live state.',
  ],
};
