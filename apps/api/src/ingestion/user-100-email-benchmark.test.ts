import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicCommerceEmail } from './deterministic-commerce-parser.js';
import { parseDeterministicLifecycleEmail } from './deterministic-lifecycle-parser.js';
import { fixtures1 } from './user100-fixtures-1.js';
import { fixtures2 } from './user100-fixtures-2.js';
import { fixtures3 } from './user100-fixtures-3.js';
import { fixtures4 } from './user100-fixtures-4.js';

type RawFixture = readonly [
  emailId: string,
  threadId: string,
  senderEmail: string,
  subject: string,
  expectedLabel: string,
  purchaseRelated: boolean,
  orderId: string | null,
  trackingId: string | null,
  bodyText: string,
];

type Observation = {
  emailId: string;
  threadId: string;
  expectedLabel: string;
  purchaseRelated: boolean;
  recognized: boolean;
  route: 'lifecycle' | 'commerce' | null;
  eventType: string | null;
  lifecycleEvent: string | null;
  shipmentPhase: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
};

const fixtures = [...fixtures1, ...fixtures2, ...fixtures3, ...fixtures4] as unknown as RawFixture[];

// The workbook deliberately uses reserved *.example carrier domains. Normalize only inside this
// test to already-trusted BuyFlow carrier identities so the benchmark measures semantics instead
// of failing merely because .example can never be a production-trusted sender.
function benchmarkSender(email: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/@gls-demo\.example$/i, '@gls-hungary.com'],
    [/@express-one-demo\.example$/i, '@expressone.hu'],
    [/@dpd-demo\.example$/i, '@dpd.com'],
    [/@dhl-demo\.example$/i, '@dhl.com'],
    [/@packeta-demo\.example$/i, '@packeta.com'],
    [/@mpl-demo\.example$/i, '@posta.hu'],
    [/@foxpost-demo\.example$/i, '@foxpost.hu'],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(email)) return email.replace(pattern, replacement);
  }
  return email;
}

function senderDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();
}

function observe(fixture: RawFixture): Observation {
  const [emailId, threadId, rawSender, subject, expectedLabel, purchaseRelated, , , bodyText] = fixture;
  const senderEmail = benchmarkSender(rawSender);
  const domain = senderDomain(senderEmail);

  const lifecycle = parseDeterministicLifecycleEmail({
    senderDomains: [domain],
    senderEmails: [senderEmail],
    subject,
    bodyText,
  });
  if (lifecycle) {
    return {
      emailId, threadId, expectedLabel, purchaseRelated, recognized: true, route: 'lifecycle',
      eventType: lifecycle.extraction.event_type,
      lifecycleEvent: lifecycle.lifecycleEvent,
      shipmentPhase: lifecycle.shipmentPhase ?? null,
      orderNumber: lifecycle.extraction.order_number,
      trackingNumber: lifecycle.extraction.tracking_number,
    };
  }

  const commerce = parseDeterministicCommerceEmail({
    senderDomains: [domain],
    subject,
    bodyText,
  });
  if (commerce) {
    return {
      emailId, threadId, expectedLabel, purchaseRelated, recognized: true, route: 'commerce',
      eventType: commerce.extraction.event_type,
      lifecycleEvent: null,
      shipmentPhase: commerce.shipmentPhase ?? null,
      orderNumber: commerce.extraction.order_number,
      trackingNumber: commerce.extraction.tracking_number,
    };
  }

  return {
    emailId, threadId, expectedLabel, purchaseRelated, recognized: false, route: null,
    eventType: null, lifecycleEvent: null, shipmentPhase: null, orderNumber: null, trackingNumber: null,
  };
}

function exactSemantic(row: Observation): boolean {
  switch (row.expectedLabel) {
    case 'ORDER_CREATED': return row.eventType === 'order_created';
    case 'PAYMENT_SUCCESS': return row.eventType === 'payment_completed';
    case 'PAYMENT_FAILED': return row.lifecycleEvent === 'payment_failed';
    case 'ORDER_PROCESSING': return row.lifecycleEvent === 'order_processing';
    case 'ORDER_PACKING': return row.lifecycleEvent === 'order_packing';
    case 'SHIPMENT_CREATED': return row.shipmentPhase === 'shipment_created';
    case 'SHIPPED': return row.shipmentPhase === 'shipped';
    case 'IN_TRANSIT': return row.shipmentPhase === 'in_transit';
    case 'OUT_FOR_DELIVERY': return row.shipmentPhase === 'out_for_delivery';
    case 'READY_FOR_PICKUP': return row.shipmentPhase === 'ready_for_pickup';
    case 'DELIVERED': return row.eventType === 'delivery' || row.shipmentPhase === 'delivered';
    case 'DELAYED': return row.lifecycleEvent === 'delayed';
    case 'CANCELLED': return row.lifecycleEvent === 'cancelled';
    case 'INVOICE': return row.eventType === 'invoice_or_receipt';
    case 'OTHER': return !row.recognized;
    default: return false;
  }
}

