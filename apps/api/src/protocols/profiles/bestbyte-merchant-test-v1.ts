import type { ProtocolProfile } from '../types.js';

/**
 * BestByte Hungary merchant shadow profile.
 *
 * V1 is intentionally narrow. The connected mailbox contains one directly
 * authenticated BestByte recipient email family: electronic invoice delivery
 * from noreply@bestbyte.hu. Order and shipment lifecycle for observed BestByte
 * purchases arrived through marketplace and direct-carrier channels instead,
 * so this profile must not absorb fizz.hu, GLS or Express One authority.
 */
export const BESTBYTE_MERCHANT_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.bestbyte',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'BestByte Hungary',
  country: 'HU',
  sender_domains: ['bestbyte.hu'],
  sender_addresses: ['noreply@bestbyte.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [],
    invoice_id: [
      'Elektronikus\\s+sz[aá]mla\\s*-\\s*([A-Z0-9]+)',
      '\\b([A-Z0-9]+)\\s+bizonylatsz[aá]mmal\\s+[uú]j\\s+elektronikus\\s+sz[aá]mla',
      '^([A-Z0-9]+)\\.PDF$',
    ],
    payment_reference: [],
  },
  sources: [
    {
      id: 'bestbyte-observed-direct-invoice',
      title: 'Observed direct BestByte electronic invoice email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email from noreply@bestbyte.hu has subject Elektronikus számla - <document-id>, explicitly says a new electronic invoice was created under the same bizonylatszám, and attaches both <document-id>.PDF and HASH_<document-id>.TXT. V1 treats this as merchant-origin INVOICE evidence only.',
    },
    {
      id: 'bestbyte-observed-auth',
      title: 'Observed BestByte invoice mail authentication/infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Representative raw MIME shows exact sender and Return-Path noreply@bestbyte.hu, SPF pass for noreply@bestbyte.hu, DMARC pass for bestbyte.hu, and transport host noreply.bestbyte.smtp.hu. No BestByte DKIM signature was observed, so V1 deliberately does not require or invent one.',
    },
    {
      id: 'bestbyte-observed-fizz-marketplace',
      title: 'Observed fizz.hu marketplace lifecycle for a BestByte-sold purchase (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'The connected mailbox contains fizz.hu ORDER_CREATED / shipment / invoice wrapper emails for orders where BestByte Kft. is the seller. Those messages are from noreply@fizz.hu and must remain fizz commerce/marketplace evidence rather than being reclassified as direct BestByte merchant mail.',
    },
    {
      id: 'bestbyte-observed-carrier-boundary',
      title: 'Observed direct carrier lifecycle for BestByte shipments (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct GLS and Express One messages identify BestByte as sender/partner while proving parcel lifecycle. Carrier evidence remains higher logistics authority than merchant or marketplace wording.',
    },
    {
      id: 'bestbyte-official-aszf',
      title: 'BestByte - Általános Szerződési Feltételek',
      url: 'https://www.bestbyte.hu/altalanos-szerzodesi-feltetelek-jaszf.html',
      provenance: 'official_documentation',
      notes: 'Current terms state that the automatic email acknowledging arrival of a submitted order is not acceptance of the customer offer. V1 therefore does not invent ORDER_CREATED/accepted-order semantics from an unobserved BestByte recipient template.',
    },
    {
      id: 'bestbyte-official-delivery',
      title: 'BestByte - Fizetési és szállítási információ',
      url: 'https://www.bestbyte.hu/fizetesi-es-szallitasi-informacio-hSZALLITAS.html',
      provenance: 'official_documentation',
      notes: 'Current delivery documentation distinguishes BestByte store/warehouse pickup, home delivery and parcel-point/locker fulfilment. Direct carrier evidence remains authoritative for physical shipment lifecycle.',
    },
    {
      id: 'bestbyte-official-return',
      title: 'BestByte - Termék visszaküldése',
      url: 'https://www.bestbyte.hu/visszakuld-hVISSZAKULD.html',
      provenance: 'official_documentation',
      notes: 'Current return documentation describes requesting a return and sending goods back. A return request or return-right text is not proof of a physically received return or settled refund.',
    },
    {
      id: 'bestbyte-official-faq',
      title: 'BestByte - Gyakran Ismételt Kérdések',
      url: 'https://www.bestbyte.hu/-hGYIK.html',
      provenance: 'official_documentation',
      notes: 'Current FAQ states refund follows goods return/crediting and is later transferred by accounting. Return and refund are therefore distinct lifecycle states.',
    },
  ],
  events: [
    {
      event: 'INVOICE',
      base_confidence: 1,
      positive_rules: [
        { id: 'bestbyte.invoice.sender', field: 'sender_address', pattern: '^noreply@bestbyte\\.hu$', required: true, source_ids: ['bestbyte-observed-direct-invoice'] },
        { id: 'bestbyte.invoice.return-path', field: 'return_path_domain', pattern: '^bestbyte\\.hu$', required: true, source_ids: ['bestbyte-observed-auth'] },
        { id: 'bestbyte.invoice.subject', field: 'subject', pattern: '^Elektronikus\\s+sz[aá]mla\\s*-\\s*[A-Z0-9]+$', required: true, source_ids: ['bestbyte-observed-direct-invoice'] },
        { id: 'bestbyte.invoice.created', field: 'body', pattern: '[A-Z0-9]+\\s+bizonylatsz[aá]mmal\\s+[uú]j\\s+elektronikus\\s+sz[aá]mla\\s+k[eé]sz[uü]lt', required: true, source_ids: ['bestbyte-observed-direct-invoice'] },
        { id: 'bestbyte.invoice.attachment-text', field: 'body', pattern: 'Elektronikus\\s+sz[aá]ml[aá]jukat[\\s\\S]{0,120}hash\\s+k[oó]d[\\s\\S]{0,120}mell[eé]klet', required: true, source_ids: ['bestbyte-observed-direct-invoice'] },
        { id: 'bestbyte.invoice.pdf', field: 'attachment_filename', pattern: '^[A-Z0-9]+\\.PDF$', required: true, source_ids: ['bestbyte-observed-direct-invoice'] },
        { id: 'bestbyte.invoice.hash', field: 'attachment_filename', pattern: '^HASH_[A-Z0-9]+\\.TXT$', required: true, source_ids: ['bestbyte-observed-direct-invoice'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK', 'DO_NOT_MARK_REFUNDED'],
    },
  ],
  notes: [
    'V1 is a direct BestByte INVOICE-only shadow profile. No direct BestByte order/shipment/cancellation/return/refund recipient template was observed in the connected mailbox.',
    'No BestByte DKIM signature was observed on the representative invoice email; do not fabricate a DKIM requirement. Exact sender + Return-Path + document structure are used in shadow evaluation.',
    'A fizz.hu email that names BestByte as seller remains fizz marketplace/commerce authority, not direct BestByte merchant authority.',
    'A GLS or Express One email that names BestByte as parcel sender remains direct carrier authority.',
    'The BestByte invoice document identifier is invoice_id only. It must never be promoted to order_id or payment_reference.',
    'Invoice issuance does not prove PAYMENT_SUCCESS and must not create a purchase automatically.',
    'Official order-receipt semantics are documented, but V1 intentionally implements no positive order rule without an observed current direct recipient template.',
    'Return request, return-right wording, crediting and settled refund remain separate states; V1 implements none without observed recipient evidence.',
  ],
};
