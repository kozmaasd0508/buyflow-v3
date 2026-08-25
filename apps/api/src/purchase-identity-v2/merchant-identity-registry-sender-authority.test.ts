import assert from 'node:assert/strict';
import test from 'node:test';
import { MerchantIdentityRegistry } from './merchant-identity-registry.js';
import type { MerchantIdentityDefinition } from './types.js';

const storefrontOnly: MerchantIdentityDefinition = {
  merchantId: 'merchant:storefront-only',
  canonicalName: 'Example Shop',
  domains: ['example-shop.hu'],
  senderDomains: [],
  storefrontAliases: [],
  invoiceIssuers: [],
  paymentDescriptors: [],
};

test('storefront domain alone never establishes trusted email sender authority', () => {
  const registry = new MerchantIdentityRegistry([storefrontOnly]);
  const result = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'mail.example-shop.hu',
    observedAt: '2026-08-23T00:00:00.000Z',
    provenance: [],
  });

  assert.equal(result.status, 'unresolved');
  assert.equal(result.merchantId, null);
  assert.deepEqual(result.aliasCandidateIds, ['merchant:storefront-only']);
  assert.deepEqual(result.domainCandidateIds, []);
});

test('explicit sender domain still establishes authority with the same exact merchant identity', () => {
  const registry = new MerchantIdentityRegistry([{
    ...storefrontOnly,
    senderDomains: ['mail.example-shop.hu'],
  }]);

  assert.equal(registry.resolve({
    merchantRaw: 'Example Shop',
    senderDomain: 'transactional.mail.example-shop.hu',
    observedAt: '2026-08-23T00:00:00.000Z',
    provenance: [],
  }), 'merchant:storefront-only');
});