function normalizedIdentity(value: string | null): string {
  return (value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

test('user supplied 100-email mailbox benchmark stays safe and reports real coverage', () => {
  assert.equal(fixtures.length, 100, 'workbook benchmark must contain exactly 100 emails');
  const observations = fixtures.map(observe);

  const noiseRecognized: string[] = [];
  const wrongIdentity: string[] = [];
  const unsafeLifecyclePromotion: string[] = [];
  const preAdviceWithoutPhase: string[] = [];

  observations.forEach((row, index) => {
    const fixture = fixtures[index]!;
    const expectedOrder = normalizedIdentity(fixture[6]);
    const expectedTracking = normalizedIdentity(fixture[7]);
    const actualOrder = normalizedIdentity(row.orderNumber);
    const actualTracking = normalizedIdentity(row.trackingNumber);

    if (!row.purchaseRelated && row.recognized) noiseRecognized.push(row.emailId);
    if (actualOrder && expectedOrder && actualOrder !== expectedOrder) wrongIdentity.push(`${row.emailId}:order`);
    if (actualTracking && expectedTracking && actualTracking !== expectedTracking) wrongIdentity.push(`${row.emailId}:tracking`);
    if (row.expectedLabel !== 'ORDER_CREATED' && row.eventType === 'order_created') unsafeLifecyclePromotion.push(row.emailId);
    if (row.expectedLabel !== 'DELIVERED' && row.eventType === 'delivery') unsafeLifecyclePromotion.push(`${row.emailId}:delivery`);
    if (row.expectedLabel === 'SHIPMENT_CREATED' && row.recognized && row.shipmentPhase !== 'shipment_created') {
      preAdviceWithoutPhase.push(row.emailId);
    }
  });

  const labels = [...new Set(observations.map((row) => row.expectedLabel))].sort();
  const byLabel = Object.fromEntries(labels.map((label) => {
    const rows = observations.filter((row) => row.expectedLabel === label);
    return [label, {
      total: rows.length,
      recognized: rows.filter((row) => row.recognized).length,
      exact: rows.filter(exactSemantic).length,
    }];
  }));

  const threads = [...new Set(observations.filter((row) => row.purchaseRelated).map((row) => row.threadId))].sort();
  const byThread = Object.fromEntries(threads.map((threadId) => {
    const rows = observations.filter((row) => row.threadId === threadId);
    return [threadId, {
      total: rows.length,
      recognized: rows.filter((row) => row.recognized).length,
      exact: rows.filter(exactSemantic).length,
      finalExpectedLabel: rows.at(-1)?.expectedLabel ?? null,
    }];
  }));

  const gaps = observations
    .filter((row) => row.purchaseRelated && !exactSemantic(row))
    .map((row) => ({
      id: row.emailId,
      thread: row.threadId,
      expected: row.expectedLabel,
      recognized: row.recognized,
      eventType: row.eventType,
      lifecycleEvent: row.lifecycleEvent,
      shipmentPhase: row.shipmentPhase,
      orderNumber: row.orderNumber,
      trackingNumber: row.trackingNumber,
    }));

  const report = {
    fixtures: observations.length,
    purchaseRelated: observations.filter((row) => row.purchaseRelated).length,
    noise: observations.filter((row) => !row.purchaseRelated).length,
    recognized: observations.filter((row) => row.recognized).length,
    exactSemanticMatches: observations.filter(exactSemantic).length,
    noiseRecognized,
    wrongIdentity,
    unsafeLifecyclePromotion,
    preAdviceWithoutPhase,
    byLabel,
    byThread,
    gaps,
  };
  console.log(`USER_100_EMAIL_BENCHMARK ${JSON.stringify(report)}`);

  assert.deepEqual(noiseRecognized, [], 'noise/hard-negative emails must not enter deterministic commerce/lifecycle parsing');
  assert.deepEqual(wrongIdentity, [], 'recognized evidence must never invent or cross-link a different order/tracking identity');
  assert.deepEqual(unsafeLifecyclePromotion, [], 'post-purchase lifecycle evidence must never become a new Purchase or false delivered state');
  assert.deepEqual(preAdviceWithoutPhase, [], 'recognized shipment pre-advice must be explicitly shipment_created, never implicit physical progress');
});
