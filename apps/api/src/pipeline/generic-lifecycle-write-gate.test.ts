import assert from 'node:assert/strict';
import test from 'node:test';
import { isShadowOnlyParserVersion, isTrustedAutomaticEvidence } from './automatic-write-gate.js';

test('generic lifecycle parser versions are permanently shadow-only', () => {
  assert.equal(isShadowOnlyParserVersion('generic-lifecycle-v1'), true);
  assert.equal(isShadowOnlyParserVersion('generic-lifecycle-v2.3'), true);
});

test('generic lifecycle evidence is not trusted even if accidentally marked validated', () => {
  assert.equal(isTrustedAutomaticEvidence('validated', {
    parser_version: 'generic-lifecycle-v1',
    validation_status: 'validated',
    event_type: 'shipment',
    confidence: 0.99,
  }), false);
});

test('generic lifecycle evidence is not trusted when guardrailed either', () => {
  assert.equal(isTrustedAutomaticEvidence('guardrailed', {
    parser_version: 'generic-lifecycle-v99',
    validation_status: 'guardrailed',
    event_type: 'delivery',
    confidence: 0.99,
  }), false);
});

test('known deterministic evidence remains trusted when validation is trusted', () => {
  assert.equal(isTrustedAutomaticEvidence('validated', {
    parser_version: 'deterministic-commerce-v2',
    validation_status: 'validated',
    event_type: 'shipment',
    confidence: 0.99,
  }), true);
});
