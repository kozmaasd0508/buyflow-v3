import type { ProtocolProfile } from '../types.js';

/**
 * Direct Stripe-hosted receipt profile derived from authenticated recipient
 * emails and current Stripe documentation.
 *
 * Stripe customer-email sender addresses are merchant/account-specific rather
 * than one fixed mailbox. V1 therefore requires the observed Stripe-generated
 * sender shape plus a real stripe.com DKIM signature. A paid receipt is strong
 * payment evidence, but it is not sufficient evidence to create or auto-link a
 * BuyFlow purchase: Stripe also processes subscriptions, SaaS, invoices and
 * other non-commerce payments.
 */
export const STRIPE_PAYMENT_TEST_V1: ProtocolProfile = {
  protocol_id: 'payment.stripe',
  protocol_version: '1.0.0-test.1',
  kind: 'payment',
  status: 'test',
  display_name: 'Stripe',
  sender_domains: ['stripe.com'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [
      'Receipt(?: number)?\\s*[:#]?\\s*([0-9]{4}-[0-9]{4})',
      'Elismerv[eé]ny sz[aá]ma\\s*:\\s*([0-9]{4}-[0-9]{4})',
    ],
  },
  sources: [
    {
      id: 'stripe-official-receipts',
      title: 'Stripe - Receipts and paid invoices',
      url: 'https://docs.stripe.com/receipts',
      provenance: 'official_documentation',
      notes: 'Stripe documents unique receipt numbers, successful-payment receipts, invoice/subscription payment receipts and separate refund receipts.',
    },
    {
      id: 'stripe-official-email-receipts',
      title: 'Stripe - Email receipts',
      url: 'https://docs.stripe.com/payments/advanced/receipts',
      provenance: 'official_documentation',
      notes: 'Stripe states that automated payment receipts are sent only for successful payments and are not sent for failed or declined payments.',
    },
    {
      id: 'stripe-official-customer-emails',
      title: 'Stripe - Send customer emails',
      url: 'https://docs.stripe.com/invoicing/send-email',
      provenance: 'official_documentation',
      notes: 'Stripe supports separate customer-email classes for failed payments, paid-invoice receipts, 3D Secure action, refunds and other billing events. These classes are not inferred from receipt emails.',
    },
    {
      id: 'stripe-official-custom-email-domain',
      title: 'Stripe - Custom email domain',
      url: 'https://docs.stripe.com/get-started/account/email-domain',
      provenance: 'official_documentation',
      notes: 'Stripe sends customer emails from stripe.com by default but merchants can configure a custom sending domain. V1 intentionally recognizes only directly authenticated default-domain Stripe receipts.',
    },
    {
      id: 'stripe-observed-payment-receipt-en',
      title: 'Observed Stripe direct English payment receipt (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A real receipt from a SaaS merchant used receipts+acct_<account>@stripe.com and contained Receipt #, Amount paid, Date paid, payment method and a Stripe-hosted receipt URL.',
    },
    {
      id: 'stripe-observed-paid-invoice-receipt-en',
      title: 'Observed Stripe direct paid-invoice receipt (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A real paid-invoice email used invoice+statements+acct_<account>@stripe.com and contained Receipt number, Invoice number, Paid date, Amount paid plus Stripe-hosted invoice and receipt links.',
    },
    {
      id: 'stripe-observed-payment-receipt-hu',
      title: 'Observed Stripe direct Hungarian payment receipt (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A localized Hungarian receipt used receipts+acct_<account>@stripe.com and contained Elismervény száma, Kifizetett összeg, A fizetés dátuma and a Stripe-hosted receipt URL.',
    },
    {
      id: 'stripe-observed-auth',
      title: 'Observed Stripe authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME from English and Hungarian recipient receipts verified DKIM pass for stripe.com, SPF pass, DMARC pass, bounce.stripe.com Return-Path and Amazon SES transport. Transport is not used as the provider identity boundary.',
    },
    {
      id: 'stripe-observed-missing-other-lifecycles',
      title: 'Stripe mailbox searches for failed, action-required and refund mail (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Targeted mailbox searches found no direct authenticated recipient examples for failed payment, action-required/3DS or refund emails, so V1 deliberately implements none of those event types.',
    },
  ],
  events: [
    {
      event: 'PAYMENT_SUCCESS',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'stripe.success.sender-shape',
          field: 'sender_address',
          pattern: '^(?:receipts|invoice\\+statements)\\+acct_[A-Za-z0-9]+@stripe\\.com$',
          required: true,
          source_ids: [
            'stripe-observed-payment-receipt-en',
            'stripe-observed-paid-invoice-receipt-en',
            'stripe-observed-payment-receipt-hu',
          ],
        },
        {
          id: 'stripe.success.dkim',
          field: 'dkim_domain',
          pattern: '^stripe\\.com$',
          required: true,
          source_ids: ['stripe-observed-auth'],
        },
        {
          id: 'stripe.success.receipt-number',
          field: 'body',
          pattern: '(?:Receipt(?: number)?|Elismerv[eé]ny sz[aá]ma)\\s*[:#]?\\s*[0-9]{4}-[0-9]{4}',
          required: true,
          source_ids: [
            'stripe-official-receipts',
            'stripe-observed-payment-receipt-en',
            'stripe-observed-paid-invoice-receipt-en',
            'stripe-observed-payment-receipt-hu',
          ],
        },
        {
          id: 'stripe.success.amount-paid',
          field: 'body',
          pattern: '(?:Amount paid|Kifizetett [oö]sszeg)\\s*\\n?\\s*(?:[$€£]\\s*[0-9][0-9., \\u00a0]*|[0-9][0-9., \\u00a0]*\\s*(?:Ft|HUF|USD|EUR|GBP))',
          required: true,
          source_ids: [
            'stripe-official-email-receipts',
            'stripe-observed-payment-receipt-en',
            'stripe-observed-paid-invoice-receipt-en',
            'stripe-observed-payment-receipt-hu',
          ],
        },
        {
          id: 'stripe.success.paid-date',
          field: 'body',
          pattern: '(?:Date paid\\s*\\n?\\s*[^\\n]+|Paid\\s+[A-Z][a-z]+\\s+\\d{1,2},\\s+\\d{4}|A fizet[eé]s d[aá]tuma\\s*\\n?\\s*[^\\n]+)',
          required: true,
          source_ids: [
            'stripe-observed-payment-receipt-en',
            'stripe-observed-paid-invoice-receipt-en',
            'stripe-observed-payment-receipt-hu',
          ],
        },
        {
          id: 'stripe.success.hosted-receipt',
          field: 'body',
          pattern: 'dashboard\\.stripe\\.com/receipts/(?:payment|invoices)',
          required: true,
          source_ids: [
            'stripe-official-receipts',
            'stripe-observed-payment-receipt-en',
            'stripe-observed-paid-invoice-receipt-en',
            'stripe-observed-payment-receipt-hu',
          ],
        },
      ],
      negative_rules: [
        {
          id: 'stripe.success.refund-subject',
          field: 'subject',
          pattern: '(?:refund|refunded|visszat[eé]r)',
          source_ids: ['stripe-official-receipts', 'stripe-official-customer-emails'],
        },
        {
          id: 'stripe.success.refund-body',
          field: 'body',
          pattern: '(?:amount refunded|refund issued|has been refunded|visszat[eé]r[ií]tett [oö]sszeg|visszat[eé]r[ií]t[eé]s megt[oö]rt[eé]nt)',
          source_ids: ['stripe-official-receipts', 'stripe-official-customer-emails'],
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
    'V1 recognizes only default-domain Stripe-generated receipt senders observed as receipts+acct_<account>@stripe.com or invoice+statements+acct_<account>@stripe.com, with stripe.com DKIM.',
    'Stripe supports merchant custom sending domains; those are intentionally outside this profile until they can be authenticated and attributed safely without treating arbitrary merchant mail as Stripe authority.',
    'Receipt number is stored as payment_reference because Stripe documents it as a unique receipt lookup identifier. Merchant order references and Stripe invoice numbers are not promoted to BuyFlow order_id/invoice_id by this payment profile.',
    'Do not create or auto-link a purchase from a Stripe receipt: receipts also cover subscriptions, SaaS, invoice payments and other non-purchase contexts.',
    'Do not implement PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED or REFUNDED until direct authenticated recipient examples are verified. Stripe documentation proves those email classes exist but does not prove the exact recipient template observed by BuyFlow.',
    'Promotion to production should require live ingestion support for DKIM-domain evidence.',
  ],
};
