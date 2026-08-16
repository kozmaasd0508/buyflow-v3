import type { ProtocolProfile } from '../types.js';

/**
 * Research-only AQUA Hungary profile.
 *
 * Current official AQUA documentation proves important lifecycle boundaries,
 * but the connected Gmail mailbox contains no direct AQUA transactional
 * recipient email from which sender address, DKIM/return-path and exact
 * template wording can be verified. AQUA also changed operator/ownership in
 * November 2025, so historical templates must not be assumed current.
 */
export const AQUA_MERCHANT_RESEARCH_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.aqua',
  protocol_version: '1.0.0-research.1',
  kind: 'merchant',
  status: 'research',
  display_name: 'AQUA Hungary',
  country: 'HU',
  sender_domains: ['aqua.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'aqua-official-ordering',
      title: 'AQUA - Hogyan tudok rendelni?',
      url: 'https://aqua.hu/hogyan-tudok-rendelni.html',
      provenance: 'official_documentation',
      notes: 'After the customer submits an order, AQUA sends an email informing them of the fact of the order. The same official page states the order is considered confirmed only after feedback from an AQUA employee. The first system email therefore must not be treated as final merchant acceptance.',
    },
    {
      id: 'aqua-official-campaign-order-boundary',
      title: 'AQUA current campaign terms - reservation and confirmation boundary',
      url: 'https://aqua.hu/ajanlat/restock',
      provenance: 'official_documentation',
      notes: 'Current AQUA campaign terms state that cart placement is not reservation and products become reserved only when the order is finalized and confirmed. Delivery date/time information is sent by email, but no verified recipient delivery template is available.',
    },
    {
      id: 'aqua-official-warranty',
      title: 'AQUA - Jótállás ügyintézése',
      url: 'https://aqua.hu/biztonsag-es-garancia.html',
      provenance: 'official_documentation',
      notes: 'AQUA states that after parcel dispatch it sends the warranty certificate as a PDF. Receiving a warranty certificate documents purchase warranty coverage and is not proof that a warranty claim has started. Warranty handling itself is a separate return/inspection/service process.',
    },
    {
      id: 'aqua-official-withdrawal',
      title: 'AQUA - Elállás a szerződéstől',
      url: 'https://aqua.hu/elallas-a-szerzodestol.html',
      provenance: 'official_documentation',
      notes: 'Submitting the online withdrawal form triggers a confirmation email containing the withdrawal data and timestamp. That email proves withdrawal intent was submitted, not that the physical item has returned and not that money has been refunded.',
    },
    {
      id: 'aqua-official-payment',
      title: 'AQUA - current card-payment channel',
      url: 'https://aqua.hu/',
      provenance: 'official_documentation',
      notes: 'Current AQUA pages state online card payment is handled through the certified Saferpay gateway. Merchant wording must not be treated as direct payment-provider authority.',
    },
    {
      id: 'aqua-official-operator-change',
      title: 'AQUA - current warranty/service notice after operator change',
      url: 'https://aqua.hu/garancialisugyintezes.html',
      provenance: 'official_documentation',
      notes: 'AQUA states that operation of aqua.hu was taken over by a new owner as Aqua Hungary on 2025-11-10. This makes unverified historical sender/template assumptions especially unsafe.',
    },
    {
      id: 'aqua-connected-mailbox-gap',
      title: 'Connected mailbox AQUA transaction search (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple Gmail searches found no direct AQUA transactional recipient email. A third-party MilPay marketing email mentioned aqua.hu, but that is not AQUA merchant authority and is intentionally excluded.',
    },
    {
      id: 'aqua-research-wording',
      title: 'Synthetic AQUA research wording derived from official lifecycle semantics',
      provenance: 'inferred',
      observed_at: '2026-08-16',
      notes: 'Patterns below are synthetic probes for manual research only and are not claimed recipient email templates.',
    },
  ],
  events: [
    {
      event: 'OTHER',
      base_confidence: 0.55,
      positive_rules: [
        {
          id: 'aqua.order-submitted.fact',
          field: 'body',
          pattern: '(?:rendel[eé]s|megrendel[eé]s)[\\s\\S]{0,120}(?:feladva|elk[uü]ldve|be[eé]rkezett|r[oö]gz[ií]tett)',
          required: true,
          source_ids: ['aqua-official-ordering', 'aqua-research-wording'],
        },
        {
          id: 'aqua.order-submitted.not-final',
          field: 'body',
          pattern: '(?:[uü]gyint[eé]z[oő][\\s\\S]{0,100}(?:visszajelz[eé]s|visszaigazol)|(?:visszaigazoltnak|elfogadottnak)[\\s\\S]{0,120}(?:csak|kiz[aá]r[oó]lag))',
          required: true,
          source_ids: ['aqua-official-ordering', 'aqua-research-wording'],
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
      event: 'ORDER_CREATED',
      base_confidence: 0.62,
      positive_rules: [
        {
          id: 'aqua.order-confirmed.explicit',
          field: 'body',
          pattern: '(?:rendel[eé]s|megrendel[eé]s)[\\s\\S]{0,100}(?:sikeresen\\s+visszaigazol|visszaigazoltuk|elfogadtuk)',
          required: true,
          source_ids: ['aqua-official-ordering', 'aqua-research-wording'],
        },
        {
          id: 'aqua.order-confirmed.merchant-feedback',
          field: 'body',
          pattern: '(?:AQUA|Aqua)[\\s\\S]{0,120}(?:visszaigazol|elfogad)',
          required: true,
          source_ids: ['aqua-official-ordering', 'aqua-research-wording'],
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
      event: 'OTHER',
      base_confidence: 0.6,
      positive_rules: [
        {
          id: 'aqua.withdrawal.confirmation',
          field: 'body',
          pattern: '(?:el[aá]ll[aá]si\\s+(?:sz[aá]nd[eé]k|nyilatkozat)|el[aá]ll[aá]s)[\\s\\S]{0,160}(?:visszaigazol|r[oö]gz[ií]tett)',
          required: true,
          source_ids: ['aqua-official-withdrawal', 'aqua-research-wording'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_AUTO_LINK',
        'DO_NOT_MARK_REFUNDED',
      ],
    },
    {
      event: 'OTHER',
      base_confidence: 0.58,
      positive_rules: [
        {
          id: 'aqua.warranty-document.sent',
          field: 'body',
          pattern: '(?:j[oó]t[aá]ll[aá]si\\s+jegy|garanciajegy)[\\s\\S]{0,120}(?:PDF|csatol|megk[uü]ld)',
          required: true,
          source_ids: ['aqua-official-warranty', 'aqua-research-wording'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_AUTO_LINK',
        'DO_NOT_MARK_REFUNDED',
      ],
    },
  ],
  notes: [
    'RESEARCH ONLY: no direct AQUA transactional recipient email was found in the connected mailbox, so sender address, DKIM domain, return-path and exact recipient templates remain unverified.',
    'AQUA changed operator/ownership on 2025-11-10; historical email assumptions must not be promoted without current direct samples.',
    'The first order-submission email documents that an order was sent/received but official AQUA wording says final confirmation requires employee feedback.',
    'Synthetic ORDER_CREATED is only a research candidate for a later explicit AQUA acceptance email; it remains non-production and cannot create a purchase.',
    'Delivery date/time notifications are officially documented, but no exact email template is implemented and no SHIPMENT_CREATED/SHIPPED/READY_FOR_PICKUP/DELIVERED rule exists yet.',
    'Warranty-certificate PDF delivery is documentation, not proof of an active WARRANTY claim.',
    'Withdrawal confirmation proves intent/submission, not physical RETURN and never REFUNDED.',
    'Online card payment currently uses Saferpay; no merchant PAYMENT_SUCCESS/FAILED/ACTION_REQUIRED rule is invented.',
    'No invoice/proforma parser is implemented without a verified recipient template or document-delivery sample.',
  ],
};
