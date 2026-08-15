import type { ProtocolEventCandidate, ProtocolProfile, ProtocolProhibition } from '../types.js';

export interface ShopifyNotificationResearchEntry {
  notification: string;
  event_candidate: ProtocolEventCandidate;
  prohibitions: ProtocolProhibition[];
  confidence_note: string;
  source_ids: string[];
}

/**
 * Shopify research profile V1 deliberately identifies only the shared
 * shopifyemail.com delivery channel. It does not infer merchant identity or a
 * lifecycle event from that channel alone. Notification semantics are kept in
 * SHOPIFY_NOTIFICATION_RESEARCH_V1 until verified rendered-email fingerprints
 * are available.
 */
export const SHOPIFY_RESEARCH_V1: ProtocolProfile = {
  protocol_id: 'commerce.shopify',
  protocol_version: '1.0.0-research.1',
  kind: 'commerce',
  status: 'research',
  display_name: 'Shopify',
  sender_domains: ['shopifyemail.com'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'shopify-sender-email',
      title: 'Shopify sender email setup and rewrites',
      url: 'https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-your-email',
      provenance: 'official_documentation',
      notes: 'Unauthenticated/rewritten sender can use store+<id>@shopifyemail.com; custom merchant sender domains are also supported.',
    },
    {
      id: 'shopify-customer-notifications',
      title: 'Shopify customer notification events',
      url: 'https://help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications',
      provenance: 'official_documentation',
    },
    {
      id: 'shopify-template-customization',
      title: 'Shopify notification template customization',
      url: 'https://help.shopify.com/en/manual/fulfillment/setup/notifications/customizing-notification-template',
      provenance: 'official_documentation',
    },
    {
      id: 'shopify-email-variables',
      title: 'Shopify notification variables reference',
      url: 'https://help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables',
      provenance: 'official_documentation',
    },
    {
      id: 'shopify-pending-payments',
      title: 'Shopify pending payments from additional providers',
      url: 'https://help.shopify.com/en/manual/fulfillment/managing-orders/payments/pending-payments',
      provenance: 'official_documentation',
    },
    {
      id: 'shopify-pickup',
      title: 'Shopify pickup in store notifications',
      url: 'https://help.shopify.com/en/manual/fulfillment/setup/delivery-methods/pickup-in-store',
      provenance: 'official_documentation',
    },
    {
      id: 'shopify-returns',
      title: 'Shopify self-serve returns notifications',
      url: 'https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/self-serve-returns/setup',
      provenance: 'official_documentation',
    },
    {
      id: 'shopify-return-exchange',
      title: 'Shopify return/exchange notification updates',
      url: 'https://help.shopify.com/en/manual/fulfillment/setup/notifications/exchange-notifications',
      provenance: 'official_documentation',
    },
    {
      id: 'shopify-local-delivery',
      title: 'Shopify local delivery notification behavior',
      url: 'https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/local-delivery-fulfillment',
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
          id: 'shopify.shared-sender-domain',
          field: 'sender_domain',
          pattern: '^(?:[a-z0-9.-]+\\.)?shopifyemail\\.com$',
          required: true,
          source_ids: ['shopify-sender-email'],
        },
      ],
    },
  ],
  notes: [
    'shopifyemail.com is shared platform evidence, never merchant identity.',
    'Authenticated Shopify stores can send from their own merchant domain, so absence of shopifyemail.com does not rule out Shopify.',
    'Shopify merchants can edit notification subject and HTML body. No raw lifecycle regex is enabled in research V1 without a verified rendered-email fingerprint.',
  ],
};

