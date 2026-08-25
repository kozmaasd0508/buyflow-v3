import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import type { NormalizedEmail } from '../email/types.js';
import { universalEventTypeExtractor } from './event-type-extractor.js';

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

test('cancellation disclaimer saying it does not state a refund was issued is not refund evidence', () => {
  const values = events(
    'Order EX-10001 cancelled',
    'Your order has been cancelled. This cancellation notice does not state that a refund was issued.',
  );
  assert.ok(values.includes('cancellation'));
  assert.ok(!values.includes('refund'));
});

test('explicit no-refund completion statements are not refund evidence', () => {
  assert.ok(!events('', 'No refund has been issued for this order.').includes('refund'));
  assert.ok(!events('', 'The refund has not been completed yet.').includes('refund'));
  assert.ok(!events('', 'The refund was not processed.').includes('refund'));
});

test('Hungarian explicit refund negation is not completed refund evidence', () => {
  assert.ok(!events('', 'Nem történt visszatérítés ehhez a rendeléshez.').includes('refund'));
  assert.ok(!events('', 'A visszatérítés nem történt meg.').includes('refund'));
});

test('real completed refund wording remains positive evidence', () => {
  assert.ok(events('', 'The refund for your order was successfully issued.').includes('refund'));
  assert.ok(events('', 'We have refunded your payment.').includes('refund'));
});

test('a negated clause does not hide a later independent completed refund sentence', () => {
  const values = events(
    '',
    'The earlier notice does not state that a refund was issued. Later update: refund issued successfully.',
  );
  assert.ok(values.includes('refund'));
});
