import type { ProtocolProfile } from '../types.js';

/**
 * Euronics Hungary merchant shadow profile.
 *
 * V1 is intentionally narrow and is based on directly observed recipient
 * emails from ugyfelszolgalat@euronics.hu. Current official Euronics docs
 * describe additional shipping, pickup and withdrawal email stages, but V1
 * does not invent recipient templates for stages not observed in the mailbox.
 */
export const EURONICS_MERCHANT_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.euronics',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'Euronics Hungary',
  country: 'HU',
  sender_domains: ['euronics.hu'],
  sender_addresses: ['ugyfelszolgalat@euronics.hu'],
  identifier_patterns: {
    order_id: [
      'Rendel[eé]s\\s+azonos[ií]t[oó]:\\s*(\\d{8})',
      'A\\(z\\)\\s+(\\d{8})\\s+sz[aá]m[uú]\\s+rendel[eé]sed',
    ],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'euronics-observed-order-received',
      title: 'Observed Euronics order-received email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email from ugyfelszolgalat@euronics.hu says the identified order was recorded and processing started. It also says a later notification will be sent when the product is handed to the carrier. V1 maps this initial message to ORDER_CREATED only and does not infer shipment or payment success.',
    },
    {
      id: 'euronics-observed-credit-cancel',
      title: 'Observed Euronics order cancellation after negative credit decision (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email explicitly says the identified order was cancelled because the credit application ended with a negative decision. This proves CANCELLED, but it is not a failed card/payment transaction and therefore must not become PAYMENT_FAILED.',
    },
    {
      id: 'euronics-observed-auth',
      title: 'Observed Euronics authenticated mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Representative order and cancellation raw MIME verify DKIM pass for euronics.hu, a second Mandrill DKIM signature, SPF pass on a mandrillapp.com bounce Return-Path, and DMARC pass for euronics.hu. Mandrill transport is infrastructure, not semantic authority.',
    },
    {
      id: 'euronics-observed-account-login',
      title: 'Observed Euronics one-time account login email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'The same exact Euronics support sender also sends a one-time passwordless account login link. Authenticated sender identity alone is therefore not purchase-lifecycle evidence.',
    },
    {
      id: 'euronics-official-faq',
      title: 'Euronics - Gyakran Ismételt Kérdések',
      url: 'https://euronics.hu/gyakori-kerdesek',
      provenance: 'official_documentation',
      notes: 'Current FAQ states that online orders receive automatic email status notifications and that store-pickup orders are emailed once they are ready. V1 does not add a positive READY_FOR_PICKUP rule without an observed recipient template.',
    },
    {
      id: 'euronics-official-delivery',
      title: 'Euronics - Szállítási információk',
      url: 'https://euronics.hu/szallitasi-informaciok',
      provenance: 'official_documentation',
      notes: 'Current delivery documentation says customers are emailed about parcel dispatch and store availability. Direct carrier evidence remains stronger for physical carrier possession, and V1 implements no SHIPPED rule without a direct Euronics recipient example.',
    },
    {
      id: 'euronics-official-credit',
      title: 'Euronics - Online áruhitel',
      url: 'https://euronics.hu/online-aruhitel',
      provenance: 'official_documentation',
      notes: 'Current online-credit flow keeps the product reserved during credit review and proceeds to delivery after successful approval and contract conclusion. A negative credit decision can therefore cancel the order without proving PAYMENT_FAILED.',
    },
    {
      id: 'euronics-official-withdrawal',
      title: 'Euronics - Elállás',
      url: 'https://euronics.hu/elallas',
      provenance: 'official_documentation',
      notes: 'Current withdrawal documentation separates submitting/confirming a withdrawal request from later goods return and refund. Marketing/footer text such as 30 napos elállás is not RETURN or REFUNDED evidence.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 1,
      positive_rules: [
        { id: 'euronics.order-created.sender', field: 'sender_address', pattern: '^ugyfelszolgalat@euronics\\.hu$', required: true, source_ids: ['euronics-observed-order-received'] },
        { id: 'euronics.order-created.dkim', field: 'dkim_domain', pattern: '^euronics\\.hu$', required: true, source_ids: ['euronics-observed-auth'] },
        { id: 'euronics.order-created.subject', field: 'subject', pattern: '^A\\(z\\)\\s+\\d{8}\\s+sz[aá]m[uú]\\s+rendel[eé]sedet\\s+fogadtuk!$', required: true, source_ids: ['euronics-observed-order-received'] },
        { id: 'euronics.order-created.recorded', field: 'body', pattern: 'Rendel[eé]sed\\s+r[oö]gz[ií]tett[uü]k', required: true, source_ids: ['euronics-observed-order-received'] },
        { id: 'euronics.order-created.processing', field: 'body', pattern: 'Rendel[eé]sed\\s+feldolgoz[aá]s[aá]t\\s+megkezdt[uü]k', required: true, source_ids: ['euronics-observed-order-received'] },
        { id: 'euronics.order-created.order-id', field: 'body', pattern: 'Rendel[eé]s\\s+azonos[ií]t[oó]:\\s*\\d{8}', required: true, source_ids: ['euronics-observed-order-received'] },
      ],
    },
    {
      event: 'CANCELLED',
      base_confidence: 1,
      positive_rules: [
        { id: 'euronics.cancelled.sender', field: 'sender_address', pattern: '^ugyfelszolgalat@euronics\\.hu$', required: true, source_ids: ['euronics-observed-credit-cancel'] },
        { id: 'euronics.cancelled.dkim', field: 'dkim_domain', pattern: '^euronics\\.hu$', required: true, source_ids: ['euronics-observed-auth'] },
        { id: 'euronics.cancelled.subject', field: 'subject', pattern: '^A\\(z\\)\\s+\\d{8}\\s+sz[aá]m[uú]\\s+rendel[eé]sed\\s+t[oö]r[oö]lt[uü]k$', required: true, source_ids: ['euronics-observed-credit-cancel'] },
        { id: 'euronics.cancelled.explicit', field: 'body', pattern: '\\d{8}\\s+sz[aá]m[uú]\\s+megrendel[eé]sed\\s+t[oö]r[oö]lt[uü]k', required: true, source_ids: ['euronics-observed-credit-cancel'] },
        { id: 'euronics.cancelled.credit-reason', field: 'body', pattern: 'hitelig[eé]nyl[eé]s\\s+elb[ií]r[aá]l[aá]sa\\s+negat[ií]v\\s+eredm[eé]nnyel\\s+z[aá]rult', required: true, source_ids: ['euronics-observed-credit-cancel'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_DELIVERED', 'DO_NOT_MARK_REFUNDED'],
    },
    {
      event: 'OTHER',
      base_confidence: 1,
      positive_rules: [
        { id: 'euronics.account.sender', field: 'sender_address', pattern: '^ugyfelszolgalat@euronics\\.hu$', required: true, source_ids: ['euronics-observed-account-login'] },
        { id: 'euronics.account.dkim', field: 'dkim_domain', pattern: '^euronics\\.hu$', required: true, source_ids: ['euronics-observed-auth'] },
        { id: 'euronics.account.subject', field: 'subject', pattern: '^Egyszeri\\s+bel[eé]p[eé]sre\\s+jogos[ií]t[oó]\\s+link$', required: true, source_ids: ['euronics-observed-account-login'] },
        { id: 'euronics.account.body', field: 'body', pattern: 'jelsz[oó]\\s+n[eé]lk[uü]l\\s+bel[eé]ptet[uü]nk[\\s\\S]{0,120}60\\s*percig\\s+[eé]l', required: true, source_ids: ['euronics-observed-account-login'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED', 'DO_NOT_MARK_REFUNDED'],
    },
  ],
};
