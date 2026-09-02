import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEmailAuthenticationResults } from './authentication-v1.js';

test('raw Authentication-Results verdicts are diagnostic and never hard trusted', () => {
  const result = extractEmailAuthenticationResults([{
    name: 'Authentication-Results',
    value: 'attacker.example; dkim=pass header.d=shop.example; spf=pass smtp.mailfrom=shop.example; dmarc=pass header.from=shop.example',
  }]);
  assert.deepEqual(result, {
    dkim: 'pass',
    spf: 'pass',
    dmarc: 'pass',
    trusted: false,
    source: 'authentication_results',
  });
});

test('conflicting raw auth verdicts fail closed to unknown', () => {
  const result = extractEmailAuthenticationResults([
    { name: 'Authentication-Results', value: 'mx-a; dkim=pass header.d=shop.example' },
    { name: 'Authentication-Results', value: 'mx-b; dkim=fail header.d=shop.example' },
  ]);
  assert.equal(result.dkim, 'unknown');
  assert.equal(result.trusted, false);
});

test('Received-SPF fallback keeps explicit provenance', () => {
  const result = extractEmailAuthenticationResults([
    { name: 'Received-SPF', value: 'pass (example)' },
  ]);
  assert.equal(result.spf, 'pass');
  assert.equal(result.source, 'received_spf');
  assert.equal(result.trusted, false);
});
