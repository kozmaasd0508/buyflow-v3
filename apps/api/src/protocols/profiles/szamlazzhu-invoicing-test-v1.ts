import type { ProtocolProfile } from '../types.js';

const SZAMLAZZHU_COMMON_SOURCES: ProtocolProfile['sources'] = [
  {
    id: 'szamlazzhu-official-sender',
    title: 'Számlázz.hu - Számlaértesítő e-mailek feladó- és válaszcíme',
    url: 'https://tudastar.szamlazz.hu/gyik/belso-email-valasz-email-kulonbseg',
    provenance: 'official_documentation',
    notes: 'Számlázz.hu documents that invoice notifications are sent from an account-specific address ending in @szamlazz.hu; the local part is configurable per account.',
  },
  {
    id: 'szamlazzhu-official-notifications',
    title: 'Számlázz.hu - Számlaértesítő működése',
    url: 'https://tudastar.szamlazz.hu/gyik/szamlaertesito-mukodese',
    provenance: 'official_documentation',
    notes: 'Számlázz.hu documents customizable notification templates and separate classes for invoice notification, payment reminder, payment demand, proforma notification and other document notifications.',
  },
  {
    id: 'szamlazzhu-official-storno',
    title: 'Számlázz.hu - Számla sztornózása',
    url: 'https://tudastar.szamlazz.hu/gyik/szamla-sztornozasa',
    provenance: 'official_documentation',
    notes: 'Számlázz.hu documents that a cancellation/storno invalidates an already issued invoice; an issued numbered invoice is not deleted.',
  },
  {
    id: 'szamlazzhu-official-proforma',
    title: 'Számlázz.hu - Mit kell tudni a díjbekérőről?',
    url: 'https://tudastar.szamlazz.hu/gyik/mi-a-kulonbseg-a-dijbekero-es-a-szamla-kozott',
    provenance: 'official_documentation',
    notes: 'Számlázz.hu explicitly states that a díjbekérő/proforma is a payment request and is not an invoice.',
  },
  {
    id: 'szamlazzhu-official-reminders',
    title: 'Számlázz.hu - Automatikus fizetési felszólítás és díjbekérő emlékeztető',
    url: 'https://tudastar.szamlazz.hu/gyik/automatikus-fizetesi-felszolitas',
    provenance: 'official_documentation',
    notes: 'Számlázz.hu documents automatic payment reminders/demands for unsettled documents after configured deadlines. These are collection reminders, not payment-provider failure events.',
  },
  {
    id: 'szamlazzhu-observed-standard-invoice',
    title: 'Observed Számlázz.hu standard invoice notification (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Multiple real recipient emails used merchant-specific <local>@szamlazz.hu senders, a Számlázz.hu invoice download link and invoice-delivery wording. Some messages had no PDF attachment.',
  },
  {
    id: 'szamlazzhu-observed-attached-invoice',
    title: 'Observed Számlázz.hu invoice with PDF attachment (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'A real merchant invoice notification included a PDF named from the invoice number and a matching Számlázz.hu download link.',
  },
  {
    id: 'szamlazzhu-observed-custom-shipping-template',
    title: 'Observed merchant-customized Számlázz.hu notification (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'A real @szamlazz.hu notification used a shipping-oriented subject/body because templates are merchant-customizable, while the message still explicitly said the invoice had been created and included the Számlázz.hu invoice download link. This proves subject semantics are not provider lifecycle authority.',
  },
  {
    id: 'szamlazzhu-observed-storno',
    title: 'Observed Számlázz.hu storno notification (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'A real authenticated notification explicitly said an identified original invoice was cancelled and that the storno invoice was attached. The attachment carried a different storno-document number.',
  },
  {
    id: 'szamlazzhu-observed-reminder',
    title: 'Observed Számlázz.hu payment reminder (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'A real authenticated reminder said the invoice payment deadline was approaching and asked the recipient to arrange settlement. This is not a bank/card failure event.',
  },
  {
    id: 'szamlazzhu-observed-auth',
    title: 'Observed Számlázz.hu authenticated mail infrastructure (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Raw MIME from invoice, storno, customized and reminder messages verified szamlazz.hu DKIM pass, SPF pass, DMARC pass and ses.szamlazz.hu Return-Path via Amazon SES.',
  },
  {
    id: 'szamlazzhu-observed-header',
    title: 'Observed X-Szamlazz-Invoice header (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Representative raw MIME contained X-Szamlazz-Invoice with the actual document number, including link-only invoice notifications and reminders. Current ProtocolDetectionInput does not expose arbitrary raw headers, so V1 records this as future high-value evidence rather than inventing access to it.',
  },
  {
    id: 'szamlazzhu-observed-missing-templates',
    title: 'Targeted mailbox searches for Számlázz.hu proforma and correction templates (sanitized)',
    provenance: 'observed_real_email',
    observed_at: '2026-08-16',
    notes: 'Targeted recipient-mailbox searches found no direct authenticated díjbekérő/proforma or módosító/helyesbítő examples, so V1 implements no positive parser for those templates.',
  },
];

