import type { ProtocolProfile } from '../types.js';

/**
 * iPon Hungary merchant shadow profile.
 *
 * V1 is based on directly observed recipient emails from info@ipon.hu,
 * including order creation, pre-handoff fulfilment updates, merchant parcel
 * pre-advice, invoice delivery, and hard-negative cart/review traffic.
 * Direct carrier/payment evidence remains higher authority.
 */
export const IPON_MERCHANT_TEST_V1: ProtocolProfile = {
  protocol_id: 'merchant.hu.ipon',
  protocol_version: '1.0.0-test.1',
  kind: 'merchant',
  status: 'test',
  display_name: 'iPon Hungary',
  country: 'HU',
  sender_domains: ['ipon.hu'],
  sender_addresses: ['info@ipon.hu'],
  identifier_patterns: {
    order_id: [
      'V[aá]s[aá]rl[aá]s\\s+azonos[ií]t[oó]:\\s*#(\\d{7})',
      'rendel[eé]si\\s+sz[aá]mon[^\\d]*(\\d{7})',
      'Rendel[eé]s\\s+#(\\d{7})',
      'Csomagfelad[aá]s\\s+#(\\d{7})',
    ],
    tracking_id: ['Csomagsz[aá]m:\\s*([A-Z0-9]+)'],
    invoice_id: ['Sz[aá]mla\\s+(\\d{4}/\\d{6})'],
    payment_reference: [],
  },
  sources: [
    {
      id: 'ipon-observed-order-created',
      title: 'Observed iPon order-recorded email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email from info@ipon.hu with subject iPon - Rendelés #NNNNNNN, explicit purchase/order identifier, product summary and wording that the order was recorded. The same email says the order is not an offer by iPon and currently represents a fulfilment mandate, so V1 does not infer more than ORDER_CREATED.',
    },
    {
      id: 'ipon-observed-prehandoff',
      title: 'Observed iPon future carrier-handoff update (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email on the same order says the products will be handed to the courier on a future date, or after assembly. This is pre-handoff order processing and not SHIPPED.',
    },
    {
      id: 'ipon-observed-parcel-preadvice',
      title: 'Observed iPon Csomagfeladás merchant email (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email titled Csomagfeladás says the order will be handed to GLS on that day, gives a parcel number and says tracking will become available within hours. V1 deliberately maps this to SHIPMENT_CREATED, not SHIPPED.',
    },
    {
      id: 'ipon-observed-gls-corroboration',
      title: 'Observed direct GLS pre-advice for same iPon parcel (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Five minutes after the iPon Csomagfeladás email, a direct GLS message with the same parcel number said the partner had prepared a parcel and delivery would be attempted after receipt. This corroborates that merchant Csomagfeladás is pre-advice rather than proven physical carrier possession.',
    },
    {
      id: 'ipon-observed-invoice',
      title: 'Observed iPon invoice email and attachments (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Direct recipient email subject Számla YYYY/###### explicitly says the invoice, warranty sheet and withdrawal information are attached. The invoice PDF filename follows YYYY-######-invoice-<internal>.pdf; the warranty PDF is a separate <internal>-guarantee.pdf document.',
    },
    {
      id: 'ipon-observed-auth',
      title: 'Observed iPon authenticated mail channel (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Representative order, parcel and invoice raw MIME all verify DKIM pass for ipon.hu, SPF pass for info@ipon.hu, DMARC pass and Return-Path info@ipon.hu. gw195.ipon.hu is transport infrastructure, not the semantic event boundary.',
    },
    {
      id: 'ipon-observed-cart',
      title: 'Observed iPon abandoned-cart reminder (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Authenticated info@ipon.hu email contains product name and price but explicitly says the products remained in the cart and invites the recipient to purchase them. It must never create a purchase.',
    },
    {
      id: 'ipon-observed-review',
      title: 'Observed iPon product review request (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Authenticated iPon review email asks for opinions on ordered products. It is not delivery proof.',
    },
    {
      id: 'ipon-observed-human-payment',
      title: 'Observed iPon human finance reply confirming transfer (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A named finance employee at a different @ipon.hu address manually confirmed that a transfer arrived. V1 does not generalize this human reply into an automated PAYMENT_SUCCESS template for info@ipon.hu.',
    },
    {
      id: 'ipon-observed-human-return',
      title: 'Observed iPon human withdrawal guidance (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Human support replies describe how withdrawal can be requested, but do not prove that a specific returned product was received or refunded. V1 implements no positive RETURN or REFUNDED rule from these replies.',
    },
    {
      id: 'ipon-official-faq',
      title: 'iPon - Gyakori kérdések',
      url: 'https://ipon.hu/gyakori-kerdesek',
      provenance: 'official_documentation',
      notes: 'Current iPon FAQ states that booked bank transfers trigger an automatic notification, invoices are issued after ordering, and invoice/warranty copies can be requested by invoice number or order identifier. No recipient template was found for the automatic transfer notification, so V1 does not invent one.',
    },
    {
      id: 'ipon-official-payment',
      title: 'iPon - Fizetési módok',
      url: 'https://ipon.hu/fizetesi-modok',
      provenance: 'official_documentation',
      notes: 'Current iPon payment documentation separates bank transfer/proforma, SimplePay, Saferpay and other financing methods. Provider evidence remains separate from merchant evidence.',
    },
    {
      id: 'ipon-official-delivery',
      title: 'iPon - Átvételi módok',
      url: 'https://ipon.hu/atveteli-modok',
      provenance: 'official_documentation',
      notes: 'Current iPon delivery documentation lists home delivery plus MPL/GLS parcel-point and locker options. Direct carrier messages outrank merchant pre-advice for physical parcel lifecycle.',
    },
    {
      id: 'ipon-official-warranty',
      title: 'iPon - Garancia',
      url: 'https://ipon.hu/garancia',
      provenance: 'official_documentation',
      notes: 'Current iPon warranty documentation describes a separate warranty-claim / GaranciaFutár process and required invoice/warranty documentation. Merely receiving a warranty PDF with a purchase is not proof that a warranty claim has started.',
    },
  ],
  events: [
    {
      event: 'ORDER_CREATED',
      base_confidence: 1,
      positive_rules: [
        { id: 'ipon.order-created.sender', field: 'sender_address', pattern: '^info@ipon\\.hu$', required: true, source_ids: ['ipon-observed-order-created'] },
        { id: 'ipon.order-created.dkim', field: 'dkim_domain', pattern: '^ipon\\.hu$', required: true, source_ids: ['ipon-observed-auth'] },
        { id: 'ipon.order-created.subject', field: 'subject', pattern: '^iPon\\s*-\\s*Rendel[eé]s\\s+#\\d{7}$', required: true, source_ids: ['ipon-observed-order-created'] },
        { id: 'ipon.order-created.recorded', field: 'body', pattern: 'term[eé]k\\(ek\\)\\s+rendel[eé]s[eé]t\\s+r[oö]gz[ií]tett[uü]k[\\s\\S]{0,100}\\d{7}\\s+rendel[eé]si\\s+sz[aá]mon', required: true, source_ids: ['ipon-observed-order-created'] },
        { id: 'ipon.order-created.boundary', field: 'body', pattern: 'jelen\\s+megrendel[eé]s[\\s\\S]{0,100}aj[aá]nlatt[eé]telnek\\s+nem\\s+min[oő]s[uü]l', required: true, source_ids: ['ipon-observed-order-created'] },
      ],
    },
    {
      event: 'ORDER_PROCESSING',
      base_confidence: 0.98,
      positive_rules: [
        { id: 'ipon.processing.sender', field: 'sender_address', pattern: '^info@ipon\\.hu$', required: true, source_ids: ['ipon-observed-prehandoff'] },
        { id: 'ipon.processing.dkim', field: 'dkim_domain', pattern: '^ipon\\.hu$', required: true, source_ids: ['ipon-observed-auth'] },
        { id: 'ipon.processing.subject', field: 'subject', pattern: '^iPon\\s*-\\s*Rendel[eé]s\\s+#\\d{7}$', required: true, source_ids: ['ipon-observed-prehandoff'] },
        { id: 'ipon.processing.future-handoff', field: 'body', pattern: '(?:[oö]sszek[eé]sz[ií]t[eé]s\\s+ut[aá]n|(?:h[eé]tf[oő]n|kedden|szerd[aá]n|cs[uü]t[oö]rt[oö]k[oö]n|p[eé]nteken|szombaton|vas[aá]rnap)[\\s\\S]{0,40})\\s*[aá]tadjuk\\s+a\\s+fut[aá]rnak', required: true, source_ids: ['ipon-observed-prehandoff'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
    },
    {
      event: 'SHIPMENT_CREATED',
      base_confidence: 1,
      positive_rules: [
        { id: 'ipon.shipment-created.sender', field: 'sender_address', pattern: '^info@ipon\\.hu$', required: true, source_ids: ['ipon-observed-parcel-preadvice'] },
        { id: 'ipon.shipment-created.dkim', field: 'dkim_domain', pattern: '^ipon\\.hu$', required: true, source_ids: ['ipon-observed-auth'] },
        { id: 'ipon.shipment-created.subject', field: 'subject', pattern: '^Csomagfelad[aá]s\\s+#\\d{7}$', required: true, source_ids: ['ipon-observed-parcel-preadvice'] },
        { id: 'ipon.shipment-created.future-handoff', field: 'body', pattern: 'Rendel[eé]sedet\\s+a\\s+mai\\s+napon\\s+[aá]tadjuk\\s+a\\s+(?:GLS|SZAMI\\s+Group)\\s+fut[aá]rszolg[aá]latnak', required: true, source_ids: ['ipon-observed-parcel-preadvice', 'ipon-observed-gls-corroboration'] },
        { id: 'ipon.shipment-created.tracking', field: 'body', pattern: 'Csomagsz[aá]m:\\s*[A-Z0-9]+', required: true, source_ids: ['ipon-observed-parcel-preadvice'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
    },
    {
      event: 'INVOICE',
      base_confidence: 1,
      positive_rules: [
        { id: 'ipon.invoice.sender', field: 'sender_address', pattern: '^info@ipon\\.hu$', required: true, source_ids: ['ipon-observed-invoice'] },
        { id: 'ipon.invoice.dkim', field: 'dkim_domain', pattern: '^ipon\\.hu$', required: true, source_ids: ['ipon-observed-auth'] },
        { id: 'ipon.invoice.subject', field: 'subject', pattern: '^Sz[aá]mla\\s+\\d{4}/\\d{6}$', required: true, source_ids: ['ipon-observed-invoice'] },
        { id: 'ipon.invoice.body', field: 'body', pattern: 'Mell[eé]kelten\\s+k[uü]ldj[uü]k\\s+a\\s+v[aá]s[aá]rl[aá]shoz\\s+tartoz[oó]\\s+sz[aá]ml[aá]t,\\s+a\\s+garanciajegyet\\s+[eé]s\\s+az\\s+el[aá]ll[aá]si\\s+t[aá]j[eé]koztat[oó]t', required: true, source_ids: ['ipon-observed-invoice'] },
        { id: 'ipon.invoice.attachment', field: 'attachment_filename', pattern: '^\\d{4}-\\d{6}-invoice-\\d+\\.pdf$', required: true, source_ids: ['ipon-observed-invoice'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
    },
    {
      event: 'OTHER',
      base_confidence: 1,
      positive_rules: [
        { id: 'ipon.nonpurchase.sender', field: 'sender_address', pattern: '^info@ipon\\.hu$', required: true, source_ids: ['ipon-observed-cart', 'ipon-observed-review'] },
        { id: 'ipon.nonpurchase.dkim', field: 'dkim_domain', pattern: '^ipon\\.hu$', required: true, source_ids: ['ipon-observed-auth'] },
        { id: 'ipon.nonpurchase.subject', field: 'subject', pattern: '^(?:Kos[aá]r\\s+eml[eé]keztet[oő]|Term[eé]kek\\s+v[eé]lem[eé]nyez[eé]se)$', required: true, source_ids: ['ipon-observed-cart', 'ipon-observed-review'] },
        { id: 'ipon.nonpurchase.body', field: 'body', pattern: '(?:KOS[AÁ]RBAN\\s+MARADT\\s+TERM[EÉ]KEK|k[oö]saradban\\s+maradt|V[eé]lem[eé]nyezze\\s+a\\s+megrendelt\\s+term[eé]keket|El[eé]gedett\\s+a\\s+term[eé]kkel)', required: true, source_ids: ['ipon-observed-cart', 'ipon-observed-review'] },
      ],
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED', 'DO_NOT_MARK_REFUNDED'],
    },
  ],
  notes: [
    'The exact info@ipon.hu + DKIM ipon.hu channel carries both real purchase lifecycle emails and hard-negative cart/review traffic; sender identity alone is never enough.',
    'The initial order email records the order but explicitly states an offer/contract boundary. V1 emits ORDER_CREATED only and does not infer payment or shipment.',
    'Future courier-handoff wording under the same iPon - Rendelés subject is ORDER_PROCESSING only. It must never become SHIPPED.',
    'Csomagfeladás is intentionally SHIPMENT_CREATED, not SHIPPED, because the body says the parcel will be handed over that day and tracking becomes active later. A direct GLS pre-advice with the same parcel id arrived minutes later, corroborating the pre-advice interpretation.',
    'Direct GLS/MPL/SZAMI carrier evidence outranks iPon merchant logistics evidence for later physical lifecycle.',
    'Invoice email independently proves INVOICE from explicit subject/body plus invoice attachment. A separate guarantee PDF and withdrawal-information PDF do not create WARRANTY or RETURN events.',
    'The invoice number is extracted from the explicit subject YYYY/######. Internal numbers in invoice/guarantee filenames are not treated as order identifiers.',
    'A human finance reply saying a transfer arrived is not generalized into a provider-independent automated PAYMENT_SUCCESS rule. Current iPon documentation says an automatic transfer notification exists, but V1 has no verified recipient template for it.',
    'Human withdrawal guidance is not proof that a return was physically received, and return/refund wording in boilerplate does not create RETURN or REFUNDED.',
    'No positive SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, DELIVERY_FAILED, DELAYED, CANCELLED, PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED, RETURN, REFUNDED or WARRANTY rule is added without a verified direct recipient template.',
  ],
};
