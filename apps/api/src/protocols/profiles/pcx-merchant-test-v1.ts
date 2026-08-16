import type { ProtocolProfile } from '../types.js';

/**
 * PCX Hungary merchant shadow profile.
 *
 * V1 is based on a directly observed three-step recipient-email lifecycle for
 * the same order plus attached invoice/warranty documents. Merchant logistics
 * evidence remains lower authority than direct carrier evidence.
 */
export const PCX_MERCHANT_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.pcx',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'PCX Hungary',
  country: 'HU',
  sender_domains: ['pcx.hu'],
  sender_addresses: ['vevoszolgalat@pcx.hu'],
  identifier_patterns: {
    order_id: [
      '(?:Rendel[eé]s\\s*-\\s*|Azonos[ií]t[oó]:\\s*|A\\(z\\)\\s*)(\\d{6}/\\d{6})',
      '(\\d{6}/\\d{6})(?:-es)?\\s+rendel[eé]s',
    ],
    tracking_id: ['Csomag\\s+azonos[ií]t[oó]:\\s*(\\d{14})'],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'pcx-observed-order-created',
      title: 'Observed PCX order-received email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email from vevoszolgalat@pcx.hu with subject Rendelés - YYMMDD/######, full order summary, and explicit future processing / later courier-handoff notification wording.',
    },
    {
      id: 'pcx-observed-packing',
      title: 'Observed PCX upcoming order-assembly email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email for the same order says it will soon be assembled. This is preparation only and does not prove carrier possession.',
    },
    {
      id: 'pcx-observed-shipped',
      title: 'Observed PCX DPD handoff email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email explicitly says the identified order was handed over for delivery, gives a 14-digit parcel identifier, says expected arrival is the next business day, and attaches invoice and warranty documents.',
    },
    {
      id: 'pcx-observed-auth',
      title: 'Observed PCX authenticated mail channel (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Representative raw MIME verified DKIM pass for pcx.hu, SPF pass, DMARC pass and direct pcx.hu Return-Path. smtp01.vhost.hu is transport infrastructure, not merchant identity.',
    },
    {
      id: 'pcx-observed-invoice-pdf',
      title: 'Observed PCX invoice attachment (sanitized structural fingerprint)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A POB######-YYYY.pdf attachment visually verifies as an explicit SZÁMLA with canonical Sorszám POB######/YYYY and the PCX order number. V1 proves INVOICE existence but does not invent canonical invoice_id from the filename.',
    },
    {
      id: 'pcx-observed-warranty-pdf',
      title: 'Observed PCX warranty-sheet attachment (sanitized structural fingerprint)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'The second PDF is explicitly titled Garancialap and contains order identity and warranty periods. It also contains invoice-like words such as Számlaérték, which must not make it an INVOICE.',
    },
    {
      id: 'pcx-observed-review',
      title: 'Observed PCX post-purchase review request (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A PCX review email references an earlier order and asks how the products work. This does not prove DELIVERED.',
    },
    {
      id: 'pcx-official-order-delivery-info',
      title: 'PCX - Rendelési információk',
      url: 'https://www.pcx.hu/rendelesi_informaciok',
      provenance: 'official_documentation',
      notes: 'PCX documents assembly before handoff, email notification on the handoff day, and invoice plus warranty-sheet attachment to delivery/pickup notification.',
    },
    {
      id: 'pcx-official-shipping',
      title: 'PCX - Szállítás',
      url: 'https://www.pcx.hu/szallitas',
      provenance: 'official_documentation',
      notes: 'PCX states it emails the customer when the package is dispatched and the carrier separately emails about arrival. Direct carrier evidence remains stronger for physical lifecycle.',
    },
    {
      id: 'pcx-official-warranty',
      title: 'PCX - Garancia',
      url: 'https://www.pcx.hu/garancia',
      provenance: 'official_documentation',
      notes: 'PCX has a separate warranty-claim flow. Merely receiving a warranty sheet with a purchase is not a warranty-claim lifecycle event.',
    },
    {
      id: 'pcx-mailbox-missing-events',
      title: 'Targeted PCX payment/cancellation/return/refund/warranty searches (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'No sufficiently verified direct recipient templates were found for payment success/failure, cancellation, settled refund, return initiation or warranty-claim lifecycle.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 0.99,
      positive_rules: [
        { id: 'pcx.order-created.sender', field: 'sender_address', pattern: '^vevoszolgalat@pcx\\.hu$', required: true, source_ids: ['pcx-observed-order-created'] },
        { id: 'pcx.order-created.dkim', field: 'dkim_domain', pattern: '^pcx\\.hu$', required: true, source_ids: ['pcx-observed-auth'] },
        { id: 'pcx.order-created.subject', field: 'subject', pattern: '^Rendel[eé]s\\s*-\\s*\\d{6}/\\d{6}$', required: true, source_ids: ['pcx-observed-order-created'] },
        { id: 'pcx.order-created.processing', field: 'body', pattern: '(?:hamarosan|r[oö]videsen)[\\s\\S]{0,180}(?:feldolgoz|foglalkoz)', required: true, source_ids: ['pcx-observed-order-created'] },
      ],
    },
    {
      event: 'ORDER_PACKING',
      base_confidence: 1,
      positive_rules: [
        { id: 'pcx.packing.sender', field: 'sender_address', pattern: '^vevoszolgalat@pcx\\.hu$', required: true, source_ids: ['pcx-observed-packing'] },
        { id: 'pcx.packing.dkim', field: 'dkim_domain', pattern: '^pcx\\.hu$', required: true, source_ids: ['pcx-observed-auth'] },
        { id: 'pcx.packing.subject', field: 'subject', pattern: '^Hamarosan\\s+[oö]ssze[aá]ll[ií]tjuk\\s+a\\s+rendel[eé]sedet$', required: true, source_ids: ['pcx-observed-packing'] },
        { id: 'pcx.packing.body', field: 'body', pattern: 'A\\(z\\)\\s+\\d{6}/\\d{6}-es\\s+rendel[eé]st\\s+hamarosan\\s+elkezdj[uü]k\\s+[oö]ssze[aá]ll[ií]tani', required: true, source_ids: ['pcx-observed-packing'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
    },
    {
      event: 'SHIPPED',
      base_confidence: 1,
      positive_rules: [
        { id: 'pcx.shipped.sender', field: 'sender_address', pattern: '^vevoszolgalat@pcx\\.hu$', required: true, source_ids: ['pcx-observed-shipped'] },
        { id: 'pcx.shipped.dkim', field: 'dkim_domain', pattern: '^pcx\\.hu$', required: true, source_ids: ['pcx-observed-auth'] },
        { id: 'pcx.shipped.subject', field: 'subject', pattern: '^DPD\\s+csomagod\\s+[eé]rkezik,\\s+a\\s+sz[aá]ml[aá]t\\s+csatoltuk$', required: true, source_ids: ['pcx-observed-shipped'] },
        { id: 'pcx.shipped.handoff', field: 'body', pattern: 'rendel[eé]sedet\\s+k[eé]zbes[ií]t[eé]sre\\s+[aá]tadtuk', required: true, source_ids: ['pcx-observed-shipped', 'pcx-official-order-delivery-info'] },
        { id: 'pcx.shipped.tracking', field: 'body', pattern: 'Csomag\\s+azonos[ií]t[oó]:\\s*\\d{14}', required: true, source_ids: ['pcx-observed-shipped'] },
        { id: 'pcx.shipped.order-id', field: 'body', pattern: 'Azonos[ií]t[oó]:\\s*\\d{6}/\\d{6}', required: true, source_ids: ['pcx-observed-shipped'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_DELIVERED'],
    },
    {
      event: 'INVOICE',
      base_confidence: 1,
      positive_rules: [
        { id: 'pcx.invoice.sender', field: 'sender_address', pattern: '^vevoszolgalat@pcx\\.hu$', required: true, source_ids: ['pcx-observed-shipped'] },
        { id: 'pcx.invoice.dkim', field: 'dkim_domain', pattern: '^pcx\\.hu$', required: true, source_ids: ['pcx-observed-auth'] },
        { id: 'pcx.invoice.body', field: 'body', pattern: 'A\\s+sz[aá]ml[aá]t[\\s\\S]{0,160}(?:mell[eé]kelt[uü]k|csatoltuk)', required: true, source_ids: ['pcx-observed-shipped', 'pcx-official-order-delivery-info'] },
        { id: 'pcx.invoice.attachment', field: 'attachment_filename', pattern: '^POB\\d{6}-\\d{4}\\.pdf$', required: true, source_ids: ['pcx-observed-invoice-pdf'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
    },
    {
      event: 'OTHER',
      base_confidence: 0.99,
      positive_rules: [
        { id: 'pcx.review.sender', field: 'sender_address', pattern: '^vevoszolgalat@pcx\\.hu$', required: true, source_ids: ['pcx-observed-review'] },
        { id: 'pcx.review.dkim', field: 'dkim_domain', pattern: '^pcx\\.hu$', required: true, source_ids: ['pcx-observed-auth'] },
        { id: 'pcx.review.subject', field: 'subject', pattern: '^Hogy\\s+m[uű]k[oö]dnek\\s+a\\s+term[eé]keid\\??$', required: true, source_ids: ['pcx-observed-review'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK', 'DO_NOT_MARK_DELIVERED', 'DO_NOT_MARK_REFUNDED'],
    },
  ],
  notes: [
    'The observed PCX sequence ties ORDER_CREATED, ORDER_PACKING and SHIPPED to the same YYMMDD/###### order identifier.',
    'ORDER_PACKING is preparation only and must never create shipment, transit or delivery state.',
    'The SHIPPED email explicitly says the order was handed over for delivery and includes a 14-digit DPD parcel identifier. Direct DPD evidence still outranks PCX for later movement/final delivery.',
    'The same handoff email independently proves INVOICE when it explicitly says the invoice is attached and a POB######-YYYY.pdf attachment is present.',
    'The canonical invoice number is inside the PDF with a slash, while the filename uses a hyphen. ProtocolDetectionInput has attachment filenames but not PDF text, so V1 deliberately leaves invoice_id null.',
    'The Garancialap contains invoice-like terminology such as Számlaérték but is not an invoice. Document type wins.',
    'An attached warranty sheet is warranty documentation, not proof that a warranty claim has started; V1 emits no WARRANTY event from it.',
    'Conditional DPD-locker payment instructions and a FIZETVE mark on the invoice are not turned into a separate merchant PAYMENT_SUCCESS event.',
    'General boilerplate about withdrawal, returns or future delivery must not create RETURN, REFUNDED or DELIVERED.',
    'No positive PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED, CANCELLED, RETURN, REFUNDED, WARRANTY, READY_FOR_PICKUP, DELIVERY_FAILED or DELIVERED rule is implemented without a verified direct recipient template.',
  ],
};
