import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import type { NormalizedEmail } from '../email/types.js';
import { universalEventTypeExtractor } from './event-type-extractor.js';
import { universalPaymentStatusExtractor } from './payment-status-extractor.js';

function document(subject: string, body: string) {
  const email: NormalizedEmail = {
    provider: 'nylas',
    providerMessageId: 'refund-negation-safety',
    subject,
    from: [{ email: 'orders@example-shop.test', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.net', name: 'Buyer' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-25T21:30:00.000Z',
    snippet: body,
    headers: [],
    folders: ['inbox'],
    attachments: [],
  };
  return buildEmailDocumentV1(email);
}

function events(subject: string, body: string): string[] {
  return universalEventTypeExtractor.extract(document(subject, body))
    .filter((claim) => claim.field === 'event_type')
    .map((claim) => String(claim.value));
}

function paymentStatuses(subject: string, body: string): string[] {
  return universalPaymentStatusExtractor.extract(document(subject, body))
    .filter((claim) => claim.field === 'payment_status')
    .map((claim) => String(claim.value));
}

test('cancellation disclaimer saying it does not state a refund was issued is not refund evidence', () => {
  const subject = 'Order EX-10001 cancelled';
  const body = 'Your order has been cancelled. This cancellation notice does not state that a refund was issued.';
  const values = events(subject, body);
  assert.ok(values.includes('cancellation'));
  assert.ok(!values.includes('refund'));
  assert.ok(!paymentStatuses(subject, body).includes('refunded'));
});

test('explicit no-refund completion statements are not refund evidence', () => {
  for (const body of [
    'No refund has been issued for this order.',
    'The refund has not been completed yet.',
    'The refund was not processed.',
  ]) {
    assert.ok(!events('', body).includes('refund'));
    assert.ok(!paymentStatuses('', body).includes('refunded'));
  }
});

test('Hungarian explicit refund negation is not completed refund evidence', () => {
  for (const body of [
    'Nem történt visszatérítés ehhez a rendeléshez.',
    'A visszatérítés nem történt meg.',
  ]) {
    assert.ok(!events('', body).includes('refund'));
    assert.ok(!paymentStatuses('', body).includes('refunded'));
  }
});

test('real completed refund wording remains positive evidence', () => {
  for (const body of [
    'The refund for your order was successfully issued.',
    'We have refunded your payment.',
  ]) {
    assert.ok(events('', body).includes('refund'));
    assert.ok(paymentStatuses('', body).includes('refunded'));
  }
});

test('a negated clause does not hide a later independent completed refund sentence', () => {
  const body = 'The earlier notice does not state that a refund was issued. Later update: refund issued successfully.';
  assert.ok(events('', body).includes('refund'));
  assert.ok(paymentStatuses('', body).includes('refunded'));
});