export const SHOPIFY_NOTIFICATION_RESEARCH_V1: ShopifyNotificationResearchEntry[] = [
  {
    notification: 'Order confirmation',
    event_candidate: 'ORDER_CREATED',
    prohibitions: [],
    confidence_note: 'Triggered when a customer places an order. Requires stable order identity and merchant identity before Purchase creation.',
    source_ids: ['shopify-customer-notifications', 'shopify-email-variables'],
  },
  {
    notification: 'Shipping confirmation',
    event_candidate: 'SHIPMENT_CREATED',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
    confidence_note: 'Triggered when an order is fulfilled. Fulfillment does not prove physical carrier acceptance.',
    source_ids: ['shopify-customer-notifications'],
  },
  {
    notification: 'Shipping update',
    event_candidate: 'OTHER',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
    confidence_note: 'Tracking information was updated; this alone does not prove a physical lifecycle transition.',
    source_ids: ['shopify-customer-notifications'],
  },
  {
    notification: 'Out for delivery',
    event_candidate: 'OUT_FOR_DELIVERY',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_DELIVERED'],
    confidence_note: 'Generated from matching tracking events supplied by a carrier or fulfillment app; direct carrier evidence remains stronger.',
    source_ids: ['shopify-customer-notifications'],
  },
  {
    notification: 'Delivered',
    event_candidate: 'DELIVERED',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    confidence_note: 'Generated from matching tracking events supplied by a carrier or fulfillment app; direct carrier evidence remains stronger.',
    source_ids: ['shopify-customer-notifications'],
  },
  {
    notification: 'Order canceled',
    event_candidate: 'CANCELLED',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    confidence_note: 'Cancellation and refund are separate facts; a cancel action can optionally refund but cancellation alone must not imply settled refund.',
    source_ids: ['shopify-customer-notifications'],
  },
  {
    notification: 'Order refund',
    event_candidate: 'REFUNDED',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
    confidence_note: 'Merchant/platform refund evidence only; final settlement should prefer payment-provider evidence.',
    source_ids: ['shopify-customer-notifications'],
  },
  {
    notification: 'Pending payment success',
    event_candidate: 'PAYMENT_SUCCESS',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    confidence_note: 'Shopify documents that the customer is emailed after a previously pending payment succeeds. Direct payment-provider state remains stronger.',
    source_ids: ['shopify-pending-payments'],
  },
  {
    notification: 'Pending payment error',
    event_candidate: 'PAYMENT_FAILED',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    confidence_note: 'Shopify documents a failed-payment email containing a Pay now retry action.',
    source_ids: ['shopify-pending-payments'],
  },
  {
    notification: 'Ready for pickup',
    event_candidate: 'READY_FOR_PICKUP',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_DELIVERED'],
    confidence_note: 'Sent when staff marks an in-store pickup order ready. It is explicitly not customer receipt.',
    source_ids: ['shopify-pickup'],
  },
  {
    notification: 'Picked up by customer',
    event_candidate: 'OTHER',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    confidence_note: 'Terminal store-pickup receipt evidence exists, but BuyFlow has no canonical PICKED_UP event yet; do not silently alias it to DELIVERED in protocol V1.',
    source_ids: ['shopify-pickup'],
  },
  {
    notification: 'Return request confirmation',
    event_candidate: 'RETURN',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    confidence_note: 'Confirms that a customer requested a return; it is not approval, receipt, or refund.',
    source_ids: ['shopify-returns'],
  },
  {
    notification: 'Return request approved',
    event_candidate: 'RETURN',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
    confidence_note: 'Approval can include shipping label/instructions and exchange balance actions; it does not prove returned goods or refund settlement.',
    source_ids: ['shopify-returns', 'shopify-return-exchange'],
  },
  {
    notification: 'Return created',
    event_candidate: 'RETURN',
    prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
    confidence_note: 'Return workflow evidence; exchange variants can also contain a Pay now action.',
    source_ids: ['shopify-return-exchange'],
  },
  {
    notification: 'Local delivery confirmation',
    event_candidate: 'DELIVERED',
    prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    confidence_note: 'Separate from carrier tracking notifications; sent when merchant marks a local-delivery order delivered, so authority is lower than direct carrier evidence.',
    source_ids: ['shopify-local-delivery'],
  },
];
