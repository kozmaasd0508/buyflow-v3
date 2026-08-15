import type { ProtocolEventCandidate, ProtocolProhibition, ProtocolSourceReference } from '../types.js';

export interface UnasResearchSignal {
  name: string;
  meaning: string;
  source_ids: string[];
}

export interface UnasResearchEvent {
  source_event: string;
  event_candidate: ProtocolEventCandidate;
  prohibitions: ProtocolProhibition[];
  requirements: string[];
  source_ids: string[];
  notes: string;
}

export const UNAS_RESEARCH_V1 = {
  protocol_id: 'commerce.unas',
  protocol_version: '1.0.0-research.1',
  display_name: 'UNAS',
  status: 'research' as const,
  executable_raw_email_profile: false,
  sources: [
    {
      id: 'unas-order-details',
      title: 'UNAS Megrendelés részletek',
      url: 'https://unas.hu/tudastar/admin/megrendeles-reszletek',
      provenance: 'official_documentation',
    },
    {
      id: 'unas-notifications',
      title: 'UNAS Értesítések',
      url: 'https://unas.hu/tudastar/admin/ertesitesek',
      provenance: 'official_documentation',
    },
    {
      id: 'unas-order-statuses',
      title: 'UNAS Megrendelés státuszok, típusok',
      url: 'https://unas.hu/tudastar/admin/megrendeles-statuszok-tipusok',
      provenance: 'official_documentation',
    },
    {
      id: 'unas-order-api',
      title: 'UNAS Megrendelések API adatszerkezet',
      url: 'https://unas.hu/tudastar/api/megrendelesek-adatszerkezet',
      provenance: 'official_documentation',
    },
    {
      id: 'unas-status-api',
      title: 'UNAS Megrendelés státuszok API adatszerkezet',
      url: 'https://unas.hu/tudastar/api/megrendeles-statuszok-adatszerkezet',
      provenance: 'official_documentation',
    },
    {
      id: 'unas-base-settings',
      title: 'UNAS Alapbeállítások - order notification and tracking settings',
      url: 'https://unas.hu/tudastar/admin/alapbeallitasok',
      provenance: 'official_documentation',
    },
  ] satisfies ProtocolSourceReference[],
  structural_signals: [
    { name: '[order_key]', meaning: 'order identifier', source_ids: ['unas-order-details', 'unas-notifications'] },
    { name: '[order_amount] / [order_total]', meaning: 'order total', source_ids: ['unas-order-details', 'unas-notifications'] },
    { name: '[order_status]', meaning: 'merchant-defined current order status', source_ids: ['unas-notifications'] },
    { name: '[url_track]', meaning: 'webshop order-tracking page URL', source_ids: ['unas-order-details'] },
    { name: '[url_payment]', meaning: 'direct payment/retry URL for the order', source_ids: ['unas-order-details'] },
    { name: '[order_package_number]', meaning: 'package/tracking number where supported', source_ids: ['unas-order-details', 'unas-base-settings'] },
    { name: '[order_products]', meaning: 'rendered order product block', source_ids: ['unas-notifications'] },
  ] satisfies UnasResearchSignal[],
  events: [
    {
      source_event: 'original order notification email',
      event_candidate: 'ORDER_CREATED',
      prohibitions: [],
      requirements: ['verified merchant identity', 'stable explicit order identifier'],
      source_ids: ['unas-order-api', 'unas-notifications'],
      notes: 'UNAS can send the original order notification to the customer/admin. Raw subject/body remain customizable, so the platform alone cannot prove this event from arbitrary text.',
    },
    {
      source_event: 'order status change notification',
      event_candidate: 'OTHER',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
      requirements: ['merchant-specific verified mapping from status id/name to BuyFlow lifecycle'],
      source_ids: ['unas-order-details', 'unas-order-statuses', 'unas-status-api'],
      notes: 'UNAS status names are merchant-configurable and only have broad status types. Never map a raw status name globally without merchant-specific verification.',
    },
    {
      source_event: 'failed / pending payment notification family',
      event_candidate: 'OTHER',
      prohibitions: ['DO_NOT_CREATE_PURCHASE'],
      requirements: ['explicit failed vs pending state in rendered email or direct payment-provider evidence'],
      source_ids: ['unas-notifications', 'unas-order-details'],
      notes: 'UNAS documents one notification family for failed/pending payment and bank feedback can update payment success/failure. The family name alone is too ambiguous to emit PAYMENT_FAILED or PAYMENT_ACTION_REQUIRED.',
    },
    {
      source_event: 'status email containing package number / tracking link',
      event_candidate: 'OTHER',
      prohibitions: ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_SET_SHIPPED_AT', 'DO_NOT_MARK_IN_TRANSIT', 'DO_NOT_MARK_DELIVERED'],
      requirements: ['exact package number', 'separate lifecycle evidence before physical-state promotion'],
      source_ids: ['unas-order-details', 'unas-base-settings'],
      notes: 'Package number/link is strong shipment identity evidence, but UNAS can include it in a status notification before physical carrier progress.',
    },
  ] satisfies UnasResearchEvent[],
  hard_negative_families: [
    'customer registration/data change',
    'customer deletion',
    'new password',
    'newsletter subscribe/unsubscribe',
    'stock notification',
    'price-drop notification',
    'manual/custom email using a newsletter template',
  ],
  notes: [
    'UNAS notification text and order statuses are highly customizable; there is no safe global subject dictionary.',
    'The most valuable platform-level evidence is structural: order key, amount, order status, payment URL, tracking URL and package number.',
    'Payment method types in the API include COD, card, transfer, BNPL and qvik variants, but an email parser must use only values actually rendered in the message.',
    'InvoiceStatus (including billed) is an admin/order state and must not be treated as proof of a specific fiscal PDF/document without document/provider evidence.',
  ],
};
