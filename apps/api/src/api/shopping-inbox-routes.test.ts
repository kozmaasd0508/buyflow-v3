import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInboxLimit } from './shopping-inbox-routes.js';

test('shopping inbox limit defaults safely', () => {
  assert.equal(normalizeInboxLimit(undefined), 50);
  assert.equal(normalizeInboxLimit('not-a-number'), 50);
});

test('shopping inbox limit is clamped', () => {
  assert.equal(normalizeInboxLimit('0'), 1);
  assert.equal(normalizeInboxLimit('25'), 25);
  assert.equal(normalizeInboxLimit('999'), 100);
});
