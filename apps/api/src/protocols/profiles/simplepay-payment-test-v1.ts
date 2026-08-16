import type { ProtocolProfile } from '../types.js';

/**
 * Direct SimplePay payment-authority profile derived from repeated sanitized
 * real recipient emails plus current SimplePay documentation.
 *
 * A successful SimplePay payment is authoritative payment evidence, but it is
 * not sufficient evidence that a BuyFlow purchase exists or that a payment
 * belongs to a particular purchase. The same authenticated template is used
 * for webshop purchases, telecom/service payments, debt payments, subscriptions
 * and carrier/POS transactions. Therefore V1 deliberately forbids purchase
 * creation and automatic linking.
 */
export const SIMPLEPAY_PAYMENT_TEST_V1: ProtocolProfile = {
  protocol_id: 'payment.hu.simplepay',
  protocol_version: '1.0.0-test.1',
  kind: 'payment',
  status: 'test',
  display_name: 'SimplePay',
  country: 'HU',
  sender_domains: ['simplepay.hu'],
  sender_addresses: ['noreply@simplepay.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [
      'SimplePay tranzakci[oó] azonos[ií]t[oó]\\s*:\\s*([0-9]{6,20})',
    ],
  },
  sources: [
    {
      id: 'simplepay-official-online',
      title: 'SimplePay - Online fizetés',
      url: 'https://simplepay.hu/online-fizetes/',
      provenance: 'official_documentation',
      notes: 'Current SimplePay documentation describes online card payment, stored-card one-click/recurring payment, qvik and real-time transaction tracking as supported payment flows.',
    },
    {
      id: 'simplepay-official-faq-failure-testing',
      title: 'SimplePay - Gyakori kérdések',
      url: 'https://simplepay.hu/gyik/',
      provenance: 'official_documentation',
      notes: 'SimplePay documents separate successful and unsuccessful transaction outcomes in Sandbox testing. No authenticated failed-payment recipient email was observed in the researched mailbox, so V1 intentionally does not implement PAYMENT_FAILED.',
    },
    {
      id: 'simplepay-observed-online-success',
      title: 'Observed SimplePay online successful-payment emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated authenticated emails across several merchants contained a SimplePay transaction ID, external reference, paid amount and explicit text that the message confirms successful payment.',
    },
    {
      id: 'simplepay-observed-recurring-success',
      title: 'Observed SimplePay stored-card successful charge email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A real Billingo-related email used the same success subject and explicitly stated that a previously stored bank card had been successfully charged, followed by the same successful-payment confirmation footer.',
    },
    {
      id: 'simplepay-observed-pos-success',
      title: 'Observed SimplePay POS successful-payment emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated GLS-related SimplePay Telefonos POS emails contained transaction type, payment method, SimplePay transaction ID, paid amount, authorization code and explicit Tranzakció státusza: Sikeres / successful-payment confirmation.',
    },
    {
      id: 'simplepay-observed-auth',
      title: 'Observed SimplePay authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME from online, stored-card and POS success messages verified exact From noreply@simplepay.hu, DKIM pass for simplepay.hu, SPF pass, DMARC pass and Return-Path noreply@simplepay.hu. mail.otpmobil.com transport was observed but is not required as the provider identity gate.',
    },
    {
      id: 'simplepay-observed-cross-domain-uses',
      title: 'Observed SimplePay successful payments across non-purchase and purchase contexts (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Authenticated success emails were observed for PCX, GLS, Billingo, Netfone, Intrum and public-administration payment contexts. This proves that a SimplePay success email alone must not create a BuyFlow purchase or be auto-linked by merchant-name guessing.',
    },
  ],
  events: [
    {
      event: 'PAYMENT_SUCCESS',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'simplepay.success.dkim',
          field: 'dkim_domain',
          pattern: '^simplepay\\.hu$',
          required: true,
          source_ids: ['simplepay-observed-auth'],
        },
        {
          id: 'simplepay.success.subject',
          field: 'subject',
          pattern: '^SimplePay\\s*-\\s*Sikeres fizet[eé]s(?:\\s*-\\s*.+)?$',
          required: true,
          source_ids: [
            'simplepay-observed-online-success',
            'simplepay-observed-recurring-success',
            'simplepay-observed-pos-success',
          ],
        },
        {
          id: 'simplepay.success.transaction-id',
          field: 'body',
          pattern: 'SimplePay tranzakci[oó] azonos[ií]t[oó]\\s*:\\s*[0-9]{6,20}',
          required: true,
          source_ids: [
            'simplepay-observed-online-success',
            'simplepay-observed-recurring-success',
            'simplepay-observed-pos-success',
          ],
        },
        {
          id: 'simplepay.success.amount',
          field: 'body',
          pattern: 'Fizetett [oö]sszeg\\s*:\\s*[0-9][0-9 .\\u00a0]*\\s*(?:HUF|Ft)',
          required: true,
          source_ids: [
            'simplepay-observed-online-success',
            'simplepay-observed-recurring-success',
            'simplepay-observed-pos-success',
          ],
        },
        {
          id: 'simplepay.success.explicit',
          field: 'body',
          pattern: '(?:sikeres fizet[eé]s megt[oö]rt[eé]n[eé]s[eé]t igazolja|Tranzakci[oó] st[aá]tusza\\s*:\\s*Sikeres)',
          required: true,
          source_ids: [
            'simplepay-observed-online-success',
            'simplepay-observed-recurring-success',
            'simplepay-observed-pos-success',
          ],
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
    'Do not treat the SimplePay external reference as a global order ID. Its semantics are merchant-specific.',
    'Do not create a purchase from payment evidence. The same provider template covers subscriptions, invoices/services, carrier POS and conventional webshop purchases.',
    'Do not implement PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED or REFUNDED until direct authenticated recipient examples or equally strong provider evidence are verified.',
    'Promotion to production should require explicit ingestion support for authenticated DKIM-domain evidence.',
  ],
};
