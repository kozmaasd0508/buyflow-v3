import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { normalizeMailgunInbound, verifyMailgunSignature } from './mailgun-inbound.js';

test('verifyMailgunSignature accepts a valid HMAC signature', () => {
  const signingKey = 'test-signing-key';
  const timestamp = '1770000000';
  const token = 'abc123token';
  const signature = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');

  assert.equal(verifyMailgunSignature({ timestamp, token, signature }, signingKey), true);
  assert.equal(verifyMailgunSignature({ timestamp, token, signature: `${signature.slice(0, -1)}0` }, signingKey), false);
});

test('normalizeMailgunInbound maps Mailgun fields into a normalized shadow email', () => {
  const result = normalizeMailgunInbound({
    recipient: 'BF-AbC123@buyflow.hu',
    sender: 'orders@example.com',
    from: 'Example Shop <orders@example.com>',
    subject: 'Order confirmed',
    timestamp: '1770000000',
    'stripped-text': 'Your order is confirmed.',
    'body-html': '<p>Your order is confirmed.</p>',
    'message-headers': JSON.stringify([
      ['Message-Id', '<order-123@example.com>'],
      ['X-Test', 'yes'],
    ]),
  });

  assert.equal(result.recipient, 'bf-abc123@buyflow.hu');
  assert.equal(result.normalizedEmail.provider, 'mailgun');
  assert.equal(result.normalizedEmail.providerMessageId, '<order-123@example.com>');
  assert.equal(result.normalizedEmail.from[0]?.email, 'orders@example.com');
  assert.equal(result.normalizedEmail.from[0]?.name, 'Example Shop');
  assert.equal(result.normalizedEmail.to[0]?.email, 'bf-abc123@buyflow.hu');
  assert.equal(result.normalizedEmail.snippet, 'Your order is confirmed.');
  assert.equal(result.normalizedEmail.bodyHtml, '<p>Your order is confirmed.</p>');
  assert.deepEqual(result.normalizedEmail.folders, ['inbound', 'mailgun-shadow']);
});

test('normalizeMailgunInbound rejects payloads without recipient or sender', () => {
  assert.throws(() => normalizeMailgunInbound({ sender: 'orders@example.com' }), /recipient/);
  assert.throws(() => normalizeMailgunInbound({ recipient: 'bf-test@buyflow.hu' }), /sender/);
});
