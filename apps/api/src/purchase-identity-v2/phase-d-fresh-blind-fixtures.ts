export type PhaseDBlindExpectation =
  | { kind: 'positive_new_purchase'; expectedOrderId: string }
  | { kind: 'positive_link'; expectedPurchaseId: string; expectedState?: 'open' | 'fulfilled' | 'cancelled' | 'returned' | 'refunded'; expectedShipmentStatus?: 'in_transit' | 'out_for_delivery' | 'delivered'; requireInvoice?: boolean; requirePayment?: boolean }
  | { kind: 'negative_no_auto_create' }
  | { kind: 'negative_no_auto_link'; forbiddenPurchaseIds: string[] }
  | { kind: 'negative_no_refund_promotion'; expectedPurchaseId: string };

export interface PhaseDBlindFixture {
  id: string;
  sourceBasis: 'ecwid' | 'squarespace' | 'stripe' | 'dpd';
  snapshotKey: 'empty' | 'northwind' | 'northwind-shipped' | 'northwind-payment' | 'blue-harbor' | 'ambiguous-northwind';
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  expectation: PhaseDBlindExpectation;
}

/**
 * Frozen before the first Phase D execution against Purchase Identity Graph v2.
 *
 * Source semantics were taken from current public product documentation, then
 * converted into synthetic privacy-safe messages. No user mailbox content,
 * merchant production identifiers, or parser-specific regexes are present.
 *
 * Public source basis:
 * - Ecwid customer notifications / order processing / refunds / cancellation:
 *   https://support.ecwid.com/hc/en-us/articles/360005623640-Customer-order-notifications
 *   https://support.ecwid.com/hc/en-us/articles/360000027540-Guide-to-processing-orders
 *   https://support.ecwid.com/hc/en-us/articles/115005863005-Marking-orders-as-refunded
 *   https://support.ecwid.com/hc/en-us/articles/115005862165-Canceling-orders
 * - Squarespace notification taxonomy, including refund-initiated vs refunded:
 *   https://support.squarespace.com/hc/en-us/articles/360049390031-Email-notifications-your-site-sends
 * - Stripe receipt/refund semantics:
 *   https://docs.stripe.com/receipts
 * - DPD Predict recipient-notification lifecycle:
 *   https://www.dpd.com/hu/en/receiving-parcels/
 */
