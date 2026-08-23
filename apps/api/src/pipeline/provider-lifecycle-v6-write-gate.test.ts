import assert from 'node:assert/strict';
import test from 'node:test';
import { isShadowOnlyParserVersion, isTrustedAutomaticEvidence } from './automatic-write-gate.js';

test('provider lifecycle v6 remains shadow-only and cannot become trusted automatic evidence', () => {
  assert.equal(isShadowOnlyParserVersion('provider-lifecycle-v6-shadow'), true);
  assert.equal(isTrustedAutomaticEvidence('validated', {
    parser_version: 'provider-lifecycle-v6-shadow',
    validation_status: 'validated',
  }), false);
});
