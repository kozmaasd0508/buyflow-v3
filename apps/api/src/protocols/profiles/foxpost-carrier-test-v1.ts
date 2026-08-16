import type { ProtocolProfile } from '../types.js';

/**
 * Direct FOXPOST carrier profile derived from many sanitized, observed
 * recipient notifications plus current FOXPOST customer documentation.
 *
 * Carrier evidence is deliberately stronger than merchant status wording for
 * physical logistics. This profile is shadow-only and never creates a Purchase.
 */
export const FOXPOST_CARRIER_TEST_V1: ProtocolProfile = {
  protocol_id: 'carrier.hu.foxpost',
  protocol_version: '1.0.0-test.1',
  kind: 'carrier',
  status: 'test',
  display_name: 'FOXPOST',
  country: 'HU',
  sender_domains: ['foxpost.hu'],
  sender_addresses: ['no-reply@foxpost.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [
      'Csomagsz[aá]m\\s*:\\s*\\[?(CLFOX[0-9]+)',
      'Csomagod FOXPOST azonos[ií]t[oó]sz[aá]ma\\s*:\\s*\\[?(CLFOX[0-9]+)',
      'Csomagod azonos[ií]t[oó]sz[aá]ma\\s*:\\s*\\[?(CLFOX[0-9]+)',
    ],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'foxpost-official-pickup',
      title: 'FOXPOST csomagátvétel és értesítési folyamat',
      url: 'https://foxpost.hu/csomagatvetel',
      provenance: 'official_documentation',
    },
    {
      id: 'foxpost-observed-preadvice',
      title: 'Observed FOXPOST Előértesítés emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Many real messages over multiple months used the same direct FOXPOST sender and stated that a parcel number existed while the parcel had not yet been handed to FOXPOST. Private recipient, sender and parcel identifiers are not stored.',
    },
    {
      id: 'foxpost-observed-warehouse',
      title: 'Observed FOXPOST warehouse-arrival emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Many real messages used subject Csomagod már a raktárunkban van and explicitly stated that the parcel had arrived in the FOXPOST warehouse and would later reach the target locker.',
    },
    {
      id: 'foxpost-observed-ready',
      title: 'Observed FOXPOST ready-for-pickup emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Many real messages used subject Csomagod megérkezett and explicitly said the parcel was available for pickup, with locker details and pickup credentials or pickup instructions.',
    },
    {
      id: 'foxpost-observed-auth',
      title: 'Observed FOXPOST authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME from multiple lifecycle messages verified From no-reply@foxpost.hu, DKIM pass for foxpost.hu and DMARC pass. Mailjet transport is not treated as FOXPOST identity.',
    },
  ],
  events: [
    {
      event: 'SHIPMENT_CREATED',
      base_confidence: 0.98,
      positive_rules: [
        {
          id: 'foxpost.preadvice.dkim',
          field: 'dkim_domain',
          pattern: '^foxpost\\.hu$',
          required: true,
          source_ids: ['foxpost-observed-auth'],
        },
        {
          id: 'foxpost.preadvice.subject',
          field: 'subject',
          pattern: '^El[oő][eé]rtes[ií]t[eé]s$',
          required: true,
          source_ids: ['foxpost-observed-preadvice'],
        },
        {
          id: 'foxpost.preadvice.number-created',
          field: 'body',
          pattern: 'csomag felad[aá]s[aá]hoz sz[uü]ks[eé]ges csomagsz[aá]mot hoztak l[eé]tre',
          required: true,
          source_ids: ['foxpost-observed-preadvice'],
        },
        {
          id: 'foxpost.preadvice.not-handed-over',
          field: 'body',
          pattern: 'A csomagot m[eé]g nem adt[aá]k [aá]t a FOXPOST r[eé]sz[eé]re',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['foxpost-observed-preadvice'],
        },
        {
          id: 'foxpost.preadvice.tracking',
          field: 'body',
          pattern: 'Csomagsz[aá]m\\s*:\\s*\\[?CLFOX[0-9]+',
          required: true,
          source_ids: ['foxpost-observed-preadvice', 'foxpost-official-pickup'],
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
      event: 'IN_TRANSIT',
      base_confidence: 0.98,
      positive_rules: [
        {
          id: 'foxpost.warehouse.dkim',
          field: 'dkim_domain',
          pattern: '^foxpost\\.hu$',
          required: true,
          source_ids: ['foxpost-observed-auth'],
        },
        {
          id: 'foxpost.warehouse.subject',
          field: 'subject',
          pattern: '^Csomagod m[aá]r a rakt[aá]runkban van$',
          required: true,
          source_ids: ['foxpost-observed-warehouse'],
        },
        {
          id: 'foxpost.warehouse.arrived',
          field: 'body',
          pattern: '(?:be[eé]rkezett|m[aá]r) rakt[aá]runkba[n]?',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['foxpost-observed-warehouse'],
        },
        {
          id: 'foxpost.warehouse.tracking',
          field: 'body',
          pattern: 'Csomagod azonos[ií]t[oó]sz[aá]ma\\s*:\\s*\\[?CLFOX[0-9]+',
          required: true,
          source_ids: ['foxpost-observed-warehouse', 'foxpost-official-pickup'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
    {
      event: 'READY_FOR_PICKUP',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'foxpost.ready.dkim',
          field: 'dkim_domain',
          pattern: '^foxpost\\.hu$',
          required: true,
          source_ids: ['foxpost-observed-auth'],
        },
        {
          id: 'foxpost.ready.subject',
          field: 'subject',
          pattern: '^Csomagod meg[eé]rkezett$',
          required: true,
          source_ids: ['foxpost-observed-ready'],
        },
        {
          id: 'foxpost.ready.available',
          field: 'body',
          pattern: 'csomagod meg[eé]rkezett, amely [aá]tvehet[oő]',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['foxpost-observed-ready', 'foxpost-official-pickup'],
        },
        {
          id: 'foxpost.ready.locker',
          field: 'body',
          pattern: 'Csomagautomata megnevez[eé]se\\s*:',
          required: true,
          source_ids: ['foxpost-observed-ready'],
        },
        {
          id: 'foxpost.ready.tracking',
          field: 'body',
          pattern: 'Csomagod FOXPOST azonos[ií]t[oó]sz[aá]ma\\s*:\\s*\\[?CLFOX[0-9]+',
          required: true,
          source_ids: ['foxpost-observed-ready', 'foxpost-official-pickup'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
  ],
  notes: [
    'Direct carrier evidence outranks merchant status wording for physical parcel progress.',
    'Előértesítés is only SHIPMENT_CREATED: the observed email explicitly says the parcel has not yet been handed to FOXPOST.',
    'Csomagod már a raktárunkban van is IN_TRANSIT because FOXPOST itself confirms warehouse possession, but the email must not invent a shipped_at timestamp.',
    'Csomagod megérkezett means READY_FOR_PICKUP for locker deliveries, not DELIVERED. Official FOXPOST documentation also describes this email as the notification sent when the parcel has been placed in the selected locker and can be collected.',
    'No DELIVERED rule is enabled because no separate, source-backed recipient email proving actual locker pickup was identified in this research pass.',
    'Mailjet transport/return-path is intentionally not used as carrier identity. Exact FOXPOST sender plus foxpost.hu DKIM is required.',
    'The profile is test/shadow only and cannot create a Purchase or write live lifecycle state.',
  ],
};
