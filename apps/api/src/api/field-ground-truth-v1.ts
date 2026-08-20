export type GroundTruthExpectation<T> =
  | { state: 'value'; value: T }
  | { state: 'null' }
  | { state: 'not_asserted' };

export interface FieldGroundTruthV1 {
  gmailMessageId: string;
  eventType: GroundTruthExpectation<string>;
  merchant: GroundTruthExpectation<string>;
  orderNumber: GroundTruthExpectation<string>;
  total: GroundTruthExpectation<number>;
  currency: GroundTruthExpectation<string>;
  carrier: GroundTruthExpectation<string>;
  trackingNumber: GroundTruthExpectation<string>;
  paymentStatus: GroundTruthExpectation<string>;
  products: GroundTruthExpectation<Array<{ name: string; quantity?: number }>>;
}

const NA = { state: 'not_asserted' } as const;
const value = <T>(v: T): GroundTruthExpectation<T> => ({ state: 'value', value: v });

// Human-verifiable seed assertions from the frozen v7 commerce mailbox.
// Only fields explicit in the source email metadata/snippet are asserted here.
// Unknown fields remain not_asserted; the parser output is never used as ground truth.
export const FIELD_GROUND_TRUTH_V1: FieldGroundTruthV1[] = [
  {
    gmailMessageId: '1a0147c27afb03fd',
    eventType: value('invoice_or_receipt'), merchant: value('GymBeam'), orderNumber: value('3010410391'),
    total: NA, currency: NA, carrier: NA, trackingNumber: NA, paymentStatus: NA, products: NA,
  },
  {
    gmailMessageId: '19fd5e30cc6d1c62',
    eventType: value('delivery'), merchant: NA, orderNumber: NA, total: NA, currency: NA,
    carrier: value('DPD'), trackingNumber: value('16380143879559'), paymentStatus: NA, products: NA,
  },
  {
    gmailMessageId: '19fd0b855a0625a5',
    eventType: value('delivery'), merchant: NA, orderNumber: NA, total: NA, currency: NA,
    carrier: value('DPD'), trackingNumber: value('16380124260518'), paymentStatus: NA, products: NA,
  },
  {
    gmailMessageId: '19f5626e0d00c911',
    eventType: value('shipment'), merchant: NA, orderNumber: NA, total: NA, currency: NA,
    carrier: value('GLS'), trackingNumber: value('3408405568'), paymentStatus: NA, products: NA,
  },
  {
    gmailMessageId: '19f4bda27b2af75d',
    eventType: value('shipment'), merchant: NA, orderNumber: NA, total: NA, currency: NA,
    carrier: value('GLS'), trackingNumber: value('3408405568'), paymentStatus: NA, products: NA,
  },
  {
    gmailMessageId: '19eb289643bc98df',
    eventType: value('shipment'), merchant: value('Szidibox Karton Kft.'), orderNumber: NA, total: NA, currency: NA,
    carrier: value('Magyar Posta'), trackingNumber: value('PB9S650295555'), paymentStatus: NA, products: NA,
  },
  {
    gmailMessageId: '19eb1057f15ad770',
    eventType: value('shipment'), merchant: value('Get-It-Now Trade'), orderNumber: NA, total: NA, currency: NA,
    carrier: value('Express One'), trackingNumber: value('669695091305000013605231'), paymentStatus: NA, products: NA,
  },
  {
    gmailMessageId: '19e60613ce9b72f7',
    eventType: value('invoice_or_receipt'), merchant: value('Epic Games'), orderNumber: value('A2605251823125756'),
    total: NA, currency: NA, carrier: NA, trackingNumber: NA, paymentStatus: NA, products: NA,
  },
];

export const FIELD_GROUND_TRUTH_V1_META = {
  version: 'field-ground-truth-v1',
  source: 'frozen-v7-commerce-mailbox',
  parserOutputUsedAsTruth: false,
  assertionPolicy: 'explicit-source-evidence-only',
  unassertedFieldsAreIgnored: true,
} as const;