/**
 * Direct Számlázz.hu invoice-notification authority.
 *
 * The sender local-part and notification text are merchant-configurable, so V1
 * does not rely on a fixed mailbox or fixed subject. It requires a real
 * @szamlazz.hu sender, szamlazz.hu DKIM, a Számlázz.hu invoice-access link and
 * explicit invoice-existence wording observed in recipient messages.
 */
export const SZAMLAZZHU_INVOICE_TEST_V1: ProtocolProfile = {
  protocol_id: 'invoicing.hu.szamlazz',
  protocol_version: '1.0.0-test.1',
  kind: 'invoicing',
  status: 'test',
  display_name: 'Számlázz.hu',
  country: 'HU',
  sender_domains: ['szamlazz.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [
      '(?:^|\\n)([A-Z0-9]+(?:-[A-Z0-9]+)*-\\d{4}-\\d+)\\.pdf(?:\\n|$)',
    ],
    payment_reference: [],
  },
  sources: SZAMLAZZHU_COMMON_SOURCES,
  events: [
    {
      event: 'INVOICE',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'szamlazzhu.invoice.sender',
          field: 'sender_address',
          pattern: '^[A-Z0-9._%+-]+@szamlazz\\.hu$',
          flags: 'i',
          required: true,
          source_ids: ['szamlazzhu-official-sender', 'szamlazzhu-observed-standard-invoice'],
        },
        {
          id: 'szamlazzhu.invoice.dkim',
          field: 'dkim_domain',
          pattern: '^szamlazz\\.hu$',
          required: true,
          source_ids: ['szamlazzhu-observed-auth'],
        },
        {
          id: 'szamlazzhu.invoice.download-link',
          field: 'body',
          pattern: 'https?://(?:www\\.)?szamlazz\\.hu/szamla/fiok/',
          required: true,
          source_ids: ['szamlazzhu-official-notifications', 'szamlazzhu-observed-standard-invoice', 'szamlazzhu-observed-custom-shipping-template'],
        },
        {
          id: 'szamlazzhu.invoice.explicit-document',
          field: 'body',
          pattern: '(?:sz[aá]mla\\s+[eé]rkezett|k[uü]ldj[uü]k\\s+(?:az\\s+)?(?:aktu[aá]lis\\s+)?sz[aá]ml[aá](?:j[aá]t|dat)|mell[eé]kelten\\s+k[uü]ldj[uü]k[^\\r\\n]{0,120}sz[aá]ml[aá](?:j[aá]t|dat)|sz[aá]ml[aá](?:d|dat|ja|j[aá]t)\\s+(?:is\\s+)?elk[eé]sz[uü]lt|sz[aá]ml[aá](?:d|dat|ja|j[aá]t)[^\\r\\n]{0,160}(?:t[oö]ltheted\\s+le|let[oö]lt[eé]s)|v[aá]s[aá]rl[aá]s[aá]r[oó]l[^\\r\\n]{0,160}sz[aá]ml[aá]t\\s+[aá]ll[ií]tottuk\\s+ki)',
          required: true,
          source_ids: ['szamlazzhu-observed-standard-invoice', 'szamlazzhu-observed-attached-invoice', 'szamlazzhu-observed-custom-shipping-template'],
        },
      ],
      negative_rules: [
        {
          id: 'szamlazzhu.invoice.storno',
          field: 'body',
          pattern: '(?:sztorn[oó]ztuk|sztorn[oó]sz[aá]mla|[eé]rv[eé]nytelen[ií]t)',
          source_ids: ['szamlazzhu-official-storno', 'szamlazzhu-observed-storno'],
        },
        {
          id: 'szamlazzhu.invoice.reminder',
          field: 'body',
          pattern: '(?:kifizet[eé]sre\\s+v[aá]r|fizet[eé]si\\s+hat[aá]rideje[^\\r\\n]{0,100}lej[aá]r|fizet[eé]si\\s+eml[eé]keztet[oő]|fizet[eé]si\\s+felsz[oó]l[ií]t)',
          source_ids: ['szamlazzhu-official-reminders', 'szamlazzhu-observed-reminder'],
        },
        {
          id: 'szamlazzhu.invoice.proforma',
          field: 'body',
          pattern: 'd[ií]jbek[eé]r[oő]',
          source_ids: ['szamlazzhu-official-proforma', 'szamlazzhu-observed-missing-templates'],
        },
        {
          id: 'szamlazzhu.invoice.other-document',
          field: 'body',
          pattern: '(?:sz[aá]ll[ií]t[oó]lev[eé]l|nyugta[eé]rtes[ií]t[oő])',
          source_ids: ['szamlazzhu-official-notifications'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_AUTO_LINK',
      ],
    },
  ],
  notes: [
    'The @szamlazz.hu local-part is merchant/account-specific and the notification subject/body can be customized. Do not build a fixed-sender or fixed-subject global parser.',
    'A merchant-customized Számlázz.hu message may talk about shipment status. This invoicing profile can recognize the invoice evidence inside it, but it must never act as carrier/logistics authority.',
    'Invoice number extraction is intentionally conservative: V1 only extracts an invoice-like year/sequence value from a matching PDF attachment filename. Link-only messages may therefore have invoice_id=null.',
    'Raw recipient MIME exposes a strong X-Szamlazz-Invoice header with the document number, but current ProtocolDetectionInput does not expose arbitrary headers. Do not pretend this evidence is available until ingestion is extended safely.',
    'Invoice existence never proves PAYMENT_SUCCESS. Payment method, COD wording, totals and an invoice download link are not payment-provider settlement evidence.',
    'A Számlázz.hu invoice may cover ecommerce, subscriptions, services or B2B activity, so it must not create or auto-link a BuyFlow purchase by itself.',
    'Promotion to production should require live ingestion support for DKIM-domain evidence.',
  ],
};

