import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNylasMessage } from './nylas-provider.js';

test('normalizes a Nylas message into the provider-neutral email contract', () => {
  const email = normalizeNylasMessage({
    id: 'msg_123',
    date: 1_700_000_000,
    threadId: 'thread_123',
    subject: 'Your order has shipped',
    from: [{ email: 'shop@example.com', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.com' }],
    snippet: 'Tracking number: ABC123',
    body: '<p>Tracking number: ABC123</p>',
    attachments: [
      {
        id: 'att_1',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 1234,
      },
    ],
  });

  assert.equal(email.provider, 'nylas');
  assert.equal(email.providerMessageId, 'msg_123');
  assert.equal(email.providerThreadId, 'thread_123');
  assert.equal(email.from[0]?.email, 'shop@example.com');
  assert.equal(email.attachments[0]?.filename, 'invoice.pdf');
  assert.equal(email.receivedAt, '2023-11-14T22:13:20.000Z');
});
