import type { ProtocolProfile } from '../types.js';

/**
 * Merchant-specific Shoprenter profile derived from two sanitized, observed
 * WebArena customer journeys.
 *
 * The profile intentionally keeps merchant status labels conservative:
 * "Elküldve" and "Teljesítve" are merchant-side completion labels only and
 * are not promoted to physical carrier shipment/delivery without direct
 * carrier evidence.
 */
export const WEBARENA_SHOPRENTER_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.webarena',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'WebArena (Shoprenter)',
  country: 'HU',
  sender_domains: ['webarena.hu'],
  sender_addresses: ['ugyfelszolgalat@webarena.hu'],
  identifier_patterns: {
    order_id: [
      'Rendel[eé]ssz[aá]m\\s*:\\s*#?([0-9]{5,10})',
      'Rendel[eé]s\\s+([0-9]{5,10})',
      'a\\(z\\)\\s*([0-9]{5,10})\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota',
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
      id: 'webarena-observed-order-confirmations',
      title: 'Observed WebArena order confirmations (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Two real WebArena order confirmations shared the Shoprenter rendered order-confirmation structure. The newer sample used DKIM d=shoprenter.hu and return-path mail2.shoprenter.hu. Private customer data and real order ids are not stored.',
    },
    {
      id: 'webarena-observed-sent-status',
      title: 'Observed WebArena Elküldve status emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'The Elküldve merchant status was observed on two separate orders. The emails contained no tracking id and no explicit physical courier handoff wording.',
    },
    {
      id: 'webarena-observed-completed-status',
      title: 'Observed WebArena Teljesítve status email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'The Teljesítve merchant status followed Elküldve on an observed order but contained no direct carrier delivery evidence. It is therefore held as OTHER.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 0.95,
      positive_rules: [
        {
          id: 'webarena.order.platform-dkim',
          field: 'dkim_domain',
          pattern: '^shoprenter\\.hu$',
          required: true,
          source_ids: ['webarena-observed-order-confirmations'],
        },
        {
          id: 'webarena.order.platform-return-path',
          field: 'return_path_domain',
          pattern: '^mail[0-9]+\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['webarena-observed-order-confirmations'],
        },
        {
          id: 'webarena.order.subject',
          field: 'subject',
          pattern: '^Webar[eé]na\\s*[-–]\\s*Rendel[eé]s\\s+[0-9]{5,10}$',
          required: true,
          source_ids: ['webarena-observed-order-confirmations'],
        },
        {
          id: 'webarena.order.body-state',
          field: 'body',
          pattern: 'Megrendel[eé]se meg[eé]rkezett, feldolgoz[aá]sa elkezd[oő]d[oö]tt',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['shoprenter-official-emails', 'webarena-observed-order-confirmations'],
        },
        {
          id: 'webarena.order.body-identity',
          field: 'body',
          pattern: 'Rendel[eé]s r[eé]szletei[\\s\\S]{0,250}Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{5,10}',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['webarena-observed-order-confirmations'],
        },
      ],
    },
    {
      event: 'OTHER',
      base_confidence: 0.93,
      positive_rules: [
        {
          id: 'webarena.sent.platform-dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['webarena-observed-sent-status'],
        },
        {
          id: 'webarena.sent.platform-return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['webarena-observed-sent-status'],
        },
        {
          id: 'webarena.sent.subject',
          field: 'subject',
          pattern: '^Webar[eé]na\\s*[-–]\\s*a\\(z\\)\\s*[0-9]{5,10}\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota megv[aá]ltozott$',
          required: true,
          source_ids: ['webarena-observed-sent-status'],
        },
        {
          id: 'webarena.sent.status',
          field: 'body',
          pattern: 'jelenlegi [aá]llapot\\s*:\\s*Elk[uü]ldve',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['webarena-observed-sent-status'],
        },
        {
          id: 'webarena.sent.order-identity',
          field: 'body',
          pattern: 'Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{5,10}',
          required: true,
          source_ids: ['webarena-observed-sent-status'],
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
      base_confidence: 0.93,
      positive_rules: [
        {
          id: 'webarena.completed.platform-dkim',
          field: 'dkim_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['webarena-observed-completed-status'],
        },
        {
          id: 'webarena.completed.platform-return-path',
          field: 'return_path_domain',
          pattern: '^(?:[a-z0-9-]+\\.)?smtp\\.shoprenter\\.hu$',
          required: true,
          source_ids: ['webarena-observed-completed-status'],
        },
        {
          id: 'webarena.completed.subject',
          field: 'subject',
          pattern: '^Webar[eé]na\\s*[-–]\\s*a\\(z\\)\\s*[0-9]{5,10}\\.?\\s*sz[aá]m[uú] rendel[eé]s [aá]llapota megv[aá]ltozott$',
          required: true,
          source_ids: ['webarena-observed-completed-status'],
        },
        {
          id: 'webarena.completed.status',
          field: 'body',
          pattern: 'jelenlegi [aá]llapot\\s*:\\s*Teljes[ií]tve',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['webarena-observed-completed-status'],
        },
        {
          id: 'webarena.completed.order-identity',
          field: 'body',
          pattern: 'Rendel[eé]ssz[aá]m\\s*:\\s*#?[0-9]{5,10}',
          required: true,
          source_ids: ['webarena-observed-completed-status'],
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
    'WebArena order confirmation and status notifications used two different verified Shoprenter delivery routes. Event rules therefore require the route observed for that exact message type.',
    'Elküldve was observed on two separate WebArena orders, but neither email contained a tracking id or explicit physical courier-handoff wording. It remains OTHER.',
    'Teljesítve followed Elküldve on one observed journey, but no direct carrier-delivery email was found for that journey. It remains OTHER and must not mark DELIVERED.',
    'The merchant status meanings are not generalized to other Shoprenter stores.',
    'The profile is shadow-only. status=test means none of these candidates can become production eligible or write live state.',
  ],
};
