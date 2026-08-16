import type { ProtocolProfile } from '../types.js';

/**
 * Direct DPD Hungary recipient-notification profile derived from repeated
 * sanitized real emails plus current DPD Hungary recipient documentation.
 *
 * DPD has an important subject-line ambiguity: older pre-advice can use a
 * `küldemény feladásáról` subject even though the body explicitly says the
 * parcel has not yet been physically handed to DPD. For that reason lifecycle
 * promotion always requires explicit body semantics, never subject wording alone.
 */
export const DPD_HUNGARY_CARRIER_TEST_V1: ProtocolProfile = {
  protocol_id: 'carrier.hu.dpd',
  protocol_version: '1.0.0-test.1',
  kind: 'carrier',
  status: 'test',
  display_name: 'DPD Hungary',
  country: 'HU',
  sender_domains: ['dpd.hu'],
  sender_addresses: ['noreply@dpd.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [
      '[ÉE]rtes[ií]t[eé]s\\s+([0-9]{14})',
      '(?:Felad[oó] [eé]s csomagsz[aá]m|Csomagsz[aá]m)\\s*[\\s\\S]{0,160}?([0-9]{14})',
      '(?:elutas[ií]tott|hogy)\\s+([0-9]{14})(?:\\s+sz[aá]m[uú])?\\s+(?:csomag|k[uü]ldem[eé]ny)',
    ],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'dpd-official-recipient-predict',
      title: 'DPD Hungary - Címzettek / Predict értesítési folyamat',
      url: 'https://www.dpd.com/hu/hu/cimzettek/',
      provenance: 'official_documentation',
      notes: 'DPD documents a pickup-day recipient email stating that the parcel has reached DPD, followed by a delivery-day email with a one-hour delivery window and courier delivery intent.',
    },
    {
      id: 'dpd-official-refusal',
      title: 'DPD Hungary - Küldemény elutasítása',
      url: 'https://www.dpd.com/hu/hu/faq/warum-bewegt-sich-das-zustellfahrzeug-mal-naeher-mal-weiter-weg-von-meinem-haus-und-kommt-nicht-zu-mir/',
      provenance: 'official_documentation',
      notes: 'DPD states that once a recipient rejects a parcel it is turned back to the sender and can no longer be redirected by the recipient.',
    },
    {
      id: 'dpd-observed-preadvice',
      title: 'Observed DPD recipient pre-advice emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated real emails used preparation/pre-advice wording, a 14-digit parcel number and explicitly stated that the parcel had not yet been physically handed to DPD. Older examples could still use a feladásáról subject.',
    },
    {
      id: 'dpd-observed-shipped',
      title: 'Observed DPD physical pickup / dispatch emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated real emails used a merchant-qualified küldemény feladásáról subject and stated that the merchant had handed/sent the recipient parcel that day, with expected next-business-day delivery. Current DPD Predict documentation independently describes this pickup-day mail as the point where the parcel has reached DPD.',
    },
    {
      id: 'dpd-observed-out-for-delivery',
      title: 'Observed DPD delivery-today emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Many real emails across multiple merchants and months stated that the DPD courier had taken the parcel for delivery that day and supplied a one-hour expected delivery window.',
    },
    {
      id: 'dpd-observed-delivered',
      title: 'Observed DPD successful-delivery emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Many real emails explicitly stated that the identified 14-digit parcel had been successfully delivered that day. Subject variants with and without the word küldemény were observed.',
    },
    {
      id: 'dpd-observed-refused-return',
      title: 'Observed DPD recipient-refusal return email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A real authenticated DPD email explicitly stated that the recipient-rejected parcel would be transported back to the sender.',
    },
    {
      id: 'dpd-observed-auth',
      title: 'Observed DPD Hungary authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME from pre-advice, physical dispatch, delivery-today, delivered and refusal messages verified exact From noreply@dpd.hu, DKIM pass for dpd.hu, SPF pass and DMARC pass. srv5.dpd.hu transport was observed but is not required as the carrier identity gate.',
    },
    {
      id: 'dpd-observed-non-lifecycle',
      title: 'Observed DPD non-lifecycle mail families (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Observed DPD mail also includes myDPD redirect confirmations from noreply@dpdgroup.com, card/payment receipts from noreply@notif.dpd.hu or noreply@dpd.hu, and satisfaction surveys from velemeny@adat.dpd.hu. These do not independently advance a purchase shipment lifecycle.',
    },
  ],
  events: [
    {
      event: 'SHIPMENT_CREATED',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'dpd.created.dkim',
          field: 'dkim_domain',
          pattern: '^dpd\\.hu$',
          required: true,
          source_ids: ['dpd-observed-auth'],
        },
        {
          id: 'dpd.created.subject',
          field: 'subject',
          pattern: '^[ÉE]rtes[ií]t[eé]s [0-9]{14} k[uü]ldem[eé]ny (?:el[oő]k[eé]sz[ií]t[eé]s[eé]r[oóő]l|felad[aá]s[aá]r[oóő]l)$',
          required: true,
          source_ids: ['dpd-observed-preadvice'],
        },
        {
          id: 'dpd.created.prepared',
          field: 'body',
          pattern: 'partner[uü]nk[\\s\\S]*csomag(?:o\\(ka\\)t|\\(okat\\)|okat)[\\s\\S]*k[eé]sz[ií]tett [oö]ssze',
          required: true,
          source_ids: ['dpd-observed-preadvice'],
        },
        {
          id: 'dpd.created.not-handed-over',
          field: 'body',
          pattern: '(?:ez egy el[oő][eé]rtes[ií]t[eé]s[\\s\\S]*)?a csomag\\(ok\\) fizikailag m[eé]g nem ker[uü]lt\\(ek\\) [aá]tad[aá]sra r[eé]sz[uü]nkre',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['dpd-observed-preadvice'],
        },
        {
          id: 'dpd.created.tracking',
          field: 'body',
          pattern: '[0-9]{14}',
          required: true,
          source_ids: ['dpd-observed-preadvice'],
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
      event: 'SHIPPED',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'dpd.shipped.dkim',
          field: 'dkim_domain',
          pattern: '^dpd\\.hu$',
          required: true,
          source_ids: ['dpd-observed-auth'],
        },
        {
          id: 'dpd.shipped.subject',
          field: 'subject',
          pattern: '^[ÉE]rtes[ií]t[eé]s [0-9]{14} .+ k[uü]ldem[eé]ny felad[aá]s[aá]r[oóő]l$',
          required: true,
          source_ids: ['dpd-observed-shipped'],
        },
        {
          id: 'dpd.shipped.explicit',
          field: 'body',
          pattern: '[ÉE]rtes[ií]tj[uü]k, hogy a mai napon[\\s\\S]*partner[uü]nk az [ÖO]n r[eé]sz[eé]re k[eé]zbes[ií]tend[oő] csomag(?:o\\(ka\\)t|\\(okat\\)|okat) adott fel',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['dpd-observed-shipped', 'dpd-official-recipient-predict'],
        },
        {
          id: 'dpd.shipped.next-day',
          field: 'body',
          pattern: 'V[aá]rhat[oó] kisz[aá]ll[ií]t[aá]si nap\\s*:',
          required: true,
          source_ids: ['dpd-observed-shipped', 'dpd-official-recipient-predict'],
        },
        {
          id: 'dpd.shipped.tracking',
          field: 'body',
          pattern: '[0-9]{14}',
          required: true,
          source_ids: ['dpd-observed-shipped'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
    {
      event: 'OUT_FOR_DELIVERY',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'dpd.out.dkim',
          field: 'dkim_domain',
          pattern: '^dpd\\.hu$',
          required: true,
          source_ids: ['dpd-observed-auth'],
        },
        {
          id: 'dpd.out.subject',
          field: 'subject',
          pattern: '^[ÉE]rtes[ií]t[eé]s [0-9]{14} .+ k[uü]ldem[eé]ny mai k[eé]zbes[ií]t[eé]s[eé]r[oő]l$',
          required: true,
          source_ids: ['dpd-observed-out-for-delivery', 'dpd-official-recipient-predict'],
        },
        {
          id: 'dpd.out.courier-possession',
          field: 'body',
          pattern: 'csomag(?:o\\(ka\\)t|\\(okat\\)|okat)[\\s\\S]*fut[aá]runk a mai napon k[eé]zbes[ií]t[eé]sre [aá]tvette',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['dpd-observed-out-for-delivery', 'dpd-official-recipient-predict'],
        },
        {
          id: 'dpd.out.window',
          field: 'body',
          pattern: 'fut[aá]runk a mai napon v[aá]rhat[oó]an [0-9]{1,2}:[0-9]{2}\\s*[–-]\\s*[0-9]{1,2}:[0-9]{2} k[oö]z[oö]tt sz[aá]ll[ií]tja ki',
          required: true,
          source_ids: ['dpd-observed-out-for-delivery', 'dpd-official-recipient-predict'],
        },
        {
          id: 'dpd.out.tracking',
          field: 'body',
          pattern: '[0-9]{14}',
          required: true,
          source_ids: ['dpd-observed-out-for-delivery'],
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
      base_confidence: 1,
      positive_rules: [
        {
          id: 'dpd.delivered.dkim',
          field: 'dkim_domain',
          pattern: '^dpd\\.hu$',
          required: true,
          source_ids: ['dpd-observed-auth'],
        },
        {
          id: 'dpd.delivered.subject',
          field: 'subject',
          pattern: '^[ÉE]rtes[ií]t[eé]s [0-9]{14} (?:k[uü]ldem[eé]ny )?sikeres k[eé]zbes[ií]t[eé]s[eé]r[oő]l$',
          required: true,
          source_ids: ['dpd-observed-delivered'],
        },
        {
          id: 'dpd.delivered.explicit',
          field: 'body',
          pattern: '[ÉE]rtes[ií]tj[uü]k, hogy [0-9]{14}(?: sz[aá]m[uú])? k[uü]ldem[eé]ny[eé]t a mai napon sikeresen k[eé]zbes[ií]tett[uü]k',
          required: true,
          source_ids: ['dpd-observed-delivered'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
      ],
    },
    {
      event: 'RETURN',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'dpd.return.dkim',
          field: 'dkim_domain',
          pattern: '^dpd\\.hu$',
          required: true,
          source_ids: ['dpd-observed-auth'],
        },
        {
          id: 'dpd.return.subject',
          field: 'subject',
          pattern: '^[ÉE]rtes[ií]t[eé]s [0-9]{14} k[uü]ldem[eé]ny elutas[ií]t[aá]s[aá]r[oóő]l$',
          required: true,
          source_ids: ['dpd-observed-refused-return', 'dpd-official-refusal'],
        },
        {
          id: 'dpd.return.explicit-refusal',
          field: 'body',
          pattern: 'Az [ÖO]n [aá]ltal elutas[ií]tott [0-9]{14} csomag(?:o\\(ka\\)t|\\(okat\\)|okat)[\\s\\S]*visszasz[aá]ll[ií]tjuk a felad[oó] r[eé]sz[eé]re',
          required: true,
          source_ids: ['dpd-observed-refused-return', 'dpd-official-refusal'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
        'DO_NOT_MARK_REFUNDED',
      ],
    },
  ],
  notes: [
    'Direct authenticated DPD carrier evidence outranks merchant wording for physical parcel progress.',
    'DPD subject text is not sufficient by itself. Older observed pre-advice used a küldemény feladásáról subject while the body explicitly said the parcel had not yet been physically handed to DPD.',
    'Explicit preparation plus fizikailag még nem került átadásra is SHIPMENT_CREATED only.',
    'Merchant-qualified feladásáról plus explicit same-day feladás and expected next delivery day is SHIPPED. DPD Predict documentation independently states that the pickup-day recipient email is sent when the parcel has reached DPD.',
    'SHIPPED does not fabricate an exact shipped_at timestamp from the email timestamp, therefore DO_NOT_SET_SHIPPED_AT remains present.',
    'Mai kézbesítés plus direct courier-possession wording and a one-hour window is OUT_FOR_DELIVERY, never DELIVERED.',
    'Successful delivery requires the explicit DPD sentence that the identified parcel was successfully delivered that day.',
    'Recipient refusal that DPD explicitly says is being returned to the sender maps to RETURN, but it is not a refund and must never imply REFUNDED.',
    'No DELIVERY_FAILED rule is included because no sufficiently strong direct recipient failed-delivery email was found in the researched mailbox.',
    'No READY_FOR_PICKUP rule is included because no direct DPD Pickup point/locker ready-for-pickup recipient email was verified in this mailbox pass.',
    'myDPD redirect confirmations, DPD card/payment receipts and satisfaction-survey messages do not independently advance shipment lifecycle state.',
    'Exact noreply@dpd.hu plus dpd.hu DKIM is required. Lookalike domains, tracking links, branding or subject-only matches are insufficient.',
    'The profile is test/shadow only and cannot create a Purchase or write live lifecycle state.',
  ],
};
