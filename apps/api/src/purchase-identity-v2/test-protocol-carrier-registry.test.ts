import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTestProtocolCarrierIdentityRegistry } from './test-protocol-carrier-registry.js';

const registry = buildTestProtocolCarrierIdentityRegistry();

function provenance(...qualifiers: string[]) {
  return [{
    field: 'carrier',
    source: 'body' as const,
    parserVersion: null,
    extractorId: 'test',
    extractorVersion: 'v1',
    confidence: 0.99,
    qualifiers,
  }];
}

test('canonicalizes Express One merchant wording and direct sender to one carrier identity', () => {
  const merchant = registry.resolve({
    carrierRaw: 'Express One futár',
    senderDomain: 'service.gymbeam.hu',
    provenance: provenance('explicit_carrier_label'),
  });
  const direct = registry.resolve({
    carrierRaw: 'Express One',
    senderDomain: 'expressone.hu',
    provenance: provenance('authenticated_direct_carrier_sender'),
  });
  assert.equal(merchant, 'protocol:carrier.hu.expressone');
  assert.equal(direct, merchant);
});

test('canonicalizes DPD and GLS common merchant wording', () => {
  assert.equal(registry.resolve({
    carrierRaw: 'DPD futárszolgálat',
    senderDomain: 'webshippy.com',
    provenance: provenance('explicit_carrier_label'),
  }), 'protocol:carrier.hu.dpd');
  assert.equal(registry.resolve({
    carrierRaw: 'GLS futár',
    senderDomain: 'dorko.hu',
    provenance: provenance('explicit_carrier_label'),
  }), 'protocol:carrier.hu.gls');
});

test('direct carrier sender cannot override a conflicting explicit carrier identity', () => {
  assert.equal(registry.resolve({
    carrierRaw: 'GLS',
    senderDomain: 'expressone.hu',
    provenance: provenance('authenticated_direct_carrier_sender'),
  }), null);
});

test('unknown carrier wording stays unresolved', () => {
  assert.equal(registry.resolve({
    carrierRaw: 'Unknown Parcel Partner',
    senderDomain: 'merchant.example',
    provenance: provenance('explicit_carrier_label'),
  }), null);
});