/**
 * Authenticated Számlázz.hu storno notification.
 *
 * The current BuyFlow event vocabulary has no invoice-cancellation subtype. V1
 * therefore records this as OTHER rather than falsely treating a cancellation
 * invoice as a normal INVOICE or as a REFUNDED payment.
 */
export const SZAMLAZZHU_STORNO_TEST_V1: ProtocolProfile = {
  protocol_id: 'invoicing.hu.szamlazz.storno',
  protocol_version: '1.0.0-test.1',
  kind: 'invoicing',
  status: 'test',
  display_name: 'Számlázz.hu Sztornó',
  country: 'HU',
  sender_domains: ['szamlazz.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: SZAMLAZZHU_COMMON_SOURCES,
  events: [
    {
      event: 'OTHER',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'szamlazzhu.storno.sender',
          field: 'sender_address',
          pattern: '^[A-Z0-9._%+-]+@szamlazz\\.hu$',
          flags: 'i',
          required: true,
          source_ids: ['szamlazzhu-official-sender', 'szamlazzhu-observed-storno'],
        },
        {
          id: 'szamlazzhu.storno.dkim',
          field: 'dkim_domain',
          pattern: '^szamlazz\\.hu$',
          required: true,
          source_ids: ['szamlazzhu-observed-auth'],
        },
        {
          id: 'szamlazzhu.storno.original-cancelled',
          field: 'body',
          pattern: 'sorsz[aá]m[uú]\\s+sz[aá]ml[aá](?:dat|j[aá]t)?\\s+sztorn[oó]ztuk',
          required: true,
          source_ids: ['szamlazzhu-official-storno', 'szamlazzhu-observed-storno'],
        },
        {
          id: 'szamlazzhu.storno.document',
          field: 'body',
          pattern: 'sztorn[oó]sz[aá]ml[aá]t[^\\r\\n]{0,120}mell[eé]kletben',
          required: true,
          source_ids: ['szamlazzhu-observed-storno'],
        },
        {
          id: 'szamlazzhu.storno.download-link',
          field: 'body',
          pattern: 'https?://(?:www\\.)?szamlazz\\.hu/szamla/fiok/',
          required: true,
          source_ids: ['szamlazzhu-observed-storno'],
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
    'Sztornó means the original invoice is invalidated; it does not prove money was refunded. Never map invoice cancellation directly to REFUNDED.',
    'The observed storno message contains two different identities: the original invoice number in the body and the new storno-document number in the attachment/X-Szamlazz-Invoice header. V1 deliberately extracts neither into a single invoice_id field to avoid collapsing them.',
    'A future document model should carry document subtype plus original_document_id and cancellation_document_id separately.',
  ],
};

/**
 * Authenticated Számlázz.hu invoice payment reminder.
 *
 * A reminder says the invoicing system/issuer still considers settlement due at
 * send time. It is not evidence that a bank/card transaction failed and is not
 * a permanent statement about the invoice's current status.
 */
export const SZAMLAZZHU_PAYMENT_REMINDER_TEST_V1: ProtocolProfile = {
  protocol_id: 'invoicing.hu.szamlazz.payment-reminder',
  protocol_version: '1.0.0-test.1',
  kind: 'invoicing',
  status: 'test',
  display_name: 'Számlázz.hu Fizetési emlékeztető',
  country: 'HU',
  sender_domains: ['szamlazz.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [],
    payment_reference: [],
  },
  sources: SZAMLAZZHU_COMMON_SOURCES,
  events: [
    {
      event: 'OTHER',
      base_confidence: 1,
      positive_rules: [
        {
          id: 'szamlazzhu.reminder.sender',
          field: 'sender_address',
          pattern: '^[A-Z0-9._%+-]+@szamlazz\\.hu$',
          flags: 'i',
          required: true,
          source_ids: ['szamlazzhu-official-sender', 'szamlazzhu-observed-reminder'],
        },
        {
          id: 'szamlazzhu.reminder.dkim',
          field: 'dkim_domain',
          pattern: '^szamlazz\\.hu$',
          required: true,
          source_ids: ['szamlazzhu-observed-auth'],
        },
        {
          id: 'szamlazzhu.reminder.deadline',
          field: 'body',
          pattern: 'sz[aá]ml[aá]ja\\s+fizet[eé]si\\s+hat[aá]rideje[^\\r\\n]{0,100}lej[aá]r',
          required: true,
          source_ids: ['szamlazzhu-official-reminders', 'szamlazzhu-observed-reminder'],
        },
        {
          id: 'szamlazzhu.reminder.settlement-request',
          field: 'body',
          pattern: 'sz[aá]mla\\s+kiegyenl[ií]t[eé]s[eé]r[oő]l[^\\r\\n]{0,100}gondoskod',
          required: true,
          source_ids: ['szamlazzhu-observed-reminder'],
        },
        {
          id: 'szamlazzhu.reminder.download-link',
          field: 'body',
          pattern: 'https?://(?:www\\.)?szamlazz\\.hu/szamla/fiok/',
          required: true,
          source_ids: ['szamlazzhu-observed-reminder'],
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
    'A payment reminder is not PAYMENT_FAILED: it does not prove a payment-provider attempt was declined or failed.',
    'A payment reminder is not PAYMENT_ACTION_REQUIRED in the payment-provider sense: it is an invoicing/collection notice, not 3DS or provider remediation evidence.',
    'The observed raw MIME contains X-Szamlazz-Invoice, but V1 does not invent access to raw headers. invoice_id remains null until ingestion exposes that evidence safely.',
  ],
};
