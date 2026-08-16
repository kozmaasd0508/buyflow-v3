import type { ProtocolProfile } from '../types.js';

/**
 * Notino Hungary merchant shadow profile.
 *
 * V1 intentionally implements only a directly observed abandoned-cart hard
 * negative. Current official Notino documentation describes order receipt,
 * warehouse preparation, physical carrier handoff, shipment email, invoice and
 * return/refund boundaries, but the connected Gmail mailbox contains no direct
 * authenticated recipient lifecycle email suitable for a positive parser.
 */
export const NOTINO_MERCHANT_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.notino',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'Notino Hungary',
  country: 'HU',
  sender_domains: ['notino.hu'],
  sender_addresses: ['info@notino.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'notino-observed-abandoned-cart',
      title: 'Observed Notino unfinished-order email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple direct recipient emails from info@notino.hu contained a concrete product, quantity and VAT-inclusive total while explicitly asking the recipient to finish the order. No finalized order existed.',
    },
    {
      id: 'notino-observed-auth',
      title: 'Observed Notino authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Representative unfinished-order raw MIME verified DKIM pass for notino.hu, SPF pass from ov.notino.hu, DMARC pass, Omnivery transport and an ov.notino.hu Return-Path. V1 treats exact notino.hu DKIM as authority; transport is not identity.',
    },
    {
      id: 'notino-observed-security-same-channel',
      title: 'Observed Notino password-change email on the same authenticated sender (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'The exact same info@notino.hu + notino.hu DKIM channel also sends account-security messages. Sender identity alone therefore cannot classify commerce lifecycle.',
    },
    {
      id: 'notino-official-terms-order-contract',
      title: 'Notino Hungary - Üzleti feltételek, adásvételi szerződés kötése',
      url: 'https://www.notino.hu/uzleti-feltetelek/',
      provenance: 'official_documentation',
      notes: 'Notino states that an online order is a contract proposal, receipt is acknowledged by email, and the contract is formed later when Notino accepts by shipping the ordered goods; shipment is also notified by email.',
    },
    {
      id: 'notino-official-order-faq',
      title: 'Notino Hungary - Rendeléssel kapcsolatos gyakori kérdések',
      url: 'https://www.notino.hu/faqs/category/rendelesek',
      provenance: 'official_documentation',
      notes: 'Notino confirms order confirmations can arrive later, orders begin processing after submission or prepayment, and once the parcel is handed over for transport the carrier takes over customer delivery communication.',
    },
    {
      id: 'notino-official-shipping-faq',
      title: 'Notino Hungary - Szállítással kapcsolatos gyakori kérdések',
      url: 'https://www.notino.hu/faqs/category/szallitas',
      provenance: 'official_documentation',
      notes: 'Notino explicitly distinguishes warehouse packing/preparation from physical carrier possession: package being prepared means packed in the warehouse and readied for dispatch; only after handed over for transport is the parcel already with the carrier.',
    },
    {
      id: 'notino-official-delivery-payment',
      title: 'Notino Hungary - Szállítás és fizetés',
      url: 'https://www.notino.hu/szallitas-es-fizetes/',
      provenance: 'official_documentation',
      notes: 'Current delivery documentation says shipment-start/handoff notifications include parcel identity and tracking information. Payment documentation describes card authorization semantics, but these are product/process semantics rather than verified recipient-email templates.',
    },
    {
      id: 'notino-official-invoice',
      title: 'Notino Hungary - Üzleti feltételek, electronic tax document',
      url: 'https://www.notino.hu/uzleti-feltetelek/',
      provenance: 'official_documentation',
      notes: 'Notino states the electronic tax document is sent in the email concerning shipment. V1 does not infer an INVOICE event without a verified recipient shipment/invoice template.',
    },
    {
      id: 'notino-official-returns-refunds',
      title: 'Notino Hungary - Reklamáció és szerződéstől való elállás',
      url: 'https://www.notino.hu/faqs/category/reklamacio',
      provenance: 'official_documentation',
      notes: 'Return/withdrawal initiation, goods return/inspection and actual refund are separate stages. Refund may be withheld until goods are returned or return is proven, so return wording alone is not settled REFUNDED evidence.',
    },
    {
      id: 'notino-mailbox-missing-lifecycle',
      title: 'Targeted Notino mailbox lifecycle searches (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple searches for order confirmation, package, shipment, invoice, delivery, cancellation, payment, return and refund found no sufficiently verified direct recipient Notino lifecycle template in the connected mailbox. V1 therefore adds no positive lifecycle parser.',
    },
  ],
  events: [
    {
      event: 'OTHER',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'notino.abandoned-cart.sender',
          field: 'sender_address',
          pattern: '^info@notino\\.hu$',
          required: true,
          source_ids: ['notino-observed-abandoned-cart'],
        },
        {
          id: 'notino.abandoned-cart.dkim',
          field: 'dkim_domain',
          pattern: '^notino\\.hu$',
          required: true,
          source_ids: ['notino-observed-auth'],
        },
        {
          id: 'notino.abandoned-cart.subject',
          field: 'subject',
          pattern: '^A kos[aá]rban (?:[ÖO]nre|[oö]nre) v[aá]rnak a term[eé]kek$',
          required: true,
          source_ids: ['notino-observed-abandoned-cart'],
        },
        {
          id: 'notino.abandoned-cart.not-finished',
          field: 'body',
          pattern: 'K[aá]r lenne nem befejezni a megrendel[eé]st',
          required: true,
          source_ids: ['notino-observed-abandoned-cart'],
        },
        {
          id: 'notino.abandoned-cart.call-to-order',
          field: 'body',
          pattern: 'rendelje meg amit kiv[aá]lasztott',
          required: true,
          source_ids: ['notino-observed-abandoned-cart'],
        },
        {
          id: 'notino.abandoned-cart-campaign',
          field: 'body',
          pattern: 'utm_campaign=unfinished-order',
          required: true,
          source_ids: ['notino-observed-abandoned-cart'],
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
  ],
  notes: [
    'A Notino abandoned-cart email can contain a real product name, quantity, price, VAT-inclusive total, account link and order/reorder URL while proving only purchase intent. It must never create a purchase.',
    'The same exact info@notino.hu + notino.hu DKIM channel also carries account-security mail, so authenticated sender identity is necessary but never sufficient for event classification.',
    'Official Notino documentation gives strong lifecycle boundaries, but process documentation is not a recipient-email template. Do not convert those phrases into production regexes without a captured direct email.',
    'Critical boundary: warehouse packing / package preparation is not SHIPPED. Notino itself states that preparation means the parcel is being packed and readied for dispatch; only the later handed-over-for-transport state means the carrier physically has it.',
    'Direct carrier evidence remains higher logistics authority than Notino merchant wording for physical possession, movement, delivery failure, pickup and final delivery.',
    'The shipment email is documented to contain the electronic tax document, but V1 does not invent a combined SHIPPED + INVOICE parser without an observed recipient message.',
    'Card authorization semantics on the public payment page do not establish a verified Notino PAYMENT_SUCCESS recipient email. Direct payment-provider evidence remains higher authority.',
    'Return initiation or withdrawal never implies settled REFUNDED. Current Notino terms explicitly allow refund to wait for return of goods or proof of return.',
    'No positive ORDER_CREATED, ORDER_PROCESSING, ORDER_PACKING, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, DELIVERY_FAILED, DELAYED, CANCELLED, PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED, INVOICE, RETURN, REFUNDED or WARRANTY rule is implemented in V1.',
  ],
};
