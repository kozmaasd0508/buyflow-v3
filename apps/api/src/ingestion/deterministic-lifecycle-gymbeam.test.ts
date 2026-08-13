import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicLifecycleEmail } from './deterministic-lifecycle-parser.js';

test('parses GymBeam delayed order', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Ellenőrizzük a kézbesítést',
    bodyText: 'A(z) 3010206178 rendelése késik',
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'delayed');
  assert.equal(result.extraction.order_number, '3010206178');
});
