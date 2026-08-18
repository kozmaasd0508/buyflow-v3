import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBuyFlowEmailAddress,
  generateBuyFlowEmailAddress,
  isValidBuyFlowLocalPart,
  normalizeBuyFlowEmailAddress,
  suggestBuyFlowEmailAddress,
  suggestBuyFlowLocalPart,
} from './buyflow-address.js';

test('builds a normalized human-readable BuyFlow shopping address', () => {
  assert.equal(
    buildBuyFlowEmailAddress('Kozma0508'),
    'kozma0508@buyflow.hu',
  );
});

test('keeps opaque generated addresses as a safe fallback', () => {
  const generated = generateBuyFlowEmailAddress(
    'buyflow.hu',
    () => Buffer.from('0123456789abcdef', 'hex'),
  );

  assert.equal(generated, 'bf-0123456789abcdef@buyflow.hu');
});

test('suggests the Gmail username as the BuyFlow shopping address', () => {
  assert.equal(suggestBuyFlowLocalPart('kozma0508@gmail.com'), 'kozma0508');
  assert.equal(
    suggestBuyFlowEmailAddress('kozma0508@gmail.com'),
    'kozma0508@buyflow.hu',
  );
});

test('removes plus tags and safely normalizes a suggested local part', () => {
  assert.equal(
    suggestBuyFlowLocalPart('Kozma.0508+shop@gmail.com'),
    'kozma.0508',
  );
});

test('protects reserved service addresses', () => {
  assert.equal(isValidBuyFlowLocalPart('support'), false);
  assert.equal(suggestBuyFlowLocalPart('support@gmail.com'), 'support-shop');
});

test('normalizes valid addresses and rejects other domains or malformed aliases', () => {
  assert.equal(
    normalizeBuyFlowEmailAddress(' Kozma0508@BUYFLOW.HU '),
    'kozma0508@buyflow.hu',
  );
  assert.equal(
    normalizeBuyFlowEmailAddress('kozma0508@example.com'),
    null,
  );
  assert.equal(
    normalizeBuyFlowEmailAddress('x@buyflow.hu'),
    null,
  );
  assert.equal(
    normalizeBuyFlowEmailAddress('bad..name@buyflow.hu'),
    null,
  );
});

test('supports an explicitly configured BuyFlow email domain', () => {
  assert.equal(
    buildBuyFlowEmailAddress('kozma0508', '@mail.buyflow.hu'),
    'kozma0508@mail.buyflow.hu',
  );
});
