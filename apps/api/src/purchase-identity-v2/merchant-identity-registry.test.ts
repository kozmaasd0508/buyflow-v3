import assert from 'node:assert/strict';
import test from 'node:test';
import { MerchantIdentityRegistry } from './merchant-identity-registry.js';
import type { EvidenceProvenance, MerchantIdentityDefinition } from './types.js';

const merchantA: MerchantIdentityDefinition = {
  merchantId: 'merchant:a',
  canonicalName: 'Example Shop',
  domains: ['example-shop.hu'],
  senderDomains: ['mail.example-shop.hu'],
  storefrontAliases: ['ExampleShop'],
  invoiceIssuers: [],
  paymentDescriptors: [],
};

const merchantB: MerchantIdentityDefinition = {
  merchantId: 'merchant:b',
  canonicalName: 'Other Store',
  domains: ['other-store.hu'],
  senderDomains: ['notify.other-store.hu'],
  storefrontAliases: ['OtherStore'],
  invoiceIssuers: [],
  paymentDescriptors: [],
};

function provenance(qualifier = 'sender_commercial_identity'): EvidenceProvenance[] {
  return [{
    field: 'merchant',
    source: 'sender',
    parserVersion: null,
    extractorId: 'universal-merchant',
    extractorVersion: 'test-v1',
    confidence: 0.9,
    qualifiers: [qualifier],
  }];
}

test('resolves only when exact alias and sender-domain namespace agree', () => {
  const registry = new MerchantIdentityRegistry([merchantA, merchantB]);
  const result = registry.resolveDetailed({
    merchantRaw: 'ExampleShop',
    senderDomain: 'mail.example-shop.hu',
    provenance: provenance(),
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.merchantId, 'merchant:a');
  assert.deepEqual(result.aliasCandidateIds, ['merchant:a']);
  assert.deepEqual(result.domainCandidateIds, ['merchant:a']);
});

test('accepts subdomains inside a registered sender namespace', () => {
  const registry = new MerchantIdentityRegistry([merchantA]);
  assert.equal(registry.resolve({
    merchantRaw: 'Example Shop',
    senderDomain: 'transactional.mail.example-shop.hu',
    provenance: provenance(),
  }), 'merchant:a');
});

test('does not resolve from merchant display text alone', () => {
  const registry = new MerchantIdentityRegistry([merchantA]);
  const result = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'unknown-mailer.net',
    provenance: provenance('explicit_merchant_label'),
  });

  assert.equal(result.status, 'unresolved');
  assert.equal(result.merchantId, null);
  assert.deepEqual(result.aliasCandidateIds, ['merchant:a']);
  assert.deepEqual(result.domainCandidateIds, []);
});

test('does not resolve from sender domain alone', () => {
  const registry = new MerchantIdentityRegistry([merchantA]);
  const result = registry.resolveDetailed({
    merchantRaw: 'Completely Different Display',
    senderDomain: 'mail.example-shop.hu',
    provenance: provenance(),
  });

  assert.equal(result.status, 'unresolved');
  assert.equal(result.merchantId, null);
  assert.deepEqual(result.aliasCandidateIds, []);
  assert.deepEqual(result.domainCandidateIds, ['merchant:a']);
});

test('alias and sender domain pointing to different merchants becomes conflict', () => {
  const registry = new MerchantIdentityRegistry([merchantA, merchantB]);
  const result = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'notify.other-store.hu',
    provenance: provenance(),
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.merchantId, null);
  assert.deepEqual(result.aliasCandidateIds, ['merchant:a']);
  assert.deepEqual(result.domainCandidateIds, ['merchant:b']);
});

test('ambiguous registry aliases never select a winner', () => {
  const duplicateAlias: MerchantIdentityDefinition = {
    ...merchantB,
    merchantId: 'merchant:c',
    storefrontAliases: ['ExampleShop'],
    senderDomains: ['mail.example-shop.hu'],
    domains: [],
  };
  const registry = new MerchantIdentityRegistry([merchantA, duplicateAlias]);
  const result = registry.resolveDetailed({
    merchantRaw: 'ExampleShop',
    senderDomain: 'mail.example-shop.hu',
    provenance: provenance(),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.merchantId, null);
});

test('similar but non-exact merchant names do not fuzzy match', () => {
  const registry = new MerchantIdentityRegistry([merchantA]);
  assert.equal(registry.resolve({
    merchantRaw: 'Example Shop Hungary Official',
    senderDomain: 'mail.example-shop.hu',
    provenance: provenance(),
  }), null);
});

test('rejects duplicate merchant ids at construction time', () => {
  assert.throws(() => new MerchantIdentityRegistry([
    merchantA,
    { ...merchantB, merchantId: merchantA.merchantId },
  ]), /unique merchantId/);
});
