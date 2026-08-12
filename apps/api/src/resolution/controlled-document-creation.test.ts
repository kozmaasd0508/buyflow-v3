import test from 'node:test';
import assert from 'node:assert/strict';
import { selectControlledDocumentCandidate } from './controlled-document-creation.js';
import type { DocumentResolutionCandidate } from './document-resolution.js';

function candidate(
  overrides: Partial<DocumentResolutionCandidate> = {},
): DocumentResolutionCandidate {
  return {
    sourceEmailId: 'source-1',
    userId: 'user-1',
    purchaseId: 'purchase-1',
    decision: 'linkable',
    documentType: 'invoice',
    confidence: 0.9,
    reasons: [],
    ...overrides,
  };
}

test('accepts exactly one high-confidence linkable invoice', () => {
  const selected = selectControlledDocumentCandidate([candidate()]);
  assert.equal(selected.purchaseId, 'purchase-1');
});

test('rejects when there are no linkable document candidates', () => {
  assert.throws(
    () => selectControlledDocumentCandidate([candidate({ decision: 'unmatched', purchaseId: null })]),
    /exactly one linkable document candidate/,
  );
});

test('rejects multiple linkable document candidates', () => {
  assert.throws(
    () => selectControlledDocumentCandidate([candidate(), candidate({ sourceEmailId: 'source-2' })]),
    /exactly one linkable document candidate/,
  );
});

test('rejects a linkable candidate without a purchase', () => {
  assert.throws(
    () => selectControlledDocumentCandidate([candidate({ purchaseId: null })]),
    /has no purchase/,
  );
});

test('rejects receipt for the first controlled document write', () => {
  assert.throws(
    () => selectControlledDocumentCandidate([candidate({ documentType: 'receipt' })]),
    /requires an invoice/,
  );
});

test('rejects low-confidence invoice', () => {
  assert.throws(
    () => selectControlledDocumentCandidate([candidate({ confidence: 0.84 })]),
    /confidence is too low/,
  );
});
