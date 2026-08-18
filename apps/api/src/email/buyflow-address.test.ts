import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBuyFlowEmailAddress,
  generateBuyFlowEmailAddress,
  normalizeBuyFlowEmailAddress,
} from './buyflow-address.js';

test('builds a normalized BuyFlow shopping address', () => {
  assert.equal(
    buildBuyFlowEmailAddress('BF-0123456789ABCDEF'),
    'bf-0123456789abcdef@buyflow.hu',
  );
});

test('generates a non-user-derived opaque BuyFlow address', () => {
  const generated = generateBuyFlowEmailAddress(
    'buyflow.hu',
    () => Buffer.from('0123456789abcdef', 'hex'),
  );

  assert.equal(generated, 'bf-0123456789abcdef@buyflow.hu');
});

test('normalizes valid addresses and rejects other domains or malformed aliases', () => {
  assert.equal(
    normalizeBuyFlowEmailAddress(' BF-0123456789ABCDEF@BUYFLOW.HU '),
    'bf-0123456789abcdef@buyflow.hu',
  );
  assert.equal(
    normalizeBuyFlowEmailAddress('bf-0123456789abcdef@example.com'),
    null,
  );
  assert.equal(
    normalizeBuyFlowEmailAddress('short@buyflow.hu'),
    null,
  );
});

test('supports an explicitly configured BuyFlow email domain', () => {
  assert.equal(
    buildBuyFlowEmailAddress('bf-fedcba9876543210', '@mail.buyflow.hu'),
    'bf-fedcba9876543210@mail.buyflow.hu',
  );
});
