import type { ProtocolProfile } from '../types.js';

/**
 * Merchant-specific Shoprenter profile derived from a sanitized, observed
 * Forproshop customer journey.
 *
 * The journey is especially useful because the merchant status
 * "Rendelése elkészült - szállítás folyamatban" was followed by direct
 * FOXPOST evidence proving the parcel had not yet been handed to FOXPOST.
 */
export const FORPROSHOP_SHOPRENTER_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.forproshop',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'Forproshop (Shoprenter)',
  country: 'HU',
  sender_domains: ['sport8.hu'],
  sender_addresses: ['info@sport8.hu'],
  identifier_patterns: {
    order_id: [
      'Rendel[eé]s azonos[ií]t[oó]\\s*:\\s*#?([0-9]{4,10})',
      'Rendel[eé]ssz[aá]m\\s*:\\s*#?([0-9]{4,10})',
      'Forproshop\\s*[-–]\\s*([0-9]{4,10})',
      'a\\(z\\)\\s*([0-9]{4,10})\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota',
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
      id: 'forproshop-observed-order-confirmation',
      title: 'Observed Forproshop order confirmation (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Verified info@sport8.hu merchant sender, mail6.smtp.shoprenter.hu DKIM/return-path infrastructure and rendered Shoprenter order structure. Private customer data and the real order id are not stored.',
    },
    {
      id: 'forproshop-observed-shipping-progress-status',
      title: 'Observed Forproshop shipping-progress merchant status (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Merchant status was Rendelése elkészült - szállítás folyamatban. Roughly two minutes earlier, direct FOXPOST pre-advice created a parcel number and explicitly said the parcel had not yet been handed to FOXPOST. This status therefore cannot mean SHIPPED.',
    },
    {
      id: 'forproshop-observed-completed-status',
      title: 'Observed Forproshop Teljesítve status (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'The Teljesítve merchant status arrived after a direct FOXPOST ready-for-pickup notification, but the inspected merchant email contained no direct carrier proof of pickup or delivery. It remains OTHER.',
    },
    {
      id: 'forproshop-observed-foxpost-pre-advice',
      title: 'Observed direct FOXPOST pre-advice for the same Forproshop journey (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct carrier email stated that a parcel number had been created but the parcel had not yet been handed to FOXPOST. The actual parcel id is not stored.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 0.95,
      positive_rules: [
        {
          id: 'forpro.order.platform-dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['forproshop-observed-order-confirmation'],
        },
        {
          id: 'forpro.order.platform-return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['forproshop-observed-order-confirmation'],
        },
        {
          id: 'forpro.order.subject',
          field: 'subject',
          pattern: '^Rendel[eé]s visszaigazol[aá]s\\s*[-–]\\s*Forproshop\\s*[-–]\\s*[0-9]{4,10}$',
          required: true,
          source_ids: ['forproshop-observed-order-confirmation'],
        },
        {
          id: 'forpro.order.body-state',
          field: 'body',
          pattern: 'Megrendel[eé]se meg[eé]rkezett [eé]s feldolgoz[aá]sa megkezd[oő]d[oö]tt',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-official-emails', 'forproshop-observed-order-confirmation'],
        },
        {
          id: 'forpro.order.body-identity',
          field: 'body',
          pattern: 'Rendel[eé]s azonos[ií]t[oó]\\s*:\\s*#?[0-9]{4,10}[\\s\\S]{0,200}Rendel[eé]s r[eé]szletei[\\s\\S]{0,200}Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{4,10}',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['forproshop-observed-order-confirmation'],
        },
      ],
    },
    {
      event: 'OTHER',
      base_confidence: 0.96,
      positive_rules: [
        {
          id: 'forpro.shipping-status.platform-dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['forproshop-observed-shipping-progress-status'],
        },
        {
          id: 'forpro.shipping-status.platform-return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['forproshop-observed-shipping-progress-status'],
        },
        {
          id: 'forpro.shipping-status.subject',
          field: 'subject',
          pattern: '^Forproshop\\s*[-–]\\s*a\\(z\\)\\s*[0-9]{4,10}\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota megv[aá]ltozott$',
          required: true,
          source_ids: ['forproshop-observed-shipping-progress-status'],
        },
        {
          id: 'forpro.shipping-status.label',
          field: 'body',
          pattern: 'Rendel[eé]s [aá]llapota\\s*:\\s*Rendel[eé]se elk[eé]sz[uü]lt\\s*[-–]\\s*sz[aá]ll[ií]t[aá]s folyamatban',
          required: true,
          confidence_delta: 0.03,
          source_ids: [
            'forproshop-observed-shipping-progress-status',
            'forproshop-observed-foxpost-pre-advice',
          ],
        },
        {
          id: 'forpro.shipping-status.order-identity',
          field: 'body',
          pattern: 'Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{4,10}',
          required: true,
          source_ids: ['forproshop-observed-shipping-progress-status'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_IN_TRANSIT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
    {
      event: 'OTHER',
      base_confidence: 0.94,
      positive_rules: [
        {
          id: 'forpro.completed.platform-dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['forproshop-observed-completed-status'],
        },
        {
          id: 'forpro.completed.platform-return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['forproshop-observed-completed-status'],
        },
        {
          id: 'forpro.completed.subject',
          field: 'subject',
          pattern: '^Forproshop\\s*[-–]\\s*a\\(z\\)\\s*[0-9]{4,10}\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota megv[aá]ltozott$',
          required: true,
          source_ids: ['forproshop-observed-completed-status'],
        },
        {
          id: 'forpro.completed.status',
          field: 'body',
          pattern: 'Rendel[eé]s [aá]llapota\\s*:\\s*Teljes[ií]tve',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['forproshop-observed-completed-status'],
        },
        {
          id: 'forpro.completed.order-identity',
          field: 'body',
          pattern: 'Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{4,10}',
          required: true,
          source_ids: ['forproshop-observed-completed-status'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_IN_TRANSIT',
        'DO_NOT_MARK_DELIVERED',
        'DO_NOT_MARK_REFUNDED',
      ],
    },
  ],
  notes: [
    'Forproshop visible sender identity is info@sport8.hu; sender domain alone must not be generalized to every Sport8 message.',
    'Rendelése elkészült - szállítás folyamatban is proven not to mean SHIPPED for this merchant: direct FOXPOST pre-advice immediately before it said the parcel had not yet been handed to FOXPOST.',
    'Teljesítve is a merchant-side status. A direct carrier ready-for-pickup notification existed earlier in the same journey, but the merchant email itself does not prove pickup or delivery.',
    'The profile is shadow-only. status=test means none of these candidates can become production eligible or write live state.',
  ],
};
