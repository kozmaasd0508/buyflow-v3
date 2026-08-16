import type { ProtocolProfile } from '../types.js';

/**
 * Direct GLS Hungary carrier profile derived from sanitized observed recipient
 * notifications plus current GLS Hungary documentation.
 *
 * The profile is intentionally conservative: carrier pre-advice is not treated
 * as physical possession, locker placement is not treated as recipient pickup,
 * and DELIVERED is only emitted for the observed GLS locker COD receipt that
 * explicitly states the parcel was taken out of the locker.
 */
export const GLS_HUNGARY_CARRIER_TEST_V1: ProtocolProfile = {
  protocol_id: 'carrier.hu.gls',
  protocol_version: '1.0.0-test.1',
  kind: 'carrier',
  status: 'test',
  display_name: 'GLS Hungary',
  country: 'HU',
  sender_domains: ['gls-hungary.com'],
  sender_addresses: ['noreply@gls-hungary.com'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [
      'GLS\\s+([0-9]{10})\\s+mai\\s+k[eé]zbes[ií]t[eé]se',
      '[ÉE]rtes[ií]t[eé]s a\\s+([0-9]{10})\\s+sz[aá]m[uú] csomag GLS Automat[aá]ba',
      'Csomagsz[aá]m\\s*:\\s*\\[?([0-9]{10})',
      'paymentReceipt_([0-9]{10})\\.pdf',
    ],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'gls-official-flexdelivery',
      title: 'GLS Hungary FlexDeliveryService notifications',
      url: 'https://gls-group.com/HU/en/business-customer/how-to-ship-with-gls/services/',
      provenance: 'official_documentation',
      notes: 'GLS documents an early notification when goods are ready to be shipped, a second notification on the delivery morning with a three-hour window, and a third notification after an unsuccessful first attempt.',
    },
    {
      id: 'gls-official-locker',
      title: 'GLS Hungary Parcel Locker receiving and notification',
      url: 'https://gls-group.com/HU/en/gls-points/parcel-lockers/',
      provenance: 'official_documentation',
      notes: 'GLS documents email/SMS/Viber notification when a parcel can be picked up from a locker and states that pickup uses a PIN or QR code.',
    },
    {
      id: 'gls-observed-preadvice',
      title: 'Observed GLS parcel information emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple real recipient emails used the parcel-information subject and stated that the GLS partner had prepared parcel(s), with delivery planned only after dispatch/arrival. Private recipient, address and parcel data are not stored.',
    },
    {
      id: 'gls-observed-out-for-delivery',
      title: 'Observed GLS delivery-today emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple real recipient emails used a GLS <parcel> mai kézbesítése / delivery today subject and explicitly said GLS would attempt delivery that day with a three-hour delivery window.',
    },
    {
      id: 'gls-observed-locker-ready',
      title: 'Observed GLS Parcel Locker placement emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated real recipient emails explicitly stated that the parcel had been placed in a GLS Parcel Locker and supplied pickup credentials and a pickup deadline.',
    },
    {
      id: 'gls-observed-locker-receipt',
      title: 'Observed GLS locker COD pickup receipts (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated real GLS emails explicitly described the attached receipt as the COD receipt of a parcel already taken out of a GLS parcel locker. The attachment filename carried the same ten-digit parcel identifier family.',
    },
    {
      id: 'gls-observed-auth',
      title: 'Observed GLS Hungary authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME from parcel-information, delivery-today, locker-placement and COD-receipt messages verified noreply@gls-hungary.com with DKIM pass and DMARC pass for gls-hungary.com.',
    },
  ],
  events: [
    {
      event: 'SHIPMENT_CREATED',
      base_confidence: 0.98,
      positive_rules: [
        {
          id: 'gls.preadvice.dkim',
          field: 'dkim_domain',
          pattern: '^gls-hungary\\.com$',
          required: true,
          source_ids: ['gls-observed-auth'],
        },
        {
          id: 'gls.preadvice.subject',
          field: 'subject',
          pattern: '^GLS(?: [ÁA]tad[oó]pont)? csomag ?inform[aá]ci[oó] / GLS(?: DeliveryPoints)? parcel information$',
          required: true,
          source_ids: ['gls-observed-preadvice', 'gls-official-flexdelivery'],
        },
        {
          id: 'gls.preadvice.prepared',
          field: 'body',
          pattern: 'partner[uü]nk csomago.*k[eé]sz[ií]tett [oö]ssze sz[aá]modra',
          required: true,
          source_ids: ['gls-observed-preadvice'],
        },
        {
          id: 'gls.preadvice.future-attempt',
          field: 'body',
          pattern: '(?:felad[aá]st|be[eé]rkez[eé]st) k[oö]vet[oő] munkanapon megk[ií]s[eé]relj[uü]k k[eé]zbes[ií]teni',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['gls-observed-preadvice', 'gls-official-flexdelivery'],
        },
        {
          id: 'gls.preadvice.tracking',
          field: 'body',
          pattern: 'Csomagsz[aá]m\\s*:\\s*\\[?[0-9]{10}',
          required: true,
          source_ids: ['gls-observed-preadvice'],
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
          id: 'gls.out.dkim',
          field: 'dkim_domain',
          pattern: '^gls-hungary\\.com$',
          required: true,
          source_ids: ['gls-observed-auth'],
        },
        {
          id: 'gls.out.subject',
          field: 'subject',
          pattern: '^GLS [0-9]{10} mai k[eé]zbes[ií]t[eé]se / GLS [0-9]{10} delivery today$',
          required: true,
          source_ids: ['gls-observed-out-for-delivery', 'gls-official-flexdelivery'],
        },
        {
          id: 'gls.out.attempt-today',
          field: 'body',
          pattern: 'mai napon megk[ií]s[eé]relj[uü]k k[eé]zbes[ií]teni',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['gls-observed-out-for-delivery'],
        },
        {
          id: 'gls.out.window',
          field: 'body',
          pattern: 'Tervezett k[eé]zbes[ií]t[eé]s\\s*:',
          required: true,
          source_ids: ['gls-observed-out-for-delivery', 'gls-official-flexdelivery'],
        },
        {
          id: 'gls.out.tracking',
          field: 'body',
          pattern: 'Csomagsz[aá]m\\s*:\\s*\\[?[0-9]{10}',
          required: true,
          source_ids: ['gls-observed-out-for-delivery'],
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
          id: 'gls.ready.dkim',
          field: 'dkim_domain',
          pattern: '^gls-hungary\\.com$',
          required: true,
          source_ids: ['gls-observed-auth'],
        },
        {
          id: 'gls.ready.subject',
          field: 'subject',
          pattern: '^[ÉE]rtes[ií]t[eé]s a [0-9]{10} sz[aá]m[uú] csomag GLS Automat[aá]ba helyez[eé]s[eé]r[oő]l$',
          required: true,
          source_ids: ['gls-observed-locker-ready'],
        },
        {
          id: 'gls.ready.placed',
          field: 'body',
          pattern: '[0-9]{10} sz[aá]m[uú] csomagodat elhelyezt[uü]k GLS Automat[aá]nkban',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['gls-observed-locker-ready', 'gls-official-locker'],
        },
        {
          id: 'gls.ready.pickup-credential',
          field: 'body',
          pattern: 'Csomagod [aá]tv[eé]tel[eé]hez.*(?:nyit[oó]k[oó]dot|QR-k[oó]dot)',
          required: true,
          source_ids: ['gls-observed-locker-ready', 'gls-official-locker'],
        },
        {
          id: 'gls.ready.deadline',
          field: 'body',
          pattern: '[ÁA]tv[eé]teli hat[aá]rid[oő]\\s*:',
          required: true,
          source_ids: ['gls-observed-locker-ready'],
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
          id: 'gls.delivered.dkim',
          field: 'dkim_domain',
          pattern: '^gls-hungary\\.com$',
          required: true,
          source_ids: ['gls-observed-auth'],
        },
        {
          id: 'gls.delivered.subject',
          field: 'subject',
          pattern: '^Ut[aá]nv[eé]tes fizet[eé]s visszaigazol[aá]s$',
          required: true,
          source_ids: ['gls-observed-locker-receipt'],
        },
        {
          id: 'gls.delivered.picked-up',
          field: 'body',
          pattern: 'GLS Automat[aá]ban [aá]tvett csomag ut[aá]nv[eé]t nyugt[aá]j[aá]t',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['gls-observed-locker-receipt'],
        },
        {
          id: 'gls.delivered.receipt-attachment',
          field: 'attachment_filename',
          pattern: '^paymentReceipt_[0-9]{10}\\.pdf$',
          required: true,
          source_ids: ['gls-observed-locker-receipt'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
      ],
    },
  ],
  notes: [
    'Direct GLS carrier evidence outranks merchant status wording for physical parcel progress.',
    'GLS parcel information is SHIPMENT_CREATED only: observed wording says the partner prepared the parcel and makes delivery conditional on later dispatch/arrival at GLS.',
    'The delivery-today notification is OUT_FOR_DELIVERY because GLS explicitly says it will attempt delivery that day and supplies a three-hour delivery window.',
    'GLS Parcel Locker placement is READY_FOR_PICKUP, never DELIVERED; the email supplies pickup credentials and a storage deadline.',
    'DELIVERED is intentionally narrow: only the observed COD receipt email with a paymentReceipt_<parcel>.pdf attachment and explicit wording that the parcel was already taken out of the GLS locker qualifies.',
    'The COD receipt is not generalized into PAYMENT_SUCCESS here; payment-provider semantics remain a separate research layer.',
    'Dynamic tracking and satisfaction-survey messages are not lifecycle events by themselves.',
    'Exact GLS sender identity plus gls-hungary.com DKIM is required. Lookalike sender domains or DKIM domains must not qualify.',
    'The profile is test/shadow only and cannot create a Purchase or write live lifecycle state.',
  ],
};
