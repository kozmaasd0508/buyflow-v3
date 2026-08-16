import type { ProtocolProfile } from '../types.js';

/**
 * Research-only MediaMarkt Hungary profile.
 *
 * Current official MediaMarkt documentation proves several lifecycle
 * boundaries, but the connected Gmail mailbox contains no direct MediaMarkt
 * transactional recipient email from which sender address, DKIM/return-path
 * and exact template wording can be verified. Therefore this profile is a
 * candidate collector only: it must never enter automatic decisions.
 */
export const MEDIAMARKT_MERCHANT_RESEARCH_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.mediamarkt',
  protocol_version: '1.0.0-research.1',
  kind: 'merchant',
  status: 'research',
  display_name: 'MediaMarkt Hungary',
  country: 'HU',
  sender_domains: ['mediamarkt.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'mediamarkt-official-aszf-2026',
      title: 'MediaMarkt Hungary webáruház ÁSZF - order receipt vs acceptance',
      url: 'https://www.mediamarkt.hu/hu/legal/aszf/aszf',
      provenance: 'official_documentation',
      notes: 'The first automated email only acknowledges that the order arrived and does not mean acceptance. A separate second email communicates order acceptance and contract formation.',
    },
    {
      id: 'mediamarkt-official-delivery',
      title: 'MediaMarkt Hungary - Mikor kapom meg a rendelésemet?',
      url: 'https://info.mediamarkt.hu/app/answers/detail/a_id/15891/~/mikor-kapom-meg-a-rendel%C3%A9semet%3F',
      provenance: 'official_documentation',
      notes: 'After preparation and physical handoff to the logistics partner, MediaMarkt sends another electronic notification containing a parcel identifier and tracking link.',
    },
    {
      id: 'mediamarkt-official-pickup',
      title: 'MediaMarkt Hungary - Rendelés átvétel időpont foglalással',
      url: 'https://www.mediamarkt.hu/hu/service/rendeles_atveteli_idoponttal',
      provenance: 'official_documentation',
      notes: 'For store pickup, the customer receives a notification when the order is prepared; the email can contain an Időpontot foglalok action. Ready for pickup is not delivered.',
    },
    {
      id: 'mediamarkt-official-invoice',
      title: 'MediaMarkt Hungary - Mikor kapom meg a számlát?',
      url: 'https://info.mediamarkt.hu/app/answers/detail/a_id/15867/~/mikor-kapom-meg-a-sz%C3%A1ml%C3%A1t%3F',
      provenance: 'official_documentation',
      notes: 'For web orders the electronic PDF invoice is sent at logistics handoff by Számlaközpont Zrt., so invoice authority is separate from the MediaMarkt merchant channel.',
    },
    {
      id: 'mediamarkt-official-payment',
      title: 'MediaMarkt Hungary - Fizetési lehetőségek',
      url: 'https://www.mediamarkt.hu/hu/service/fizetesi-lehetosegek',
      provenance: 'official_documentation',
      notes: 'Online card-payment security is handled by SimplePay. Direct SimplePay evidence remains higher payment authority than merchant wording.',
    },
    {
      id: 'mediamarkt-official-returns',
      title: 'MediaMarkt Hungary - Gyártói garancia és elállás',
      url: 'https://www.mediamarkt.hu/hu/service/gyartoi-garancia-es-elallas',
      provenance: 'official_documentation',
      notes: 'MediaMarkt documents return and cancellation rights, but no verified recipient return/refund email template was found in the connected mailbox.',
    },
    {
      id: 'mediamarkt-research-wording',
      title: 'Synthetic research wording derived from official lifecycle semantics',
      provenance: 'inferred',
      observed_at: '2026-08-16',
      notes: 'These phrases are intentionally synthetic candidate probes, not claimed recipient templates. They exist only to collect future shadow matches for manual verification.',
    },
  ],
  events: [
    {
      event: 'OTHER',
      base_confidence: 0.58,
      positive_rules: [
        {
          id: 'mediamarkt.order-received.arrived',
          field: 'body',
          pattern: '(?:megrendel[eé]s|rendel[eé]s)[\\s\\S]{0,140}(?:meg[eé]rkezett|be[eé]rkezett|r[oö]gz[ií]t[eé]sre ker[uü]lt)',
          required: true,
          source_ids: ['mediamarkt-official-aszf-2026', 'mediamarkt-research-wording'],
        },
        {
          id: 'mediamarkt.order-received.not-acceptance',
          field: 'body',
          pattern: '(?:nem jelenti[\\s\\S]{0,120}(?:elfogad[aá]s|szerz[oő]d[eé]s)|(?:elfogad[aá]s|szerz[oő]d[eé]s)[\\s\\S]{0,120}k[uü]l[oö]n)',
          required: true,
          source_ids: ['mediamarkt-official-aszf-2026', 'mediamarkt-research-wording'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_AUTO_LINK',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_IN_TRANSIT',
        'DO_NOT_MARK_DELIVERED',
        'DO_NOT_MARK_REFUNDED',
      ],
    },
    {
      event: 'SHIPPED',
      base_confidence: 0.72,
      positive_rules: [
        {
          id: 'mediamarkt.handoff.physical',
          field: 'body',
          pattern: '(?:[aá]tadtuk|[aá]tad[aá]sra ker[uü]lt)[\\s\\S]{0,120}(?:logisztikai partner|sz[aá]ll[ií]t[oó] partner|fut[aá]r)',
          required: true,
          source_ids: ['mediamarkt-official-delivery', 'mediamarkt-research-wording'],
        },
        {
          id: 'mediamarkt.handoff.tracking-evidence',
          field: 'body',
          pattern: '(?:csomagazonos[ií]t[oó]|nyomon k[oö]vet|tracking)',
          required: true,
          source_ids: ['mediamarkt-official-delivery', 'mediamarkt-research-wording'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_AUTO_LINK',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_IN_TRANSIT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
    {
      event: 'READY_FOR_PICKUP',
      base_confidence: 0.7,
      positive_rules: [
        {
          id: 'mediamarkt.pickup.ready',
          field: 'body',
          pattern: 'rendel[eé]s[\\s\\S]{0,160}(?:elk[eé]sz[uü]lt|[aá]tvehet[oő])',
          required: true,
          source_ids: ['mediamarkt-official-pickup', 'mediamarkt-research-wording'],
        },
        {
          id: 'mediamarkt.pickup.store-proof',
          field: 'body',
          pattern: '(?:[aá]ruh[aá]z|Id[oő]pontot foglalok|QR k[oó]d)',
          required: true,
          source_ids: ['mediamarkt-official-pickup', 'mediamarkt-research-wording'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_AUTO_LINK',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
  ],
  notes: [
    'RESEARCH ONLY: sender address, DKIM domain, return-path and exact recipient templates are not verified from a direct MediaMarkt transaction email.',
    'The first order-receipt acknowledgement is explicitly not order acceptance under the current MediaMarkt ÁSZF and must not create a BuyFlow purchase automatically.',
    'A later separate order-acceptance email exists officially, but no exact recipient template is implemented without a verified sample.',
    'Merchant handoff can suggest SHIPPED, but direct carrier evidence has higher logistics authority.',
    'Store pickup readiness is READY_FOR_PICKUP, never DELIVERED.',
    'MediaMarkt web invoices are sent by Számlaközpont Zrt.; do not treat arbitrary MediaMarkt merchant mail as direct invoice-provider authority.',
    'Online card payments use SimplePay; merchant wording must not override direct SimplePay payment evidence.',
    'No positive CANCELLED, RETURN, REFUNDED, INVOICE, PAYMENT_SUCCESS or DELIVERED rule is implemented without verified recipient templates.',
  ],
};
