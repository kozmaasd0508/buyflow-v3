import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence, protocolDomainMatchesTrustedSuffix } from './detect.js';
import { registeredProtocolProfiles } from './registry.js';
import {
  compareProtocolAuthority,
  provenanceCanSupportProduction,
} from './safety.js';
import { validateProtocolProfile } from './profile-validator.js';
import type { ProtocolProfile } from './types.js';

function profile(overrides: Partial<ProtocolProfile> = {}): ProtocolProfile {
  return {
    protocol_id: 'merchant.example-shop',
    protocol_version: '1.0.0',
    kind: 'merchant',
    status: 'production',
    display_name: 'Example Shop',
    country: 'HU',
    sender_domains: ['example-shop.hu'],
    identifier_patterns: {
      order_id: ['Rendel(?:e|é)s(?:sz(?:a|á)m)?\\s*[:#-]?\\s*#?([A-Z0-9-]{5,30})'],
      tracking_id: [],
      invoice_id: [],
      payment_reference: [],
    },
    sources: [
      {
        id: 'official-1',
        title: 'Official transaction email documentation',
        provenance: 'official_documentation',
      },
    ],
    events: [
      {
        event: 'ORDER_CREATED',
        base_confidence: 0.9,
        positive_rules: [
          {
            id: 'example.order-created.subject',
            field: 'subject',
            pattern: 'megrendel[eé]s visszaigazol[aá]sa',
            required: true,
            source_ids: ['official-1'],
          },
          {
            id: 'example.order-created.body',
            field: 'body',
            pattern: 'Rendel(?:e|é)s(?:sz(?:a|á)m)?\\s*[:#-]',
            required: true,
            confidence_delta: 0.03,
            source_ids: ['official-1'],
          },
        ],
        negative_rules: [
          {
            id: 'example.order-created.newsletter-negative',
            field: 'body',
            pattern: 'h[ií]rlev[eé]l',
            source_ids: ['official-1'],
          },
        ],
      },
    ],
    ...overrides,
  };
}

test('foundation registry is intentionally empty and cannot change current recognition', () => {
  assert.deepEqual(registeredProtocolProfiles(), []);
  assert.deepEqual(detectProtocolEvidence({
    senderDomains: ['unknown.example'],
    subject: 'Anything',
    bodyText: 'Anything',
  }), []);
});

test('trusted sender matching accepts true subdomains and rejects lookalike domains', () => {
  assert.equal(protocolDomainMatchesTrustedSuffix('mail.example-shop.hu', 'example-shop.hu'), true);
  assert.equal(protocolDomainMatchesTrustedSuffix('example-shop.hu', 'example-shop.hu'), true);
  assert.equal(protocolDomainMatchesTrustedSuffix('example-shop.hu.attacker.example', 'example-shop.hu'), false);
  assert.equal(protocolDomainMatchesTrustedSuffix('evil-example-shop.hu', 'example-shop.hu'), false);
});

test('documented production profile emits evidence but never performs a Purchase write itself', () => {
  const [evidence] = detectProtocolEvidence({
    senderDomains: ['mail.example-shop.hu'],
    subject: 'Megrendelés visszaigazolása',
    bodyText: 'Köszönjük. Rendelésszám: #HU-12345',
  }, [profile()]);

  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence.identifiers.order_id, 'HU-12345');
  assert.equal(evidence.confidence, 0.93);
  assert.equal(evidence.production_eligible, true);
  assert.equal(evidence.blocked_by_negative_evidence, false);
});

test('hard negative evidence blocks production eligibility without inventing a different event', () => {
  const [evidence] = detectProtocolEvidence({
    senderDomains: ['example-shop.hu'],
    subject: 'Megrendelés visszaigazolása',
    bodyText: 'Hírlevél: korábbi Rendelésszám: #HU-12345, vásárolj újra!',
  }, [profile()]);

  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence.blocked_by_negative_evidence, true);
  assert.equal(evidence.production_eligible, false);
  assert.equal(evidence.negative_evidence[0]?.rule_id, 'example.order-created.newsletter-negative');
});

test('inferred-only evidence can never enter an automatic production decision', () => {
  const inferredProfile = profile({
    sources: [{
      id: 'inferred-1',
      title: 'Unverified inference',
      provenance: 'inferred',
    }],
    events: [{
      event: 'ORDER_CREATED',
      base_confidence: 0.99,
      positive_rules: [{
        id: 'inferred.order-created',
        field: 'subject',
        pattern: 'megrendel[eé]s visszaigazol[aá]sa',
        source_ids: ['inferred-1'],
      }],
    }],
  });

  const [evidence] = detectProtocolEvidence({
    senderDomains: ['example-shop.hu'],
    subject: 'Megrendelés visszaigazolása',
  }, [inferredProfile]);

  assert.ok(evidence);
  assert.equal(evidence.production_eligible, false);
  assert.equal(provenanceCanSupportProduction(evidence.provenance_levels), false);
});

test('protocol prohibitions are preserved for the downstream classifier and resolution layers', () => {
  const shipmentProfile = profile({
    events: [{
      event: 'SHIPMENT_CREATED',
      base_confidence: 0.95,
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_IN_TRANSIT',
      ],
      positive_rules: [{
        id: 'example.pre-advice',
        field: 'subject',
        pattern: 'c[ií]mke elk[eé]sz[uü]lt',
        source_ids: ['official-1'],
      }],
    }],
  });

  const [evidence] = detectProtocolEvidence({
    senderDomains: ['example-shop.hu'],
    subject: 'Címke elkészült',
  }, [shipmentProfile]);

  assert.ok(evidence);
  assert.deepEqual(evidence.prohibitions, [
    'DO_NOT_CREATE_PURCHASE',
    'DO_NOT_SET_SHIPPED_AT',
    'DO_NOT_MARK_IN_TRANSIT',
  ]);
});

test('authority matrix formalizes direct-source precedence without performing entity linking', () => {
  assert.ok(compareProtocolAuthority({
    domain: 'logistics_state', left: 'carrier_direct', right: 'merchant',
  }) > 0);
  assert.ok(compareProtocolAuthority({
    domain: 'payment_state', left: 'payment_provider_direct', right: 'merchant',
  }) > 0);
  assert.ok(compareProtocolAuthority({
    domain: 'invoice_state', left: 'invoice_pdf', right: 'merchant',
  }) > 0);
});

test('profile validation rejects unversioned, unsafe or unsourced rules', () => {
  const invalid = profile({
    protocol_version: 'latest',
    events: [{
      event: 'ORDER_CREATED',
      base_confidence: 1.2,
      positive_rules: [{
        id: 'bad-rule',
        field: 'subject',
        pattern: '[',
        flags: 'z',
        source_ids: ['missing-source'],
      }],
    }],
  });

  const errors = validateProtocolProfile(invalid);
  assert.ok(errors.includes('protocol_version_must_be_semver'));
  assert.ok(errors.includes('invalid_regex_flags:bad-rule'));
  assert.ok(errors.includes('invalid_regex:bad-rule'));
  assert.ok(errors.includes('unknown_source_id:bad-rule:missing-source'));
  assert.ok(errors.includes('invalid_base_confidence:ORDER_CREATED'));
});
