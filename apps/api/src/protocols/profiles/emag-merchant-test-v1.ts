import type { ProtocolProfile } from '../types.js';

/**
 * eMAG Hungary merchant shadow profile.
 *
 * V1 deliberately implements only a verified abandoned-cart hard negative.
 * Targeted mailbox searches did not yield a direct authenticated eMAG order
 * confirmation or lifecycle email suitable for a positive ORDER/SHIPMENT rule.
 */
export const EMAG_MERCHANT_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.emag',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'eMAG Hungary',
  country: 'HU',
  sender_domains: ['emag.hu'],
  sender_addresses: ['no-reply-t@emag.hu', 'no-reply-t@e2.emag.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'emag-observed-cart-abandon',
      title: 'Observed eMAG abandoned-cart email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Authenticated eMAG email contains product, quantity, price, order/return/refund wording, but explicitly states that the order was not finalized.',
    },
    {
      id: 'emag-observed-auth',
      title: 'Observed eMAG authenticated marketing infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME verified emag.hu DKIM pass, SPF pass from cto.emag.hu and DMARC pass for a no-reply-t@emag.hu abandoned-cart message.',
    },
    {
      id: 'emag-official-order-statuses',
      title: 'eMAG Marketplace - Rendelések státuszai',
      url: 'https://marketplace.emag.hu/infocenter/emag-academy/rendelesek/',
      provenance: 'official_documentation',
      notes: 'Seller-side platform statuses include Új, Folyamatban, Késett, Befejezett, buyer/seller/automatic cancellation and Visszajött. These are platform semantics, not verified recipient-email templates.',
    },
    {
      id: 'emag-official-returns-refunds',
      title: 'eMAG Help - Termékvisszaküldés és visszatérítés',
      url: 'https://www.emag.hu/help/termekvisszakuldessel-szervizelessel-visszateritessel-kapcsolatos-kerdesek/',
      provenance: 'official_documentation',
      notes: 'Return initiation, inspection/approval, invoice cancellation and actual refund are separate stages; a return/refund informational mention is not settled REFUNDED evidence.',
    },
    {
      id: 'emag-mailbox-missing-transactional',
      title: 'Targeted eMAG mailbox lifecycle searches (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Multiple searches for order confirmation, shipment, cancellation, delivery and refund did not find a sufficiently strong direct authenticated recipient transactional example, so V1 has no positive lifecycle rule.',
    },
  ],
  events: [
    {
      event: 'OTHER',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'emag.cart-abandon.sender',
          field: 'sender_address',
          pattern: '^no-reply-t@(?:e2\\.)?emag\\.hu$',
          required: true,
          source_ids: ['emag-observed-cart-abandon'],
        },
        {
          id: 'emag.cart-abandon.dkim',
          field: 'dkim_domain',
          pattern: '^emag\\.hu$',
          required: true,
          source_ids: ['emag-observed-auth'],
        },
        {
          id: 'emag.cart-abandon.subject',
          field: 'subject',
          pattern: 'mi[eé]rt [eé]rdemes befejezned a rendel[eé]sed',
          required: true,
          source_ids: ['emag-observed-cart-abandon'],
        },
        {
          id: 'emag.cart-abandon.explicit-not-finalized',
          field: 'body',
          pattern: 'a rendel[eé]st nem v[eé]gleges[ií]tetted',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['emag-observed-cart-abandon'],
        },
        {
          id: 'emag.cart-abandon.cart-not-reservation',
          field: 'body',
          pattern: 'kos[aá]rba helyez[eé]se nem jelenti azok lefoglal[aá]s[aá]t',
          required: true,
          source_ids: ['emag-observed-cart-abandon'],
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
    'An eMAG abandoned-cart email can contain concrete products, quantities, prices, return/refund language and the word rendelés while explicitly proving there is no finalized order. This is a high-value hard negative.',
    'Marketing claims such as ingyenes visszaküldés, pénzvisszatérítés, szombati szállítás or rendelj easyboxba are not purchase lifecycle evidence.',
    'Seller-side eMAG Marketplace statuses are useful semantic references but must not be converted into recipient-email regex rules without a verified direct email template.',
    'Merchant eMAG evidence must never outrank direct carrier evidence for logistics or direct payment-provider evidence for payment.',
    'No ORDER_CREATED, SHIPPED, DELIVERED, CANCELLED, RETURN or REFUNDED positive rule exists in V1.',
  ],
};
