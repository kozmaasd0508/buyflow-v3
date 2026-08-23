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
  assert.equal(result.registryVersion, 'merchant-identity-registry-v2');
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

test('old and new sender domains can coexist without changing historical identity', () => {
  const changingMerchant: MerchantIdentityDefinition = {
    ...merchantA,
    senderDomains: [],
    identitySignals: [
      {
        kind: 'sender_domain',
        value: 'old-mail.example-shop.hu',
        status: 'historical',
        validTo: '2026-07-01T00:00:00.000Z',
        evidenceSource: 'verified-provider-history',
      },
      {
        kind: 'sender_domain',
        value: 'new-mail.example-shop.hu',
        status: 'active',
        validFrom: '2026-07-01T00:00:00.000Z',
        evidenceSource: 'verified-provider-change',
      },
    ],
  };
  const registry = new MerchantIdentityRegistry([changingMerchant], { registryVersion: 'test-registry-2026-08' });

  const oldMail = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'old-mail.example-shop.hu',
    observedAt: '2026-06-15T12:00:00.000Z',
    provenance: provenance(),
  });
  const newMail = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'new-mail.example-shop.hu',
    observedAt: '2026-08-15T12:00:00.000Z',
    provenance: provenance(),
  });
  const staleOldDomain = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'old-mail.example-shop.hu',
    observedAt: '2026-08-15T12:00:00.000Z',
    provenance: provenance(),
  });

  assert.equal(oldMail.status, 'resolved');
  assert.equal(oldMail.merchantId, 'merchant:a');
  assert.equal(oldMail.registryVersion, 'test-registry-2026-08');
  assert.ok(oldMail.reasons.includes('historical_merchant_identity_signal_used'));
  assert.ok(oldMail.matchedSignals.some((signal) => signal.evidenceSource === 'verified-provider-history'));

  assert.equal(newMail.status, 'resolved');
  assert.equal(newMail.merchantId, 'merchant:a');
  assert.ok(newMail.matchedSignals.some((signal) => signal.evidenceSource === 'verified-provider-change'));

  assert.equal(staleOldDomain.status, 'unresolved');
  assert.equal(staleOldDomain.merchantId, null);
});

test('same alias and domain can move to another identity in non-overlapping time windows', () => {
  const firstOwner: MerchantIdentityDefinition = {
    ...merchantA,
    canonicalName: 'Shared Shop',
    storefrontAliases: [],
    domains: [],
    senderDomains: [],
    identitySignals: [
      { kind: 'sender_domain', value: 'shared.example', validTo: '2026-01-01T00:00:00.000Z', status: 'historical' },
    ],
  };
  const secondOwner: MerchantIdentityDefinition = {
    ...merchantB,
    canonicalName: 'Shared Shop',
    storefrontAliases: [],
    domains: [],
    senderDomains: [],
    identitySignals: [
      { kind: 'sender_domain', value: 'shared.example', validFrom: '2026-01-01T00:00:00.000Z', status: 'active' },
    ],
  };
  const registry = new MerchantIdentityRegistry([firstOwner, secondOwner]);

  assert.equal(registry.resolve({
    merchantRaw: 'Shared Shop',
    senderDomain: 'shared.example',
    observedAt: '2025-12-01T00:00:00.000Z',
    provenance: provenance(),
  }), 'merchant:a');

  assert.equal(registry.resolve({
    merchantRaw: 'Shared Shop',
    senderDomain: 'shared.example',
    observedAt: '2026-02-01T00:00:00.000Z',
    provenance: provenance(),
  }), 'merchant:b');
});

test('disabled identity signals never resolve', () => {
  const registry = new MerchantIdentityRegistry([{
    ...merchantA,
    senderDomains: [],
    identitySignals: [{
      kind: 'sender_domain',
      value: 'disabled.example-shop.hu',
      status: 'disabled',
      evidenceSource: 'revoked-domain',
    }],
  }]);

  const result = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'disabled.example-shop.hu',
    observedAt: '2026-08-23T00:00:00.000Z',
    provenance: provenance(),
  });
  assert.equal(result.status, 'unresolved');
  assert.equal(result.merchantId, null);
});

test('historical or time-bounded signals require an observation time', () => {
  const registry = new MerchantIdentityRegistry([{
    ...merchantA,
    senderDomains: [],
    identitySignals: [{
      kind: 'sender_domain',
      value: 'old.example-shop.hu',
      status: 'historical',
      validTo: '2026-07-01T00:00:00.000Z',
    }],
  }]);

  assert.equal(registry.resolve({
    merchantRaw: 'Example Shop',
    senderDomain: 'old.example-shop.hu',
    provenance: provenance(),
  }), null);
});

test('invalid observation time never guesses an identity', () => {
  const registry = new MerchantIdentityRegistry([merchantA]);
  const result = registry.resolveDetailed({
    merchantRaw: 'Example Shop',
    senderDomain: 'mail.example-shop.hu',
    observedAt: 'not-a-date',
    provenance: provenance(),
  });
  assert.equal(result.status, 'unresolved');
  assert.ok(result.reasons.includes('merchant_identity_observed_at_invalid'));
});

test('rejects invalid identity validity windows at construction time', () => {
  assert.throws(() => new MerchantIdentityRegistry([{
    ...merchantA,
    identitySignals: [{
      kind: 'sender_domain',
      value: 'bad-window.example',
      validFrom: '2026-08-02T00:00:00.000Z',
      validTo: '2026-08-01T00:00:00.000Z',
    }],
  }]), /validTo to be later than validFrom/);
});

test('rejects duplicate merchant ids at construction time', () => {
  assert.throws(() => new MerchantIdentityRegistry([
    merchantA,
    { ...merchantB, merchantId: merchantA.merchantId },
  ]), /unique merchantId/);
});
