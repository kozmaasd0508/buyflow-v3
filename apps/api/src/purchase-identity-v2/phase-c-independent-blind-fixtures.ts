export type PhaseCBlindExpected =
  | { kind: 'relation'; relation: 'split_child' | 'replacement'; parent: string; child: string }
  | { kind: 'none' }
  | { kind: 'conflict' };

export interface PhaseCIndependentBlindFixture {
  id: string;
  source: string;
  rationale: string;
  currentOrderId: string;
  subject: string;
  body: string;
  expected: PhaseCBlindExpected;
}

/**
 * Frozen before scoring against the Phase C extractor.
 * Wording is deliberately paraphrased from independent public documentation,
 * not copied from BuyFlow parser rules or existing tests.
 */
export const PHASE_C_INDEPENDENT_BLIND_FIXTURES: PhaseCIndependentBlindFixture[] = [
  {
    id: 'woo-original-then-split',
    source: 'https://woocommerce.com/document/split-orders/',
    rationale: 'WooCommerce documents customer split-order emails and persistent linkage back to the original order.',
    currentOrderId: '4103',
    subject: 'Your order has been split',
    body: 'Original order: #4102\nSplit order: #4103\nThis new order contains the items moved out of the original order.',
    expected: { kind: 'relation', relation: 'split_child', parent: '4102', child: '4103' },
  },
  {
    id: 'woo-split-created-from-original',
    source: 'https://woocommerce.com/document/split-copy-merge-order-actions/',
    rationale: 'WooCommerce documents a new split order as originating from the original order.',
    currentOrderId: '5103',
    subject: 'Split order #5103',
    body: 'Split order #5103 was created from original order #5102. The remaining items stay on the original order.',
    expected: { kind: 'relation', relation: 'split_child', parent: '5102', child: '5103' },
  },
  {
    id: 'aftership-replacement-original-labels',
    source: 'https://support.aftership.com/en/returns/articles/15390377-warranty-tags-and-notes',
    rationale: 'AfterShip documents replacement orders carrying the original order number as explicit metadata.',
    currentOrderId: '6202',
    subject: 'Replacement order #6202',
    body: 'Replacement order: #6202\nOriginal order: #6201\nThe replacement was created for the warranty request.',
    expected: { kind: 'relation', relation: 'replacement', parent: '6201', child: '6202' },
  },
  {
    id: 'aftership-replacement-for-original',
    source: 'https://support.aftership.com/en/returns/articles/15390377-warranty-tags-and-notes',
    rationale: 'Independent replacement-order semantics with an explicit original-order reference.',
    currentOrderId: '7202',
    subject: 'Replacement order #7202',
    body: 'Replacement order #7202 for original order #7201 has been created.',
    expected: { kind: 'relation', relation: 'replacement', parent: '7201', child: '7202' },
  },
  {
    id: 'partial-shipment-no-child-order',
    source: 'https://www.lettersandtemplates.com/letters/pdf/shipping-confirmation-email-sample/5/partial-order-shipment-notification.pdf',
    rationale: 'A partial shipment can be multiple parcels under one order and must not invent a child order relation.',
    currentOrderId: '8301',
    subject: 'Partial shipment update - Order #8301',
    body: 'Part of order #8301 has shipped. The remaining items will ship separately later. Tracking number: TRACK8301A.',
    expected: { kind: 'none' },
  },
  {
    id: 'similar-order-numbers-no-explicit-relation',
    source: 'https://woocommerce.com/document/split-orders/',
    rationale: 'Similarity alone is not documented proof of a parent/child relation and must remain non-linking.',
    currentOrderId: '9102',
    subject: 'Order #9102 update',
    body: 'Order #9101 was completed yesterday. Order #9102 is being processed today.',
    expected: { kind: 'none' },
  },
  {
    id: 'two-explicit-parents-conflict',
    source: 'https://woocommerce.com/document/split-orders/',
    rationale: 'If two explicit originals are presented for the same child, automatic linking must fail closed.',
    currentOrderId: '9902',
    subject: 'Split order #9902',
    body: 'Original order: #9901\nSplit order: #9902\nOriginal order: #9899\nSplit order: #9902',
    expected: { kind: 'conflict' },
  },
];
