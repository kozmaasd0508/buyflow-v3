import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGenericLifecycleValidatedEnvelope } from './generic-lifecycle-preprocessor.js';

test('multi-observation validated envelope is JSON serializable and non-circular', () => {
  const observations: Array<Record<string, unknown>> = [
    { event_type: 'invoice_or_receipt', validation_status: 'review', parser_version: 'generic-lifecycle-v1.3' },
    { event_type: 'shipment', shipment_phase: 'shipped', validation_status: 'review', parser_version: 'generic-lifecycle-v1.3' },
  ];
  const envelope = buildGenericLifecycleValidatedEnvelope(observations);
  assert.notEqual(envelope, observations[0]);
  assert.equal(envelope.generic_lifecycle_observation_count, 2);
  assert.equal(envelope.generic_lifecycle_multi_observation, true);
  assert.equal(envelope.generic_lifecycle_observations, observations);
  assert.doesNotThrow(() => JSON.stringify(envelope));
});

test('single-observation validated envelope remains JSON serializable', () => {
  const observations: Array<Record<string, unknown>> = [{
    event_type: 'shipment',
    validation_status: 'review',
    parser_version: 'generic-lifecycle-v1.3',
  }];
  const envelope = buildGenericLifecycleValidatedEnvelope(observations);
  assert.equal(envelope.generic_lifecycle_observation_count, 1);
  assert.equal(envelope.generic_lifecycle_multi_observation, false);
  assert.doesNotThrow(() => JSON.stringify(envelope));
});

test('validated envelope rejects an impossible empty observation set', () => {
  assert.throws(() => buildGenericLifecycleValidatedEnvelope([]), /requires at least one observation/);
});
