import type { ProtocolProfile } from '../types.js';

/**
 * Direct Barion payment-authority profile derived from repeated sanitized real
 * recipient emails plus current Barion documentation.
 *
 * An authenticated Barion success receipt is authoritative evidence that a
 * payment succeeded, but it is not sufficient evidence that a BuyFlow purchase
 * exists or that the payment belongs to a particular purchase. V1 therefore
 * forbids purchase creation and automatic linking.
 */
export const BARION_PAYMENT_TEST_V1: ProtocolProfile = {
  protocol_id: 'payment.hu.barion',
  protocol_version: '1.0.0-test.1',
  kind: 'payment',
  status: 'test',
  display_name: 'Barion',
  country: 'HU',
  sender_domains: ['barion.com'],
  sender_addresses: ['barion@barion.com', 'noreply@barion.com'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [
      'Fizet[eé]s Barion azonos[ií]t[oó]ja\\s*:\\s*([0-9a-f]{32})',
    ],
  },
  sources: [
    {
      id: 'barion-official-payment-status',
      title: 'Barion Documentation - PaymentStatus',
      url: 'https://docs.barion.com/PaymentStatus',
      provenance: 'official_documentation',
      notes: 'Current Barion documentation defines Succeeded as a fully completed final payment state, while Canceled, Failed, Expired and other states are separate outcomes.',
    },
    {
      id: 'barion-official-callback-refund',
      title: 'Barion Documentation - Callback mechanism',
      url: 'https://docs.barion.com/Callback_mechanism',
      provenance: 'official_documentation',
      notes: 'Barion documents Succeeded as successful completion/capture. Refunds are represented by separate refund-type transactions and do not change the original succeeded payment status.',
    },
    {
      id: 'barion-official-reservation-email-boundary',
      title: 'Barion Documentation - Reservation payment',
      url: 'https://docs.barion.com/Reservation_payment',
      provenance: 'official_documentation',
      notes: 'Barion explicitly documents at least one payment lifecycle transition where Barion does not email the customer and the merchant is responsible for notification. This supports keeping API status semantics separate from recipient-email rules.',
    },
    {
      id: 'barion-observed-success',
      title: 'Observed Barion successful-payment recipient emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated real messages used subject Sikeres fizetés, explicitly stated that the recipient successfully paid an amount by bank card, and included a 32-character Barion payment identifier.',
    },
    {
      id: 'barion-observed-sender-transition',
      title: 'Observed Barion sender-address transition (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Older 2026 success receipts used barion@barion.com while newer August 2026 receipts used noreply@barion.com. Raw MIME from both generations verified DKIM pass for barion.com and DMARC pass for barion.com.',
    },
    {
      id: 'barion-observed-refund-word-hard-negative',
      title: 'Observed refund-word hard negative inside success receipts (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Successful-payment receipts themselves contain generic customer-service wording mentioning rendelés, szállítás vagy visszatérítés. The mere word visszatérítés therefore must never be interpreted as REFUNDED.',
    },
    {
      id: 'barion-observed-missing-negative-templates',
      title: 'Barion mailbox search for non-success recipient templates (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Separate searches found no authenticated recipient PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED or explicit refund email template in the researched mailbox. V1 intentionally does not implement those events.',
    },
  ],
  events: [
    {
      event: 'PAYMENT_SUCCESS',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'barion.success.dkim',
          field: 'dkim_domain',
          pattern: '^barion\\.com$',
          required: true,
          source_ids: ['barion-observed-sender-transition'],
        },
        {
          id: 'barion.success.subject',
          field: 'subject',
          pattern: '^Sikeres fizet[eé]s$',
          required: true,
          source_ids: ['barion-observed-success'],
        },
        {
          id: 'barion.success.explicit',
          field: 'body',
          pattern: 'Sikeresen fizett[eé]l\\s+[0-9][0-9 .\\u00a0]*\\s*Ft-ot bankk[aá]rty[aá]val',
          required: true,
          source_ids: ['barion-observed-success'],
        },
        {
          id: 'barion.success.payment-id',
          field: 'body',
          pattern: 'Fizet[eé]s Barion azonos[ií]t[oó]ja\\s*:\\s*[0-9a-f]{32}',
          required: true,
          source_ids: ['barion-observed-success'],
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
    'Do not treat Rendelés elfogadóhelyen nyilvántartott azonosítója as a global BuyFlow order ID. It is merchant-owned context and may be absent.',
    'The generic word visszatérítés in a successful-payment support paragraph is not refund evidence.',
    'Do not create a purchase or auto-link one from a Barion receipt. Payment evidence can represent purchases, subscriptions or other services.',
    'Do not implement PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED or REFUNDED until direct authenticated recipient examples or equally strong email-template evidence are verified.',
    'Do not convert Barion API-only PaymentStatus values into email events without observed recipient-email evidence.',
    'Promotion to production should require explicit ingestion support for authenticated DKIM-domain evidence.',
  ],
};
