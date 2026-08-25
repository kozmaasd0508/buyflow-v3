import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { extractExplicitOrderRelation } from './explicit-order-relation.js';

function document(text: string, subject = 'Order update'): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'relation-test',
    receivedAt: '2026-08-25T20:30:00.000Z',
    sender: {
      addresses: [{ email: 'orders@never-seen-shop.example', name: 'Never Seen Shop' }],
      domains: ['never-seen-shop.example'],
      primaryEmail: 'orders@never-seen-shop.example',
      primaryDomain: 'never-seen-shop.example',
      primaryName: 'Never Seen Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject,
    text,
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: [],
    },
  };
}

test('extracts explicit English replacement relation', () => {
  const result = extractExplicitOrderRelation(
    document('Replacement order: NEW-200 for original order: OLD-100'),
    'NEW-200',
  );

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.relation?.relation, 'replacement');
  assert.equal(result.relation?.parentOrderIdNormalized, 'OLD100');
  assert.equal(result.relation?.childOrderIdNormalized, 'NEW200');
  assert.ok(result.relation?.provenance.some((item) => item.qualifiers?.includes('explicit_parent_child_order')));
});

test('extracts explicit Hungarian parent and replacement labels', () => {
  const result = extractExplicitOrderRelation(
    document('Eredeti rendelés: REGI-100\nCsere rendelés: UJ-200'),
    'UJ-200',
  );

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.relation?.relation, 'replacement');
  assert.equal(result.relation?.parentOrderIdNormalized, 'REGI100');
  assert.equal(result.relation?.childOrderIdNormalized, 'UJ200');
});

test('extracts explicit Hungarian split-child relation', () => {
  const result = extractExplicitOrderRelation(
    document('Szülő rendelés: MAIN-700\nRészrendelés: PART-701'),
    'PART-701',
  );

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.relation?.relation, 'split_child');
  assert.equal(result.relation?.parentOrderIdNormalized, 'MAIN700');
  assert.equal(result.relation?.childOrderIdNormalized, 'PART701');
});

test('does not infer a relation from similar identifiers or generic wording', () => {
  const result = extractExplicitOrderRelation(
    document('Rendelés: ABC-100. A következő rendelés: ABC-101. A csomagot hamarosan feladjuk.'),
    'ABC-101',
  );

  assert.equal(result.relation, null);
  assert.equal(result.conflicts.length, 0);
});

test('ignores explicit relation that belongs to a different current child order', () => {
  const result = extractExplicitOrderRelation(
    document('Original order: OLD-100\nReplacement order: NEW-200'),
    'OTHER-300',
  );

  assert.equal(result.relation, null);
  assert.equal(result.conflicts.length, 0);
});

test('ignores relation text from quoted message history', () => {
  const result = extractExplicitOrderRelation(
    document('A csomag úton van.\n--- Original Message ---\nOriginal order: OLD-100\nReplacement order: NEW-200'),
    'NEW-200',
  );

  assert.equal(result.relation, null);
  assert.equal(result.conflicts.length, 0);
});

test('conflicting explicit parents become a hard relation conflict', () => {
  const result = extractExplicitOrderRelation(
    document([
      'Original order: OLD-100',
      'Replacement order: NEW-200',
      'Original order: OLD-999',
      'Replacement order: NEW-200',
    ].join('\n')),
    'NEW-200',
  );

  assert.equal(result.relation, null);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.severity, 'hard');
  assert.equal(result.conflicts[0]?.field, 'order_relation');
});

test('same parent and child relation repeated in subject and body deduplicates safely', () => {
  const result = extractExplicitOrderRelation(
    document(
      'Original order: OLD-100 Replacement order: NEW-200',
      'Original order: OLD-100 Replacement order: NEW-200',
    ),
    'NEW-200',
  );

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.relation?.parentOrderIdNormalized, 'OLD100');
  assert.equal(result.relation?.provenance.length, 2);
});
