import type { ProtocolProfile } from '../types.js';

const BILLINGO_COMMON_SOURCES: ProtocolProfile['sources'] = [
  {
    id: 'billingo-official-email-sender',
    title: 'Billingo - Bizonylattömbök beállítása / email sender',
    url: 'https://support.billingo.hu/content/373325825',
    provenance: 'official_documentation',
    notes: 'Billingo documents that invoices sent through Billingo always originate from noreply@billingo.hu; configured sender email is reply-to only.',
  },
  {
    id: 'billingo-official-email-send',
    title: 'Billingo - Számla küldése emailben',
    url: 'https://support.billingo.hu/content/104693813',
    provenance: 'official_documentation',
    notes: 'Billingo documents direct email delivery of created invoices through the Billingo system.',
  },
  {
    id: 'billingo-official-document-types',
    title: 'Billingo - Bizonylatlista dokumentumtípusok',
    url: 'https://support.billingo.hu/content/3078356994',
    provenance: 'official_documentation',
    notes: 'Billingo distinguishes Számla, Nyugta, Díjbekérő, Módosító számla, Sztornó and Piszkozat as separate document types.',
  },
  {
    id: 'billingo-official-proforma',
    title: 'Billingo - Díjbekérő',
    url: 'https://www.billingo.hu/funkciok/dijbekero',
    provenance: 'official_documentation',
    notes: 'Billingo states that a díjbekérő/proforma resembles an invoice but is not an invoice, is not booked and does not itself create VAT/NAV invoice obligations.',
  },
  {
    id: 'billingo-official-storno',
    title: 'Billingo - Sztornószámla',
    url: 'https://www.billingo.hu/funkciok/stornoszamla',
    provenance: 'official_documentation',
    notes: 'Billingo documents sztornó as a separate negative document that invalidates an original invoice. No direct recipient email fixture was verified for V1.',
  },
  {
    id: 'billingo-observed-invoice',
    title: 'Observed Billingo direct invoice email (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Real recipient emails from multiple issuers used subject Számlája érkezett, noreply@billingo.hu, explicit invoice wording, total, Számla sorszáma and Billingo document-access download links.',
  },
  {
    id: 'billingo-observed-electronic-invoice',
    title: 'Observed Billingo electronic invoice wording (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Recipient mailbox examples include the localized wording Önnek elektronikus számlája érkezett while retaining the same direct Billingo sender.',
  },
  {
    id: 'billingo-observed-proforma',
    title: 'Observed Billingo direct proforma email (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'A direct recipient email used subject Díjbekérője érkezett and explicit díjbekérő wording, but misleadingly also used generic labels A számla végösszege and Számla sorszáma. This is a required hard-negative for invoice recognition.',
  },
  {
    id: 'billingo-observed-auth',
    title: 'Observed Billingo authenticated email infrastructure (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Raw MIME from invoice and proforma messages verified exact noreply@billingo.hu sender, billingo.hu DKIM pass, SPF pass, DMARC pass and a mail.billingo.hu Return-Path via Amazon SES.',
  },
  {
    id: 'billingo-observed-account-notice',
    title: 'Observed Billingo subscription renewal notice (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Billingo also sends account/subscription notices from noreply@billingo.hu. Provider authentication alone therefore must not imply INVOICE.',
  },
  {
    id: 'billingo-observed-missing-correction-mails',
    title: 'Billingo mailbox searches for correction and cancellation emails (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Targeted mailbox searches did not find a sufficiently strong direct recipient sample for módosító/helyesbítő or sztornó email templates, so V1 implements no positive parser for them.',
  },
];

/**
 * Billingo invoice authority profile.
 *
 * The provider email proves that an invoice document exists, but it does not
 * prove that BuyFlow already has the correct purchase record. Billingo is also
 * used for services, subscriptions and B2B invoicing, so invoices cannot create
 * or auto-link purchases by themselves.
 */
