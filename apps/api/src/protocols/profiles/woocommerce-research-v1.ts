import type { ProtocolProfile } from '../types.js';

/**
 * WooCommerce core customer-email research profile.
 *
 * IMPORTANT:
 * - status is intentionally `research`; this profile is not registered for runtime use.
 * - WooCommerce subjects/templates can be customized or overridden by themes/plugins.
 * - rules below describe verified core defaults only and must not be treated as a
 *   global keyword list or proof of merchant identity.
 */
export const WOOCOMMERCE_RESEARCH_V1: ProtocolProfile = {
  protocol_id: 'commerce.woocommerce',
  protocol_version: '1.0.0-research.1',
  kind: 'commerce',
  status: 'research',
  display_name: 'WooCommerce',
  sender_domains: [],
  identifier_patterns: {
    order_id: [
      '(?:Order #|\\[Order #)([A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*)',
      '\\border #([A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*)',
    ],
    tracking_id: [
      'Tracking Number\\s*:\\s*([A-Za-z0-9._-]{6,64})',
    ],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'woo-email-settings',
      title: 'WooCommerce Email Settings',
      url: 'https://woocommerce.com/document/configuring-woocommerce-settings/emails/',
      provenance: 'official_documentation',
      notes: 'Built-in email types, customization controls, placeholders and extension caveat.',
    },
    {
      id: 'woo-order-statuses',
      title: 'WooCommerce Order Statuses',
      url: 'https://woocommerce.com/document/managing-orders/order-statuses/',
      provenance: 'official_documentation',
      notes: 'Canonical core meanings of Pending, On hold, Processing, Completed, Failed, Canceled and Refunded.',
    },
    {
      id: 'woo-processing-code',
      title: 'WC_Email_Customer_Processing_Order',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-processing-order.html',
      provenance: 'official_documentation',
    },
    {
      id: 'woo-processing-template',
      title: 'customer-processing-order plain email template',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-templates-emails-plain-customer-processing-order.html',
      provenance: 'verified_template',
    },
    {
      id: 'woo-order-details-template',
      title: 'email-order-details template',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-templates-emails-email-order-details.html',
      provenance: 'verified_template',
    },
    {
      id: 'woo-failed-code',
      title: 'WC_Email_Customer_Failed_Order',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-failed-order.html',
      provenance: 'official_documentation',
    },
    {
      id: 'woo-cancelled-code',
      title: 'WC_Email_Customer_Cancelled_Order',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-cancelled-order.html',
      provenance: 'official_documentation',
    },
    {
      id: 'woo-refunded-code',
      title: 'WC_Email_Customer_Refunded_Order',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-refunded-order.html',
      provenance: 'official_documentation',
    },
    {
      id: 'woo-order-details-code',
      title: 'WC_Email_Customer_Invoice / Order details',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-invoice.html',
      provenance: 'official_documentation',
    },
    {
      id: 'woo-order-details-payment-template',
      title: 'customer-invoice / payment request plain template',
      url: 'https://woocommerce.github.io/code-reference/files/woocommerce-templates-emails-plain-customer-invoice.html',
      provenance: 'verified_template',
    },
    {
      id: 'woo-fulfillment-docs',
      title: 'WooCommerce Order Fulfillment',
      url: 'https://woocommerce.com/document/order-fulfillment/',
      provenance: 'official_documentation',
    },
    {
      id: 'woo-fulfillment-created-code',
      title: 'WC_Email_Customer_Fulfillment_Created',
      url: 'https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/emails/class-wc-email-customer-fulfillment-created.php',
      provenance: 'verified_template',
    },
    {
      id: 'woo-fulfillment-details-template',
      title: 'email-fulfillment-details plain template',
      url: 'https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/templates/emails/plain/email-fulfillment-details.php',
      provenance: 'verified_template',
    },
  ],
  events: [
    {
      event: 'ORDER_PROCESSING',
      base_confidence: 0.9,
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_IN_TRANSIT',
        'DO_NOT_MARK_DELIVERED',
      ],
      positive_rules: [
        {
          id: 'woo.processing.default-subject',
          field: 'subject',
          pattern: '^Your .+ order has been received!$',
          required: true,
          source_ids: ['woo-processing-code'],
        },
        {
          id: 'woo.processing.default-body',
          field: 'body',
          pattern: 'we(?:[’\u2019\']ve| have) received your order(?: #[A-Za-z0-9._-]+)?[,]? and it is now being processed',
          required: true,
          confidence_delta: 0.04,
          source_ids: ['woo-processing-template'],
        },
        {
          id: 'woo.processing.order-summary',
          field: 'body',
          pattern: '(?:Order summary[\\s\\S]{0,120})?(?:Order #|\\[Order #)[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['woo-order-details-template'],
        },
      ],
    },
    {
      event: 'PAYMENT_FAILED',
      base_confidence: 0.91,
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
      positive_rules: [
        {
          id: 'woo.failed.default-subject',
          field: 'subject',
          pattern: '^Your order at .+ was unsuccessful$',
          required: true,
          source_ids: ['woo-failed-code'],
        },
        {
          id: 'woo.failed.default-heading',
          field: 'body',
          pattern: 'Sorry, your order was unsuccessful',
          required: true,
          confidence_delta: 0.04,
          source_ids: ['woo-failed-code'],
        },
        {
          id: 'woo.failed.order-summary',
          field: 'body',
          pattern: '(?:Order #|\\[Order #)[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*',
          required: true,
          confidence_delta: 0.02,
          source_ids: ['woo-order-details-template'],
        },
      ],
    },
    {
      event: 'CANCELLED',
      base_confidence: 0.94,
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
      positive_rules: [
        {
          id: 'woo.cancelled.default-subject',
          field: 'subject',
          pattern: '^\\[.+\\]: Your order #[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]* has been cancelled$',
          required: true,
          source_ids: ['woo-cancelled-code'],
        },
        {
          id: 'woo.cancelled.default-heading',
          field: 'body',
          pattern: 'Order (?:cancelled|Cancelled): #[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*',
          required: true,
          confidence_delta: 0.03,
          source_ids: ['woo-cancelled-code'],
        },
      ],
    },
    {
      event: 'PAYMENT_ACTION_REQUIRED',
      base_confidence: 0.93,
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
      positive_rules: [
        {
          id: 'woo.payment-request.default-subject',
          field: 'subject',
          pattern: '^Details for order #[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]* on .+$',
          required: true,
          source_ids: ['woo-order-details-code'],
        },
        {
          id: 'woo.payment-request.payment-copy',
          field: 'body',
          pattern: '(?:link to (?:make payment when you(?:[’\u2019\']re| are) ready|try your payment again)|Pay for this order)',
          required: true,
          confidence_delta: 0.04,
          source_ids: ['woo-order-details-payment-template'],
        },
      ],
    },
    {
      event: 'REFUNDED',
      base_confidence: 0.94,
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_MARK_REFUNDED',
      ],
      positive_rules: [
        {
          id: 'woo.refund.full.default-subject',
          field: 'subject',
          pattern: '^Your .+ order #[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]* has been refunded$',
          required: true,
          source_ids: ['woo-refunded-code'],
        },
      ],
    },
    {
      event: 'REFUNDED',
      base_confidence: 0.94,
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_MARK_REFUNDED',
      ],
      positive_rules: [
        {
          id: 'woo.refund.partial.default-subject',
          field: 'subject',
          pattern: '^Your .+ order #[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]* has been partially refunded$',
          required: true,
          source_ids: ['woo-refunded-code'],
        },
      ],
    },
    {
      event: 'SHIPPED',
      base_confidence: 0.94,
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_MARK_DELIVERED',
      ],
      positive_rules: [
        {
          id: 'woo.fulfillment-created.default-subject',
          field: 'subject',
          pattern: '^(?:An item|Items) from .+ order [A-Za-z0-9._-]*\\d[A-Za-z0-9._-]* (?:has|have) been fulfilled!$',
          required: true,
          source_ids: ['woo-fulfillment-created-code'],
        },
        {
          id: 'woo.fulfillment-created.heading',
          field: 'body',
          pattern: 'Your item(?:s)? (?:is|are) on the way!',
          required: true,
          confidence_delta: 0.03,
          source_ids: ['woo-fulfillment-created-code', 'woo-fulfillment-docs'],
        },
      ],
    },
  ],
  negative_patterns: [
    {
      id: 'woo.noise.account-created',
      field: 'subject',
      pattern: '^Your .+ account has been created!$',
      source_ids: ['woo-email-settings'],
    },
    {
      id: 'woo.noise.customer-note',
      field: 'subject',
      pattern: '^(?:A note has been added to your order from .+|Note added to your .+ order from .+)$',
      source_ids: ['woo-email-settings'],
    },
    {
      id: 'woo.noise.reset-password',
      field: 'body',
      pattern: 'Reset your password',
      source_ids: ['woo-email-settings'],
    },
  ],
  notes: [
    'Core WooCommerce email subjects, headings and templates are customizable; default wording is evidence, never final proof.',
    'Themes/plugins/extensions can override templates and add email types.',
    'Processing means payment received and awaiting fulfillment for normal physical orders; the email itself is lifecycle evidence, not a new Purchase authority.',
    'Completed is intentionally not mapped in research v1. Core documentation says complete/fulfilled and usually shipped; it must never be treated as recipient delivery without stronger logistics evidence.',
    'The historical WC_Email_Customer_Invoice class is user-facing Order details / Payment request. It is not evidence of a fiscal invoice document by itself.',
    'WooCommerce Refunded status/email is merchant-side refund evidence. Manual refund/status handling can exist without proof that customer funds have settled, so DO_NOT_MARK_REFUNDED is mandatory until payment-provider/bank evidence corroborates it.',
    'Fulfillment-created mail is merchant-side shipped evidence. Tracking Number / Shipment Provider / Tracking URL may be present in fulfillment details, but direct carrier evidence remains stronger for physical logistics state.',
  ],
};
