import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGmailPubSubEnvelope } from './gmail-push-notification.js';

function data(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

test('parses Gmail Pub/Sub wake-up notification without treating it as email evidence', () => {
  const result = parseGmailPubSubEnvelope({
    message: {
      data: data({ emailAddress: 'Buyer@Example.com', historyId: '123456' }),
      messageId: 'pubsub-1',
      publishTime: '2026-08-30T22:00:00Z',
    },
  });

  assert.deepEqual(result, {
    emailAddress: 'buyer@example.com',
    historyId: '123456',
    messageId: 'pubsub-1',
    publishTime: '2026-08-30T22:00:00.000Z',
  });
});

test('rejects malformed Gmail Pub/Sub history identity', () => {
  assert.throws(() => parseGmailPubSubEnvelope({
    message: { data: data({ emailAddress: 'buyer@example.com', historyId: '12x' }) },
  }), /emailAddress\/historyId/);
});

test('rejects oversized Gmail Pub/Sub decoded payload', () => {
  assert.throws(() => parseGmailPubSubEnvelope({
    message: {
      data: Buffer.from(JSON.stringify({
        emailAddress: 'buyer@example.com',
        historyId: '123',
        padding: 'x'.repeat(20_000),
      })).toString('base64'),
    },
  }), /too large/);
});
