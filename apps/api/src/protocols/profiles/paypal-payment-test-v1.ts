import type { ProtocolProfile } from '../types.js';

/**
 * PayPal research/hard-negative profile.
 *
 * The researched mailbox did not contain a direct authenticated PayPal buyer
 * transaction receipt, failed-payment notice, payer-action notice, refund
 * confirmation or dispute/claim lifecycle message. V1 therefore does NOT
 * invent positive payment lifecycle email rules from PayPal API status names.
 *
 * Instead, it records two authenticated PayPal recipient-email families that
 * are known NOT to be purchase lifecycle evidence: monthly account statements
 * and legal/account communications.
 */
export const PAYPAL_PAYMENT_TEST_V1: ProtocolProfile = {
  protocol_id: 'payment.paypal',
  protocol_version: '1.0.0-test.1',
  kind: 'payment',
  status: 'test',
  display_name: 'PayPal',
  sender_domains: ['paypal.com'],
  sender_addresses: [
    'paypal@mail.paypal.com',
    'no_reply@communications.paypal.com',
  ],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'paypal-observed-monthly-statement',
      title: 'Observed PayPal monthly account statement email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Observed direct sender paypal@mail.paypal.com. Body states that the monthly PayPal account statement is ready and includes general transaction/return/refund-related language, but it is not evidence of a specific purchase, payment or refund.',
    },
    {
      id: 'paypal-observed-statement-auth',
      title: 'Observed PayPal monthly statement authentication (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME verified DKIM pass for mail.paypal.com, SPF pass for bounce@mail.paypal.com and DMARC pass for paypal.com.',
    },
    {
      id: 'paypal-observed-legal',
      title: 'Observed PayPal legal agreement notification (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Observed direct sender no_reply@communications.paypal.com. The message concerns legal agreement/policy changes and is not payment lifecycle evidence.',
    },
    {
      id: 'paypal-observed-legal-auth',
      title: 'Observed PayPal communications authentication (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME verified DKIM pass, SPF pass and DMARC pass for communications.paypal.com.',
    },
    {
      id: 'paypal-official-security',
      title: 'PayPal - How to identify fake messages',
      url: 'https://www.paypal.com/us/security/learn-about-fake-messages',
      provenance: 'official_documentation',
      notes: 'PayPal warns that phishing and fake payment confirmations are common; suspicious payment notifications should be verified in the PayPal account.',
    },
    {
      id: 'paypal-official-api-statuses',
      title: 'PayPal Orders v2 capture statuses',
      url: 'https://developer.paypal.com/docs/api/orders/v2/',
      provenance: 'official_documentation',
      notes: 'Capture statuses include COMPLETED, DECLINED, PARTIALLY_REFUNDED, PENDING, REFUNDED and FAILED. These API states are not treated as verified email templates.',
    },
    {
      id: 'paypal-official-payer-action',
      title: 'PayPal order status - payer action required',
      url: 'https://developer.paypal.com/serversdk/php/models/enumerations/order-status',
      provenance: 'official_documentation',
      notes: 'PAYER_ACTION_REQUIRED is an API/order state such as 3DS. Some payment sources may manage payer action through SMS, email or in-app notification; this does not establish a generic PayPal email template.',
    },
    {
      id: 'paypal-official-refunds',
      title: 'PayPal - Where is my refund?',
      url: 'https://www.paypal.com/us/cshelp/article/where-is-my-refund-help130',
      provenance: 'official_documentation',
      notes: 'PayPal distinguishes refund initiated, processing/sent, pending and completed states. V1 does not infer REFUNDED from generic refund wording.',
    },
  ],
  events: [
    {
      event: 'OTHER',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'paypal.statement.sender',
          field: 'sender_address',
          pattern: '^paypal@mail\\.paypal\\.com$',
          required: true,
          source_ids: ['paypal-observed-monthly-statement'],
        },
        {
          id: 'paypal.statement.dkim',
          field: 'dkim_domain',
          pattern: '^mail\\.paypal\\.com$',
          required: true,
          source_ids: ['paypal-observed-statement-auth'],
        },
        {
          id: 'paypal.statement.subject',
          field: 'subject',
          pattern: '^(?:Tekintse [aá]t, milyen p[eé]nzmozg[aá]sok t[oö]rt[eé]ntek sz[aá]ml[aá]j[aá]n az ut[oó]bbi id[oő]ben\\.|Elk[eé]sz[uü]lt az els[oő] PayPal-sz[aá]mlakivonata)$',
          required: true,
          source_ids: ['paypal-observed-monthly-statement'],
        },
        {
          id: 'paypal.statement.body',
          field: 'body',
          pattern: '(?:Havi PayPal-sz[aá]mlakivonata elk[eé]sz[uü]lt|PayPal-sz[aá]mlakivonata elk[eé]sz[uü]lt)',
          required: true,
          source_ids: ['paypal-observed-monthly-statement'],
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
      base_confidence: 1,
      positive_rules: [
        {
          id: 'paypal.legal.sender',
          field: 'sender_address',
          pattern: '^no_reply@communications\\.paypal\\.com$',
          required: true,
          source_ids: ['paypal-observed-legal'],
        },
        {
          id: 'paypal.legal.dkim',
          field: 'dkim_domain',
          pattern: '^communications\\.paypal\\.com$',
          required: true,
          source_ids: ['paypal-observed-legal-auth'],
        },
        {
          id: 'paypal.legal.subject',
          field: 'subject',
          pattern: "^(?:We're making some changes to our PayPal legal agreements|M[oó]dos[ií]tjuk PayPal jogi meg[aá]llapod[aá]sainkat)$",
          required: true,
          source_ids: ['paypal-observed-legal'],
        },
        {
          id: 'paypal.legal.body',
          field: 'body',
          pattern: '(?:legal agreements|jogi meg[aá]llapod[aá]s)',
          required: true,
          source_ids: ['paypal-observed-legal'],
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
    'V1 is intentionally a hard-negative/research profile, not a positive PayPal payment parser.',
    'Do not create PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED, REFUNDED or dispute lifecycle email rules from PayPal API status names alone.',
    'Do not trust display name, paypal.com-looking text or a subject such as payment received/sent without authenticated direct recipient evidence.',
    'PayPal explicitly warns about fake payment confirmations, invoice scams and phishing.',
    'A monthly statement can contain transaction, return and refund-related words without proving any specific lifecycle event.',
    'Promotion to positive payment authority requires direct authenticated buyer-recipient transaction templates plus hard-negative regression coverage.',
  ],
};
