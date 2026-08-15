import type {
  ProtocolEventCandidate,
  ProtocolProhibition,
  ProtocolSourceReference,
} from '../types.js';

export interface EmagHuResearchEvent {
  source_event: string;
  event_candidate: ProtocolEventCandidate;
  prohibitions: ProtocolProhibition[];
  requirements: string[];
  source_ids: string[];
  notes: string;
}

export interface EmagHuStructuralSignal {
  name: string;
  meaning: string;
  authority: 'customer_help' | 'marketplace_platform';
  source_ids: string[];
}

/**
 * eMAG HU merchant research V1.
 *
 * No executable raw-email profile is exposed yet. The official material gives
 * strong order/fulfillment/return semantics, but it does not establish a stable
 * customer-email sender plus rendered subject/body fingerprint set. The catalog
 * therefore records verified merchant semantics and explicit traps without
 * changing production email recognition.
 */
export const EMAG_HU_RESEARCH_V1 = {
  protocol_id: 'merchant.hu.emag',
  protocol_version: '1.0.0-research.1',
  display_name: 'eMAG Hungary',
  country: 'HU',
  status: 'research' as const,
  executable_raw_email_profile: false,
  sources: [
    {
      id: 'emag-help-easybox',
      title: 'eMAG easybox - customer pickup and return flow',
      url: 'https://www.emag.hu/easybox',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-help-return-refund-service',
      title: 'eMAG return, service and refund questions',
      url: 'https://www.emag.hu/help/termekvisszakuldessel-szervizelessel-visszateritessel-kapcsolatos-kerdesek/',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-help-withdrawal',
      title: 'eMAG withdrawal rights and seller distinction',
      url: 'https://www.emag.hu/help/elallasi-jog/',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-marketplace-orders',
      title: 'eMAG Marketplace order processing and statuses',
      url: 'https://marketplace.emag.hu/infocenter/emag-academy/rendelesek/rendelesek-menu-altalanos-informaciok/',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-marketplace-card',
      title: 'eMAG Marketplace online card payment',
      url: 'https://marketplace.emag.hu/infocenter/emag-academy/rendelesek/fizetesi-modok/online-bankkartyas-fizetes/',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-marketplace-cod',
      title: 'eMAG Marketplace cash on delivery payment',
      url: 'https://marketplace.emag.hu/infocenter/emag-academy/rendelesek/fizetesi-modok/utanvetes-fizetesi-mod/',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-marketplace-awb-multiparcel',
      title: 'eMAG Marketplace AWB generation for multiple parcels',
      url: 'https://marketplace.emag.hu/infocenter/emag-academy/rendelesek/awb-generalasa-az-emag-marketplace-feluleten/',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-marketplace-returned',
      title: 'eMAG Marketplace returned order status',
      url: 'https://marketplace.emag.hu/infocenter/emag-academy/rendelesek/a-visszajott-rendelesi-statusz-beallitasa/',
      provenance: 'official_documentation',
    },
    {
      id: 'emag-marketplace-cancel',
      title: 'eMAG Marketplace customer cancellation handling',
      url: 'https://marketplace.emag.hu/infocenter/emag-academy/rendelesek/a-vasarlo-altal-lemondott-rendelesek-kezelese/',
      provenance: 'official_documentation',
    },
  ] satisfies ProtocolSourceReference[],
  structural_signals: [
    {
      name: 'order identifier',
      meaning: 'Marketplace assigns a unique identifier to each registered order.',
      authority: 'marketplace_platform',
      source_ids: ['emag-marketplace-orders'],
    },
    {
      name: 'payment and delivery method',
      meaning: 'Order details expose selected payment and shipping method.',
      authority: 'marketplace_platform',
      source_ids: ['emag-marketplace-orders'],
    },
    {
      name: 'carrier + AWB',
      meaning: 'Shipping data can expose carrier name and AWB; one order may have multiple parcels/AWBs.',
      authority: 'marketplace_platform',
      source_ids: ['emag-marketplace-orders', 'emag-marketplace-awb-multiparcel'],
    },
    {
      name: 'order total',
      meaning: 'Marketplace order details expose total including VAT.',
      authority: 'marketplace_platform',
      source_ids: ['emag-marketplace-orders'],
    },
    {
      name: 'product rows',
      meaning: 'Marketplace order details expose product name, PNK, quantity, selling price and order value.',
      authority: 'marketplace_platform',
      source_ids: ['emag-marketplace-orders'],
    },
    {
      name: 'invoice / warranty attachment types',
      meaning: 'Marketplace supports invoice and warranty attachments; customer account exposes invoice and warranty documents for applicable eMAG-sold products.',
      authority: 'customer_help',
      source_ids: ['emag-marketplace-orders', 'emag-help-return-refund-service'],
    },
  ] satisfies EmagHuStructuralSignal[],
  events: [
    {
      source_event: 'customer order is registered / new Marketplace order',
      event_candidate: 'ORDER_CREATED',
      prohibitions: [],
      requirements: [
        'customer-facing or observed email must contain a stable explicit order identifier',
        'seller/merchant identity must be preserved because eMAG Marketplace orders can involve eMAG or a Marketplace partner',
      ],
      source_ids: ['emag-marketplace-orders', 'emag-help-withdrawal'],
      notes: 'Official platform docs prove an order receives a unique id and starts as New when registered. V1 does not invent a customer email subject or sender from that platform fact.',
    },
    {
      source_event: 'Marketplace order opened for preparation / Folyamatban',
      event_candidate: 'ORDER_PROCESSING',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
      requirements: ['only use if the state is actually rendered in a verified customer email or merchant API evidence'],
      source_ids: ['emag-marketplace-orders'],
      notes: 'Folyamatban means the seller started preparing the order; it is not shipment progress.',
    },
    {
      source_event: 'AWB generated / seller platform marks order Befejezett',
      event_candidate: 'SHIPMENT_CREATED',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
      requirements: ['extract each AWB independently', 'do not collapse multiple AWBs under the same order into one tracking identity'],
      source_ids: ['emag-marketplace-orders', 'emag-marketplace-awb-multiparcel'],
      notes: 'Generating an AWB can automatically move the seller-side order to Befejezett. That status is not proof of carrier acceptance, transit, or customer delivery.',
    },
    {
      source_event: 'easybox pickup notification received by SMS/Viber',
      event_candidate: 'READY_FOR_PICKUP',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_DELIVERED'],
      requirements: ['exact order/shipment identity or independently linked pickup code/tracking identity'],
      source_ids: ['emag-help-easybox'],
      notes: 'The customer pickup window starts from the easybox SMS/Viber notification. Ready for pickup is explicitly not delivered.',
    },
    {
      source_event: 'customer requests cancellation / withdrawal before completion',
      event_candidate: 'CANCELLED',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
      requirements: ['distinguish request/intent from final cancellation when only request evidence exists'],
      source_ids: ['emag-marketplace-cancel', 'emag-help-withdrawal'],
      notes: 'Customer cancellation/withdrawal and money refund are separate facts. A cancellation request must not finalize REFUNDED.',
    },
    {
      source_event: 'return form/request created',
      event_candidate: 'RETURN',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
      requirements: ['link to exact purchase/product when multi-item order exists'],
      source_ids: ['emag-help-return-refund-service', 'emag-help-withdrawal'],
      notes: 'After the return request, collection/return and inspection still remain. Request creation is not refund settlement.',
    },
    {
      source_event: 'returned product received / inspected / approved',
      event_candidate: 'RETURN',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
      requirements: ['keep return approval separate from actual money settlement or voucher issuance'],
      source_ids: ['emag-help-return-refund-service'],
      notes: 'eMAG describes inspection after receipt and refund/voucher only after approval. This is stronger return evidence but still not final settled refund.',
    },
    {
      source_event: 'merchant/platform refund initiated after approved return',
      event_candidate: 'REFUNDED',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_MARK_REFUNDED'],
      requirements: ['final BuyFlow REFUNDED requires stronger payment-provider/bank settlement evidence when available'],
      source_ids: ['emag-help-return-refund-service', 'emag-marketplace-card'],
      notes: 'Official eMAG flows describe refund or voucher after return approval. Merchant/platform refund evidence should not override direct payment-provider settlement state.',
    },
    {
      source_event: 'warranty/service request started',
      event_candidate: 'WARRANTY',
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
      requirements: ['exact product/Purchase link', 'distinguish warranty document from active service case'],
      source_ids: ['emag-help-return-refund-service'],
      notes: 'Invoice and warranty ticket can exist as downloadable documents even when no warranty case is active. A service form/process is separate from mere document availability.',
    },
    {
      source_event: 'online card payment failed before valid Marketplace order registration',
      event_candidate: 'PAYMENT_FAILED',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK'],
      requirements: ['direct customer/provider payment evidence; seller-side absence of an order is not enough to identify a Purchase'],
      source_ids: ['emag-marketplace-card'],
      notes: 'Marketplace documentation says unsuccessful online-card transactions are not registered in the seller account. Payment failure alone must never fabricate a Purchase identity.',
    },
  ] satisfies EmagHuResearchEvent[],
  hard_negative_families: [
    'eMAG marketing/newsletter/promotions',
    'password/account emails',
    'Marketplace seller product activation/inactivation notifications',
    'seller stock or account-health notifications',
    'review/rating requests without lifecycle evidence',
  ],
  notes: [
    'No stable official customer-email subject/sender fingerprint set was found in the first research pass; V1 therefore has no executable raw-email parser.',
    'eMAG Marketplace may involve eMAG itself or independent Marketplace partners; preserve seller identity instead of treating every eMAG-platform order as sold by eMAG.',
    'One order can have multiple parcels/AWBs. Shipment identity is one-to-many from Purchase, never one AWB chosen arbitrarily.',
    'Seller-side Befejezett is an operational Marketplace status and can follow AWB generation. Never translate it directly to BuyFlow DELIVERED.',
    'Customer account availability of invoice/warranty documents is document evidence, not proof that an email attachment is an invoice or that a warranty claim exists.',
  ],
};
