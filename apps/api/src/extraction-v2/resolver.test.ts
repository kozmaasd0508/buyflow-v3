import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceClaim } from './types.js';
import { resolveField } from './resolver.js';

function claim<T>(input: Partial<EvidenceClaim<T>> & Pick<EvidenceClaim<T>, 'field' | 'value'>): EvidenceClaim<T> {
  return {
    field: input.field,
    value: input.value,
    confidence: input.confidence ?? 0.9,
    source: input.source ?? 'body',
    extractorId: input.extractorId ?? 'test',
    extractorVersion: input.extractorVersion ?? 'v1',
    qualifiers: input.qualifiers,
  };
}

test('higher-precedence evidence wins without provider-specific resolver logic', () => {
  const result = resolveField<string>({
    claims: [
      claim({ field: 'merchant', value: 'example.hu', source: 'sender', confidence: 0.95 }),
      claim({ field: 'merchant', value: 'Example Shop Kft.', source: 'body', confidence: 0.9, qualifiers: ['explicit_label'] }),
    ],
    rank: (item) => item.qualifiers?.includes('explicit_label') ? 100 : 50,
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.value, 'Example Shop Kft.');
});

test('equal-precedence conflicting strong evidence becomes conflict instead of silent overwrite', () => {
  const result = resolveField<string>({
    claims: [
      claim({ field: 'order_number', value: 'A-100', qualifiers: ['explicit_label'] }),
      claim({ field: 'order_number', value: 'B-200', qualifiers: ['explicit_label'] }),
    ],
    rank: () => 100,
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.value, null);
  assert.equal(result.provenance.length, 2);
});

test('equivalent strongest evidence resolves and keeps provenance', () => {
  const result = resolveField<number>({
    claims: [
      claim({ field: 'total', value: 14960, source: 'body', confidence: 0.9 }),
      claim({ field: 'total', value: 14960, source: 'document_structure', confidence: 0.95 }),
    ],
    rank: () => 100,
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.value, 14960);
  assert.equal(result.confidence, 0.95);
  assert.equal(result.provenance.length, 2);
});

test('no eligible evidence resolves as missing', () => {
  const result = resolveField<string>({
    claims: [claim({ field: 'currency', value: 'HUF', confidence: 0.3 })],
    rank: () => 100,
    minimumConfidence: 0.8,
  });

  assert.equal(result.status, 'missing');
  assert.equal(result.value, null);
});
