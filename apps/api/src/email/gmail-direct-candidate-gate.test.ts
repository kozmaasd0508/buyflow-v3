import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from './types.js';
import { evaluateGmailDirectCandidate } from './gmail-direct-candidate-gate.js';

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'gmail',
    providerMessageId: 'm1',
    subject: 'Hello',
    from: [{ email: 'person@example.com' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-30T20:00:00.000Z',
    bodyText: 'See you tomorrow.',
    folders: ['INBOX'],
    attachments: [],
    ...overrides,
  };
}

test('unknown personal Gmail message is ignored instead of persisted for review', () => {
  const result = evaluateGmailDirectCandidate(email());
  assert.deepEqual(result, {
    action: 'ignore',
    reason: 'no_positive_commerce_evidence',
  });
});

test('Gmail Purchases category is positive but not exclusive commerce evidence', () => {
  const result = evaluateGmailDirectCandidate(email({ folders: ['INBOX', 'CATEGORY_PURCHASES'] }));
  assert.deepEqual(result, {
    action: 'observe',
    reason: 'gmail_purchases_category',
  });
});

test('schema.org Order markup is observed outside Gmail Purchases category', () => {
  const result = evaluateGmailDirectCandidate(email({
    bodyHtml: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Order","orderNumber":"12345"}</script>',
  }));
  assert.deepEqual(result, {
    action: 'observe',
    reason: 'structured_commerce_markup',
  });
});

test('product-only schema markup does not turn a personal mailbox message into stored commerce', () => {
  const result = evaluateGmailDirectCandidate(email({
    bodyHtml: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Sample product"}</script>',
  }));
  assert.deepEqual(result, {
    action: 'ignore',
    reason: 'no_positive_commerce_evidence',
  });
});

test('generic order confirmation is observed outside Gmail Purchases category', () => {
  const result = evaluateGmailDirectCandidate(email({
    subject: 'Order confirmation #123456',
    from: [{ email: 'orders@shop.example' }],
    bodyText: 'Thank you for your order. Order number: 123456. Total: 25.00 EUR.',
  }));
  assert.equal(result.action, 'observe');
  assert.ok([
    'deterministic_commerce_match',
    'universal_commerce_semantics',
  ].includes(result.reason));
});

test('strong promotional email remains ignored even if it is commerce themed', () => {
  const result = evaluateGmailDirectCandidate(email({
    subject: 'Exkluzív ajánlat - új kollekció',
    from: [{ email: 'news@shop.example' }],
    bodyText: 'Fedezd fel az új kollekciót. Vásárolj újra! Kuponkód: SAVE20.',
  }));
  assert.deepEqual(result, {
    action: 'ignore',
    reason: 'proven_non_commerce',
  });
});