export const PHASE_D_FRESH_BLIND_FIXTURES: PhaseDBlindFixture[] = [
  {
    id: 'ecwid-order-confirmed',
    sourceBasis: 'ecwid',
    snapshotKey: 'empty',
    senderName: 'Northwind Outfitters',
    senderEmail: 'orders@northwindoutfitters.com',
    subject: 'Order Confirmation #NW-78431',
    body: 'We have received your order. Thank you for your purchase. Order number: NW-78431. Order total: 64.90 EUR.',
    expectation: { kind: 'positive_new_purchase', expectedOrderId: 'NW-78431' },
  },
  {
    id: 'ecwid-order-shipped-with-tracking',
    sourceBasis: 'ecwid',
    snapshotKey: 'northwind',
    senderName: 'Northwind Outfitters',
    senderEmail: 'orders@northwindoutfitters.com',
    subject: 'Order NW-78431 has been shipped',
    body: 'Your order has been handed to the carrier and is on its way. Order number: NW-78431. Carrier: DPD. Tracking number: 16380124267777.',
    expectation: { kind: 'positive_link', expectedPurchaseId: 'p-northwind', expectedState: 'open', expectedShipmentStatus: 'in_transit' },
  },
  {
    id: 'dpd-out-for-delivery-by-tracking',
    sourceBasis: 'dpd',
    snapshotKey: 'northwind-shipped',
    senderName: 'DPD',
    senderEmail: 'notification@dpd.hu',
    subject: 'Your parcel is with the courier today',
    body: 'DPD has your parcel and the courier is delivering it today. Parcel number: 16380124267777.',
    expectation: { kind: 'positive_link', expectedPurchaseId: 'p-northwind', expectedState: 'open', expectedShipmentStatus: 'out_for_delivery' },
  },
  {
    id: 'dpd-delivered-by-tracking',
    sourceBasis: 'dpd',
    snapshotKey: 'northwind-shipped',
    senderName: 'DPD',
    senderEmail: 'notification@dpd.hu',
    subject: 'Parcel delivered successfully',
    body: 'Your parcel was successfully delivered. Parcel number: 16380124267777.',
    expectation: { kind: 'positive_link', expectedPurchaseId: 'p-northwind', expectedState: 'fulfilled', expectedShipmentStatus: 'delivered' },
  },
  {
    id: 'ecwid-order-refunded',
    sourceBasis: 'ecwid',
    snapshotKey: 'northwind',
    senderName: 'Northwind Outfitters',
    senderEmail: 'orders@northwindoutfitters.com',
    subject: 'Order NW-78431 refunded',
    body: 'The refund for your order has been issued. Order number: NW-78431. Refunded amount: 64.90 EUR.',
    expectation: { kind: 'positive_link', expectedPurchaseId: 'p-northwind', expectedState: 'refunded' },
  },
  {
    id: 'squarespace-refund-initiated-not-completed',
    sourceBasis: 'squarespace',
    snapshotKey: 'blue-harbor',
    senderName: 'Blue Harbor Market',
    senderEmail: 'orders@blueharbormarket.com',
    subject: 'Refund initiated for order BH-21980',
    body: 'A refund has been initiated for order BH-21980. The refund is still processing and has not completed yet.',
    expectation: { kind: 'negative_no_refund_promotion', expectedPurchaseId: 'p-blue-harbor' },
  },
  {
    id: 'ecwid-order-cancelled-without-refund-claim',
    sourceBasis: 'ecwid',
    snapshotKey: 'blue-harbor',
    senderName: 'Blue Harbor Market',
    senderEmail: 'orders@blueharbormarket.com',
    subject: 'Order BH-21980 cancelled',
    body: 'Your order has been cancelled. Order number: BH-21980. This cancellation notice does not state that a refund was issued.',
    expectation: { kind: 'positive_link', expectedPurchaseId: 'p-blue-harbor', expectedState: 'cancelled' },
  },
  {
    id: 'squarespace-shared-sender-order-confirmed',
    sourceBasis: 'squarespace',
    snapshotKey: 'empty',
    senderName: 'Blue Harbor Market',
    senderEmail: 'no-reply@squarespace.info',
    subject: 'Order confirmed BH-99001',
    body: 'Order confirmed. Order number: BH-99001. Order total: 39.00 EUR.',
    expectation: { kind: 'negative_no_auto_create' },
  },
  {
    id: 'merchant-invoice-exact-order',
    sourceBasis: 'squarespace',
    snapshotKey: 'northwind',
    senderName: 'Northwind Outfitters',
    senderEmail: 'billing@northwindoutfitters.com',
    subject: 'Invoice INV-2026-8841 for order NW-78431',
    body: 'Invoice number: INV-2026-8841. Order number: NW-78431. Amount due: 64.90 EUR. This invoice was issued for your completed purchase.',
    expectation: { kind: 'positive_link', expectedPurchaseId: 'p-northwind', expectedState: 'open', requireInvoice: true },
  },
  {
    id: 'merchant-payment-success-exact-order',
    sourceBasis: 'squarespace',
    snapshotKey: 'northwind',
    senderName: 'Northwind Outfitters',
    senderEmail: 'payments@northwindoutfitters.com',
    subject: 'Payment successful for order NW-78431',
    body: 'Payment received successfully. Order number: NW-78431. Payment reference: PAY-55001. Amount paid: 64.90 EUR.',
    expectation: { kind: 'positive_link', expectedPurchaseId: 'p-northwind', expectedState: 'open', requirePayment: true },
  },
  {
    id: 'stripe-provider-reference-alone',
    sourceBasis: 'stripe',
    snapshotKey: 'northwind-payment',
    senderName: 'Stripe',
    senderEmail: 'receipts@stripe.com',
    subject: 'Refund receipt',
    body: 'A refund was issued. Receipt number: RCPT-55001. Payment reference: PAY-55001. Refunded amount: 64.90 EUR.',
    expectation: { kind: 'negative_no_auto_link', forbiddenPurchaseIds: ['p-northwind'] },
  },
  {
    id: 'cross-merchant-same-order-id',
    sourceBasis: 'ecwid',
    snapshotKey: 'northwind',
    senderName: 'Other Trail Shop',
    senderEmail: 'orders@othertrailshop.com',
    subject: 'Order NW-78431 has been shipped',
    body: 'Your order has been shipped. Order number: NW-78431. Tracking number: 998877665544. Carrier: DHL.',
    expectation: { kind: 'negative_no_auto_link', forbiddenPurchaseIds: ['p-northwind'] },
  },
  {
    id: 'ambiguous-duplicate-order-id',
    sourceBasis: 'ecwid',
    snapshotKey: 'ambiguous-northwind',
    senderName: 'Northwind Outfitters',
    senderEmail: 'orders@northwindoutfitters.com',
    subject: 'Order NW-78431 has been shipped',
    body: 'Your order has been shipped. Order number: NW-78431. Tracking number: 112233445566. Carrier: DHL.',
    expectation: { kind: 'negative_no_auto_link', forbiddenPurchaseIds: ['p-northwind-a', 'p-northwind-b'] },
  },
  {
    id: 'invoice-provider-order-id-without-merchant-namespace',
    sourceBasis: 'squarespace',
    snapshotKey: 'northwind',
    senderName: 'Document Delivery Service',
    senderEmail: 'documents@billing-documents.com',
    subject: 'Invoice INV-90077',
    body: 'Invoice number: INV-90077. Order number: NW-78431. Invoice total: 64.90 EUR.',
    expectation: { kind: 'negative_no_auto_link', forbiddenPurchaseIds: ['p-northwind'] },
  },
];
