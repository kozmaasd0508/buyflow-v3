import assert from 'node:assert/strict';
import test from 'node:test';
import { shipmentIdentityKey } from './identity-keys.js';
import { normalizeCarrierToken } from './identifier-normalizer.js';

test('generic carrier service suffixes collapse to one deterministic namespace', () => {
  assert.equal(normalizeCarrierToken('Express One'), 'expressone');
  assert.equal(normalizeCarrierToken('Express One futár'), 'expressone');
  assert.equal(normalizeCarrierToken('Express One Hungary'), 'expressone');
  assert.equal(normalizeCarrierToken('DPD futárszolgálat'), 'dpd');
  assert.equal(normalizeCarrierToken('GLS Hungary'), 'gls');
});

test('equivalent Express One labels produce the same exact shipment identity key', () => {
  const direct = shipmentIdentityKey('user-1', normalizeCarrierToken('Express One'), 'ABC987654');
  const merchant = shipmentIdentityKey('user-1', normalizeCarrierToken('Express One futár'), 'ABC987654');
  assert.ok(direct);
  assert.equal(merchant, direct);
});

test('different carrier brands remain different namespaces', () => {
  assert.notEqual(normalizeCarrierToken('Express One futár'), normalizeCarrierToken('DPD futárszolgálat'));
  assert.notEqual(normalizeCarrierToken('DPD'), normalizeCarrierToken('GLS Hungary'));
});
