import type { ProtocolProfile } from '../types.js';

/**
 * Direct Magyar Posta / MPL carrier profile derived from repeated sanitized
 * recipient notifications plus current Magyar Posta customer documentation.
 *
 * The profile is intentionally conservative: the recipient-side posting notice
 * is SHIPMENT_CREATED rather than an invented SHIPPED timestamp; direct courier
 * possession is OUT_FOR_DELIVERY; failed delivery and post-office availability
 * remain separate; DELIVERED requires explicit Posta wording that delivery
 * successfully completed.
 */
export const MPL_CARRIER_TEST_V1: ProtocolProfile = {
  protocol_id: 'carrier.hu.mpl',
  protocol_version: '1.0.0-test.1',
  kind: 'carrier',
  status: 'test',
  display_name: 'Magyar Posta Logisztika (MPL)',
  country: 'HU',
  sender_domains: ['posta.hu'],
  sender_addresses: ['kozponti.ertesites@posta.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [
      '(?:K[uü]ldem[eé]nyazonos[ií]t[oó]|Csomagazonos[ií]t[oó])\\s*:\\s*\\[?([A-Z0-9]{10,20})',
      'A\\s+([A-Z0-9]{10,20})\\s+k[uü]ldem[eé]ny k[eé]zbes[ií]t[eé]se sikeresen megt[oö]rt[eé]nt',
      'ids=([A-Z0-9]{10,20})',
    ],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'mpl-official-domestic-notifications',
      title: 'Magyar Posta - Belföldi csomagküldemények értesítései',
      url: 'https://posta.hu/kuldemeny_erkezese/elektronikus_ugyfelertesites_belfold',
      provenance: 'official_documentation',
      notes: 'Magyar Posta documents separate recipient notifications for posting/acceptance, delivery/courier allocation, unsuccessful delivery, pickup warnings, locker pickup confirmation and post-delivery feedback.',
    },
    {
      id: 'mpl-official-locker',
      title: 'Magyar Posta - Csomagautomata',
      url: 'https://www.posta.hu/csomagautomata',
      provenance: 'official_documentation',
      notes: 'The official locker flow distinguishes arrival/ready-for-pickup from actual pickup and states that successful delivery/pickup is followed by an electronic confirmation.',
    },
    {
      id: 'mpl-observed-created-legacy',
      title: 'Observed MPL Csomagküldemény recipient emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Many real recipient messages across 2025-2026 used subject Csomagküldemény, explicit posting wording, a parcel identifier and a posting date.',
    },
    {
      id: 'mpl-observed-created-current',
      title: 'Observed MPL Csomagot adtak fel neked recipient email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A newer observed wording changed the subject and labels to Csomagot adtak fel neked / Csomagazonosító while preserving the same authenticated Posta infrastructure and lifecycle meaning.',
    },
    {
      id: 'mpl-observed-out-for-delivery',
      title: 'Observed MPL courier-allocation emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated real emails used Csomagja/Csomagod a kézbesítőnél van and stated either that the courier had taken the parcel for same-day delivery or supplied an expected arrival window and courier phone number.',
    },
    {
      id: 'mpl-observed-failed',
      title: 'Observed MPL Sikertelen kézbesítés email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A real notification explicitly stated the delivery attempt was unsuccessful and that a later message would explain post-office pickup.',
    },
    {
      id: 'mpl-observed-ready',
      title: 'Observed MPL post-office pickup emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Observed old and new templates used Csomagja érkezett / Csomagod a postán átvehető and explicitly stated that the parcel was available at a named post office for a defined pickup period.',
    },
    {
      id: 'mpl-observed-delivered',
      title: 'Observed MPL post-delivery feedback emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple real authenticated feedback emails explicitly stated that the identified parcel delivery had successfully completed. The survey subject alone is not sufficient.',
    },
    {
      id: 'mpl-observed-auth',
      title: 'Observed Magyar Posta authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME from posting, courier, failed-delivery, pickup and delivered-feedback messages verified From kozponti.ertesites@posta.hu, DKIM pass for posta.hu, SPF pass and DMARC pass; smtpN.posta.hu transport was also observed.',
    },
  ],
  events: [
    {
      event: 'SHIPMENT_CREATED',
      base_confidence: 0.98,
      positive_rules: [
        {
          id: 'mpl.created.dkim',
          field: 'dkim_domain',
          pattern: '^posta\\.hu$',
          required: true,
          source_ids: ['mpl-observed-auth'],
        },
        {
          id: 'mpl.created.subject',
          field: 'subject',
          pattern: '^(?:Csomagk[uü]ldem[eé]ny|Csomagot adtak fel neked)$',
          required: true,
          source_ids: ['mpl-observed-created-legacy', 'mpl-observed-created-current', 'mpl-official-domestic-notifications'],
        },
        {
          id: 'mpl.created.posted',
          field: 'body',
          pattern: '(?:csomagk[uü]ldem[eé]nyt adtak fel [ÖO]nnek|csomagot adtak fel Neked)',
          required: true,
          source_ids: ['mpl-observed-created-legacy', 'mpl-observed-created-current'],
        },
        {
          id: 'mpl.created.tracking',
          field: 'body',
          pattern: '(?:K[uü]ldem[eé]nyazonos[ií]t[oó]|Csomagazonos[ií]t[oó])\\s*:\\s*\\[?[A-Z0-9]{10,20}',
          required: true,
          source_ids: ['mpl-observed-created-legacy', 'mpl-observed-created-current'],
        },
        {
          id: 'mpl.created.posting-date',
          field: 'body',
          pattern: 'Felad[aá]s d[aá]tuma\\s*:',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['mpl-observed-created-legacy', 'mpl-observed-created-current'],
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
      event: 'OUT_FOR_DELIVERY',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'mpl.out.dkim',
          field: 'dkim_domain',
          pattern: '^posta\\.hu$',
          required: true,
          source_ids: ['mpl-observed-auth'],
        },
        {
          id: 'mpl.out.subject',
          field: 'subject',
          pattern: '^Csomag(?:ja|od) a k[eé]zbes[ií]t[oő]n[eé]l van$',
          required: true,
          source_ids: ['mpl-observed-out-for-delivery', 'mpl-official-domestic-notifications'],
        },
        {
          id: 'mpl.out.direct-courier-evidence',
          field: 'body',
          pattern: '(?:k[eé]zbes[ií]t[oő]nk [aá]tvette, [ií]gy azt a mai napon megk[ií]s[eé]relj[uü]k.*k[eé]zbes[ií]teni|[ÉE]rtes[ií]t[uü]nk, hogy csomagod a k[eé]zbes[ií]t[oő]n[eé]l van)',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['mpl-observed-out-for-delivery', 'mpl-official-domestic-notifications'],
        },
        {
          id: 'mpl.out.tracking',
          field: 'body',
          pattern: '(?:K[uü]ldem[eé]nyazonos[ií]t[oó]|Csomagazonos[ií]t[oó])\\s*:\\s*\\[?[A-Z0-9]{10,20}',
          required: true,
          source_ids: ['mpl-observed-out-for-delivery'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
    {
      event: 'DELIVERY_FAILED',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'mpl.failed.dkim',
          field: 'dkim_domain',
          pattern: '^posta\\.hu$',
          required: true,
          source_ids: ['mpl-observed-auth'],
        },
        {
          id: 'mpl.failed.subject',
          field: 'subject',
          pattern: '^Sikertelen k[eé]zbes[ií]t[eé]s$',
          required: true,
          source_ids: ['mpl-observed-failed', 'mpl-official-domestic-notifications'],
        },
        {
          id: 'mpl.failed.explicit',
          field: 'body',
          pattern: 'nem j[aá]rt sikerrel csomagj[aá]nak k[eé]zbes[ií]t[eé]s[eé]vel',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['mpl-observed-failed', 'mpl-official-domestic-notifications'],
        },
        {
          id: 'mpl.failed.tracking',
          field: 'body',
          pattern: '(?:K[uü]ldem[eé]nyazonos[ií]t[oó]|Csomagazonos[ií]t[oó])\\s*:\\s*\\[?[A-Z0-9]{10,20}',
          required: true,
          source_ids: ['mpl-observed-failed'],
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
          id: 'mpl.ready.dkim',
          field: 'dkim_domain',
          pattern: '^posta\\.hu$',
          required: true,
          source_ids: ['mpl-observed-auth'],
        },
        {
          id: 'mpl.ready.subject',
          field: 'subject',
          pattern: '^(?:Csomagja [eé]rkezett|Csomagod a post[aá]n [aá]tvehet[oő])$',
          required: true,
          source_ids: ['mpl-observed-ready', 'mpl-official-domestic-notifications'],
        },
        {
          id: 'mpl.ready.available',
          field: 'body',
          pattern: '(?:csomagja [aá]tvehet[oő] az al[aá]bbi post[aá]n|csomagod .*?[aá]tvehet[oő] az al[aá]bbi post[aá]n)',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['mpl-observed-ready', 'mpl-official-domestic-notifications'],
        },
        {
          id: 'mpl.ready.location',
          field: 'body',
          pattern: '[ÁA]tv[eé]tel helye\\s*:',
          required: true,
          source_ids: ['mpl-observed-ready'],
        },
        {
          id: 'mpl.ready.tracking',
          field: 'body',
          pattern: '(?:K[uü]ldem[eé]nyazonos[ií]t[oó]|Csomagazonos[ií]t[oó])\\s*:\\s*\\[?[A-Z0-9]{10,20}',
          required: true,
          source_ids: ['mpl-observed-ready'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
    {
      event: 'DELIVERED',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'mpl.delivered.dkim',
          field: 'dkim_domain',
          pattern: '^posta\\.hu$',
          required: true,
          source_ids: ['mpl-observed-auth'],
        },
        {
          id: 'mpl.delivered.subject',
          field: 'subject',
          pattern: '^V[eé]lem[eé]nye fontos sz[aá]munkra!$',
          required: true,
          source_ids: ['mpl-observed-delivered'],
        },
        {
          id: 'mpl.delivered.explicit',
          field: 'body',
          pattern: 'A [A-Z0-9]{10,20} k[uü]ldem[eé]ny k[eé]zbes[ií]t[eé]se sikeresen megt[oö]rt[eé]nt',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['mpl-observed-delivered', 'mpl-official-domestic-notifications'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
      ],
    },
  ],
  notes: [
    'Direct MPL carrier evidence outranks merchant status wording for physical parcel progress.',
    'Csomagküldemény / Csomagot adtak fel neked is intentionally SHIPMENT_CREATED rather than SHIPPED. The recipient notice proves a Posta parcel identity and posting date but BuyFlow does not fabricate a shipped_at timestamp from that template.',
    'Csomagja/Csomagod a kézbesítőnél van is OUT_FOR_DELIVERY because the Posta directly confirms courier allocation and same-day delivery intent or provides the current courier window.',
    'Sikertelen kézbesítés is DELIVERY_FAILED. It must not be collapsed into READY_FOR_PICKUP because the Posta sends a separate later message when post-office pickup actually becomes available.',
    'Csomagja érkezett / Csomagod a postán átvehető is READY_FOR_PICKUP, never DELIVERED.',
    'Véleménye fontos számunkra! is DELIVERED only when the body explicitly states that the identified parcel delivery successfully completed; a generic survey/feedback subject alone is not lifecycle evidence.',
    'Official Posta documentation says locker pickup confirmation is sent after actual pickup, but no exact observed recipient template was available in this mailbox pass, so no locker-specific DELIVERED pattern is invented here.',
    'Exact kozponti.ertesites@posta.hu sender identity plus posta.hu DKIM is required. Allegro relay mail or lookalike domains must not qualify as direct MPL authority.',
    'Payment emails from the same Posta sender are outside this carrier lifecycle profile and must not become parcel events without the lifecycle structure above.',
    'The profile is test/shadow only and cannot create a Purchase or write live lifecycle state.',
  ],
};