export const BILLINGO_INVOICE_TEST_V1: ProtocolProfile = {
  protocol_id: 'invoicing.hu.billingo',
  protocol_version: '1.0.0-test.1',
  kind: 'invoicing',
  status: 'test',
  display_name: 'Billingo',
  country: 'HU',
  sender_domains: ['billingo.hu'],
  sender_addresses: ['noreply@billingo.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [
      'Sz[aá]mla sorsz[aá]ma\\s*:\\s*([^\\r\\n]+)',
    ],
    payment_reference: [],
  },
  sources: BILLINGO_COMMON_SOURCES,
  events: [
    {
      event: 'INVOICE',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'billingo.invoice.sender',
          field: 'sender_address',
          pattern: '^noreply@billingo\\.hu$',
          required: true,
          source_ids: ['billingo-official-email-sender', 'billingo-observed-invoice'],
        },
        {
          id: 'billingo.invoice.dkim',
          field: 'dkim_domain',
          pattern: '^billingo\\.hu$',
          required: true,
          source_ids: ['billingo-observed-auth'],
        },
        {
          id: 'billingo.invoice.subject',
          field: 'subject',
          pattern: '^Sz[aá]ml[aá]ja [eé]rkezett$',
          required: true,
          source_ids: ['billingo-observed-invoice', 'billingo-observed-electronic-invoice'],
        },
        {
          id: 'billingo.invoice.type-body',
          field: 'body',
          pattern: '[ÖO]nnek\\s+(?:elektronikus\\s+)?sz[aá]ml[aá]ja\\s+[eé]rkezett',
          required: true,
          source_ids: ['billingo-observed-invoice', 'billingo-observed-electronic-invoice'],
        },
        {
          id: 'billingo.invoice.number',
          field: 'body',
          pattern: 'Sz[aá]mla sorsz[aá]ma\\s*:\\s*[^\\r\\n]+',
          required: true,
          source_ids: ['billingo-observed-invoice'],
        },
        {
          id: 'billingo.invoice.total',
          field: 'body',
          pattern: 'A sz[aá]mla v[eé]g[oö]sszege\\s*:\\s*[^\\r\\n]+',
          required: true,
          source_ids: ['billingo-observed-invoice'],
        },
        {
          id: 'billingo.invoice.download-link',
          field: 'body',
          pattern: '(?:ses-track\\.billingo\\.hu|app\\.billingo\\.hu).*(?:document-access|sz[aá]mla)',
          flags: 'is',
          required: true,
          source_ids: ['billingo-official-email-send', 'billingo-observed-invoice'],
        },
      ],
      negative_rules: [
        {
          id: 'billingo.invoice.proforma-subject',
          field: 'subject',
          pattern: 'd[ií]jbek[eé]r[oő]',
          source_ids: ['billingo-official-proforma', 'billingo-observed-proforma'],
        },
        {
          id: 'billingo.invoice.proforma-body',
          field: 'body',
          pattern: '[ÖO]nnek\\s+d[ií]jbek[eé]r[oő]je\\s+[eé]rkezett|D[IÍ]JBEK[EÉ]R[ŐO]\\s+LET[ÖO]LT[EÉ]SE',
          source_ids: ['billingo-official-proforma', 'billingo-observed-proforma'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_AUTO_LINK',
      ],
    },
  ],
  notes: [
    'Exact noreply@billingo.hu plus billingo.hu DKIM is required. Billingo documentation confirms the From address, while raw recipient MIME confirms authentication.',
    'Invoice number is extracted only in this invoice-specific profile from the explicit Számla sorszáma field.',
    'A Billingo invoice may be for a webshop purchase, subscription, service or B2B expense. It must not create or auto-link a BuyFlow purchase without independent identity evidence.',
    'Billingo emails commonly provide a document-access link rather than a Gmail PDF attachment; absence of an attachment is not evidence against a real invoice.',
    'Do not infer payment success from Fizetési mód, total amount or an invoice existing.',
    'Módosító/helyesbítő and sztornó recipient email parsers remain unsupported until direct authenticated examples are verified.',
    'Promotion to production should require live ingestion support for DKIM-domain evidence.',
  ],
};

/**
 * Separate Billingo proforma/díjbekérő profile.
 *
 * This is deliberately split from the invoice profile because observed Billingo
 * proforma emails reuse misleading invoice-like labels such as "A számla
 * végösszege" and "Számla sorszáma". The split prevents a proforma identifier
 * from being extracted as invoice_id by the provider-wide identifier extractor.
 */
export const BILLINGO_PROFORMA_TEST_V1: ProtocolProfile = {
  protocol_id: 'invoicing.hu.billingo.proforma',
  protocol_version: '1.0.0-test.1',
  kind: 'invoicing',
  status: 'test',
  display_name: 'Billingo Díjbekérő',
  country: 'HU',
  sender_domains: ['billingo.hu'],
  sender_addresses: ['noreply@billingo.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: BILLINGO_COMMON_SOURCES,
  events: [
    {
      event: 'OTHER',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'billingo.proforma.sender',
          field: 'sender_address',
          pattern: '^noreply@billingo\\.hu$',
          required: true,
          source_ids: ['billingo-official-email-sender', 'billingo-observed-proforma'],
        },
        {
          id: 'billingo.proforma.dkim',
          field: 'dkim_domain',
          pattern: '^billingo\\.hu$',
          required: true,
          source_ids: ['billingo-observed-auth'],
        },
        {
          id: 'billingo.proforma.subject',
          field: 'subject',
          pattern: '^D[ií]jbek[eé]r[oő]je [eé]rkezett$',
          required: true,
          source_ids: ['billingo-official-proforma', 'billingo-observed-proforma'],
        },
        {
          id: 'billingo.proforma.type-body',
          field: 'body',
          pattern: '[ÖO]nnek\\s+d[ií]jbek[eé]r[oő]je\\s+[eé]rkezett',
          required: true,
          source_ids: ['billingo-official-proforma', 'billingo-observed-proforma'],
        },
        {
          id: 'billingo.proforma.download',
          field: 'body',
          pattern: 'D[IÍ]JBEK[EÉ]R[ŐO]\\s+LET[ÖO]LT[EÉ]SE|(?:ses-track\\.billingo\\.hu|app\\.billingo\\.hu).*document-access',
          flags: 'is',
          required: true,
          source_ids: ['billingo-observed-proforma'],
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
    'A díjbekérő/proforma is not an invoice and must never emit INVOICE merely because Billingo reuses labels such as A számla végösszege or Számla sorszáma in the email template.',
    'The proforma profile intentionally has no invoice_id extractor even though the observed email contains a field labelled Számla sorszáma.',
    'A proforma requests payment but is not PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED or PAYMENT_SUCCESS evidence.',
    'Do not create or auto-link a purchase from a proforma by itself.',
    'Promotion to production should require live ingestion support for DKIM-domain evidence.',
  ],
};
