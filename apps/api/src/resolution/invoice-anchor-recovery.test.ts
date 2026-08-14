import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveInvoiceAnchorRecoveryPlans,
  type InvoiceAnchorEvidence,
  type InvoiceAnchorExistingPurchase,
} from './invoice-anchor-recovery.js';

const userId = 'user-1';
const emailConnectionId = 'connection-1';

function evidence(overrides: Partial<InvoiceAnchorEvidence> = {}): InvoiceAnchorEvidence {
  return {
    sourceEmailId: 'invoice-1',
    userId,
    emailConnectionId,
    senderDomain: 'service.gymbeam.hu',
    processingStatus: 'review',
    validationStatus: 'validated',
    eventType: 'invoice_or_receipt',
    merchant: 'GymBeam',
    orderNumber: '3010228912',
    invoiceNumber: '4008874007',
    paymentStatus: 'paid',
    confidence: 0.67,
    receivedAt: '2026-07-16T17:46:26.000Z',
    ...overrides,
  };
}

function purchase(overrides: Partial<InvoiceAnchorExistingPurchase> = {}): InvoiceAnchorExistingPurchase {
  return {
    userId,
    merchantDomain: 'service.gymbeam.hu',
    orderNumber: '3010228912',
    ...overrides,
  };
}

test('validated invoice plus same-order merchant shipment schedules a 90-day anchor search', () => {
  const plans = resolveInvoiceAnchorRecoveryPlans([
    evidence(),
    evidence({
      sourceEmailId: 'shipment-1',
      processingStatus: 'unlinked',
      validationStatus: 'validated',
      eventType: 'shipment',
      invoiceNumber: null,
      trackingNumber: undefined as never,
      confidence: 0.86,
      receivedAt: '2026-07-15T06:55:18.000Z',
    }),
  ]);

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.searchTerm, '3010228912');
  assert.equal(plans[0]?.windowDays, 90);
  assert.ok(plans[0]?.reasons.includes('same_order_merchant_shipment_support'));
});

test('same-order merchant delivery can corroborate an older invoice chain', () => {
  const plans = resolveInvoiceAnchorRecoveryPlans([
    evidence({ orderNumber: '3010206178', invoiceNumber: '4008874475', confidence: 0.78 }),
    evidence({
      sourceEmailId: 'delivery-1',
      orderNumber: '3010206178',
      invoiceNumber: null,
      eventType: 'delivery',
      confidence: 0.78,
      receivedAt: '2026-07-16T05:12:18.000Z',
    }),
  ]);

  assert.equal(plans.length, 1);
  assert.ok(plans[0]?.reasons.includes('same_order_merchant_delivery_support'));
});

test('invoice alone never schedules an anchor search', () => {
  assert.deepEqual(resolveInvoiceAnchorRecoveryPlans([evidence()]), []);
});

test('utility reminder plus other event does not count as commerce lifecycle corroboration', () => {
  assert.deepEqual(resolveInvoiceAnchorRecoveryPlans([
    evidence({
      senderDomain: 'mvmee.hu',
      merchant: 'MVM Next Energiakereskedelmi Zrt.',
      orderNumber: '2605410045',
      invoiceNumber: null,
      confidence: 0.58,
    }),
    evidence({
      sourceEmailId: 'mvm-other',
      senderDomain: 'mvmee.hu',
      merchant: 'MVM Next Energiakereskedelmi Zrt.',
      orderNumber: '2605410045',
      invoiceNumber: null,
      eventType: 'other',
      confidence: 0.74,
    }),
  ]), []);
});

test('existing exact purchase identity blocks unnecessary historical recovery', () => {
  const rows = [
    evidence(),
    evidence({
      sourceEmailId: 'shipment-1',
      eventType: 'shipment',
      invoiceNumber: null,
      confidence: 0.9,
    }),
  ];
  assert.deepEqual(resolveInvoiceAnchorRecoveryPlans(rows, [purchase()]), []);
});

test('failed payment is identity evidence but not sufficient lifecycle support for invoice recovery', () => {
  assert.deepEqual(resolveInvoiceAnchorRecoveryPlans([
    evidence(),
    evidence({
      sourceEmailId: 'failed-payment',
      eventType: 'payment_completed',
      invoiceNumber: null,
      paymentStatus: 'failed',
      confidence: 0.9,
    }),
  ]), []);
});

test('generic test invoice without a merchant cannot schedule recovery', () => {
  assert.deepEqual(resolveInvoiceAnchorRecoveryPlans([
    evidence({
      senderDomain: 'gmail.com',
      merchant: null,
      orderNumber: 'BF-TEST-002',
      invoiceNumber: 'INV-BF-TEST-002',
      confidence: 0.74,
    }),
    evidence({
      sourceEmailId: 'test-shipment',
      senderDomain: 'gmail.com',
      merchant: null,
      orderNumber: 'BF-TEST-002',
      invoiceNumber: null,
      eventType: 'shipment',
      confidence: 0.86,
    }),
  ]), []);
});

test('short order-like tokens are ignored', () => {
  assert.deepEqual(resolveInvoiceAnchorRecoveryPlans([
    evidence({ orderNumber: '6383', merchant: "McDonald's" }),
    evidence({
      sourceEmailId: 'short-support',
      orderNumber: '6383',
      merchant: "McDonald's",
      invoiceNumber: null,
      eventType: 'delivery',
      confidence: 0.9,
    }),
  ]), []);
});
