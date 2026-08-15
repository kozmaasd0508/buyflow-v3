import type { ProtocolEventCandidate, ProtocolProfile, ProtocolProhibition } from '../types.js';

export interface ShoprenterResearchEvent {
  source_event: string;
  event_candidate: ProtocolEventCandidate;
  prohibitions: ProtocolProhibition[];
  requirements: string[];
  source_ids: string[];
  notes: string;
}

/**
 * Shoprenter can rewrite a configured Gmail sender to order@myshoprenter.hu.
 * This address is shared platform evidence only, never merchant identity.
 */
export const SHOPRENTER_RESEARCH_V1: ProtocolProfile = {
  protocol_id: 'commerce.shoprenter',
  protocol_version: '1.0.0-research.1',
  kind: 'commerce',
  status: 'research',
  display_name: 'Shoprenter',
  sender_domains: ['myshoprenter.hu'],
  sender_addresses: ['order@myshoprenter.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'shoprenter-automatic-emails',
      title: 'Shoprenter Automatikus emailek',
      url: 'https://support.shoprenter.hu/hc/hu/articles/215106278-Automatikus-emailek',
      provenance: 'official_documentation',
    },
    {
      id: 'shoprenter-orders',
      title: 'Shoprenter Rendelések',
      url: 'https://support.shoprenter.hu/hc/hu/articles/215106568-Rendel%C3%A9sek',
      provenance: 'official_documentation',
    },
    {
      id: 'shoprenter-go',
      title: 'Shoprenter Go tracking link in order-status email',
      url: 'https://support.shoprenter.hu/hc/hu/articles/6636165262877-Shoprenter-Go',
      provenance: 'official_documentation',
    },
    {
      id: 'shoprenter-payment-methods',
      title: 'Shoprenter Fizetési módok',
      url: 'https://support.shoprenter.hu/hc/hu/articles/360010170777-Fizet%C3%A9si-m%C3%B3dok',
      provenance: 'official_documentation',
    },
    {
      id: 'shoprenter-content',
      title: 'Shoprenter Tartalom menü / automatic email events and placeholders',
      url: 'https://support.shoprenter.hu/hc/hu/articles/215106238-Tartalom-men%C3%BC',
      provenance: 'official_documentation',
    },
  ],
  events: [
    {
      event: 'OTHER',
      base_confidence: 0.99,
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK'],
      positive_rules: [
        {
          id: 'shoprenter.shared-fallback-sender',
          field: 'sender_address',
          pattern: '^order@myshoprenter\\.hu$',
          required: true,
          source_ids: ['shoprenter-automatic-emails'],
        },
      ],
    },
  ],
  notes: [
    'Shoprenter automatic email subject, text, HTML, sender and name are editable; event tags depend on the configured email type.',
    'order@myshoprenter.hu is used as a fallback when Gmail is configured as sender. It is shared platform evidence only.',
    'Merchant-owned sender domains are recommended and common, so absence of myshoprenter.hu does not rule out Shoprenter.',
    'Order confirmation and order status change emails can have attached documents and merchant-defined content.',
  ],
};

export const SHOPRENTER_NOTIFICATION_RESEARCH_V1: ShoprenterResearchEvent[] = [
  {
    source_event: 'Rendelés visszaigazolás automatic email',
    event_candidate: 'ORDER_CREATED',
    prohibitions: [],
    requirements: ['verified merchant identity', 'stable rendered order number/identity'],
    source_ids: ['shoprenter-automatic-emails', 'shoprenter-content'],
    notes: 'Shoprenter documents a dedicated order-confirmation automatic email, but the merchant can edit its subject and both text/HTML bodies. No global subject regex is safe.',
  },
  {
    source_event: 'Rendelés állapot váltás automatic email',
    event_candidate: 'OTHER',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
    requirements: ['merchant-specific verified mapping from configured Shoprenter order state to BuyFlow lifecycle'],
    source_ids: ['shoprenter-orders', 'shoprenter-content'],
    notes: 'Order states and individual status-change emails are merchant-configurable. A status-change email is lifecycle evidence but its canonical meaning must be learned per merchant/status, not from a global word.',
  },
  {
    source_event: 'Shoprenter Go tracking link in status-change email',
    event_candidate: 'OTHER',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
    requirements: ['rendered tracking URL/identity', 'separate carrier or verified merchant lifecycle evidence for physical progress'],
    source_ids: ['shoprenter-go'],
    notes: 'The [SHOPRENTER_GO_TRACKING_LINK] tag can be inserted after label generation. Label/tracking availability is shipment identity evidence, not proof that the carrier physically accepted the parcel.',
  },
  {
    source_event: 'payment description embedded in order confirmation',
    event_candidate: 'OTHER',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    requirements: ['explicit rendered payment state if a payment lifecycle event is to be emitted'],
    source_ids: ['shoprenter-payment-methods'],
    notes: '[PAYMENT_DESCRIPTION] can render payment-method instructions in the order confirmation. Instructions/method name alone are not PAYMENT_SUCCESS or PAYMENT_FAILED.',
  },
];

export const SHOPRENTER_STRUCTURAL_SIGNALS_V1 = [
  {
    tag: '[SHOP_NAME]',
    meaning: 'store name available in automatic email configuration',
    source_ids: ['shoprenter-automatic-emails'],
  },
  {
    tag: '[ORDER_COMMENT]',
    meaning: 'optional order comment included in order-status email when configured',
    source_ids: ['shoprenter-orders'],
  },
  {
    tag: '[SHOPRENTER_GO_TRACKING_LINK]',
    meaning: 'rendered Shoprenter Go package tracking URL after label generation',
    source_ids: ['shoprenter-go'],
  },
  {
    tag: '[PAYMENT_DESCRIPTION]',
    meaning: 'rendered configured payment-method description in order confirmation',
    source_ids: ['shoprenter-payment-methods'],
  },
];

export const SHOPRENTER_HARD_NEGATIVE_FAMILIES_V1 = [
  'wishlist sharing email',
  'stock availability notification',
  'marketing automation / newsletter email',
  'subscription renewal reminder',
  'subscription modification notification',
  'subscription setup/payment error notification',
  'subscription welcome email',
];
