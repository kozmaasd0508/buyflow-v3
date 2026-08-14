import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldIgnoreUnlinkedSource } from './unlinked-source-policy.js';

function validated(eventType: string, validationStatus: string = 'validated') {
  return {
    schema_version: 2,
    validation_status: validationStatus,
    event_type: eventType,
    confidence: 0.9,
  };
}

test('trusted other and subscription events are terminal noise when not linked', () => {
  assert.equal(shouldIgnoreUnlinkedSource({ validationStatus: 'validated', validatedResult: validated('other'), alreadyLinked: false }), true);
  assert.equal(shouldIgnoreUnlinkedSource({ validationStatus: 'guardrailed', validatedResult: validated('subscription', 'guardrailed'), alreadyLinked: false }), true);
});

test('actionable purchase lifecycle events stay eligible for unlinked recovery', () => {
  for (const eventType of ['order_updated', 'payment_completed', 'shipment', 'delivery', 'invoice_or_receipt', 'refund', 'return']) {
    assert.equal(shouldIgnoreUnlinkedSource({ validationStatus: 'validated', validatedResult: validated(eventType), alreadyLinked: false }), false, eventType);
  }
});

test('review or untrusted extraction is never silently ignored', () => {
  assert.equal(shouldIgnoreUnlinkedSource({ validationStatus: 'review', validatedResult: validated('other', 'review'), alreadyLinked: false }), false);
  assert.equal(shouldIgnoreUnlinkedSource({ validationStatus: null, validatedResult: null, alreadyLinked: false }), false);
});

test('already linked source is never converted to ignored even if classified other', () => {
  assert.equal(shouldIgnoreUnlinkedSource({ validationStatus: 'validated', validatedResult: validated('other'), alreadyLinked: true }), false);
});
