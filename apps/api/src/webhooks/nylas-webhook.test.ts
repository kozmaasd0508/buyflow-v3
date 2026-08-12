import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { parseNylasMessageCreatedEvent, verifyNylasSignature } from './nylas-webhook.js';

test('verifies the exact raw body HMAC', () => {
  const raw = Buffer.from('{"type":"message.created"}');
  const secret = 'test-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyNylasSignature(raw, signature, secret), true);
  assert.equal(verifyNylasSignature(Buffer.from('{ "type":"message.created" }'), signature, secret), false);
});

test('parses standard and truncated message.created variants', () => {
  for (const type of ['message.created', 'message.created.truncated', 'message.created.cleaned'] as const) {
    const raw = Buffer.from(JSON.stringify({
      type,
      data: { object: { id: 'msg_1', grant_id: 'grant_1' } },
    }));
    assert.deepEqual(parseNylasMessageCreatedEvent(raw), {
      type,
      grantId: 'grant_1',
      messageId: 'msg_1',
    });
  }
});

test('rejects unrelated webhook events and malformed payloads', () => {
  assert.equal(parseNylasMessageCreatedEvent(Buffer.from('{bad json')), null);
  assert.equal(
    parseNylasMessageCreatedEvent(Buffer.from(JSON.stringify({ type: 'message.updated', data: { object: {} } }))),
    null,
  );
});
