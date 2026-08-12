import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { filterCommerceEmail } from './commerce-email-filter.js';

function email(overrides: Partial<NormalizedEmail>): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'm1',
    receivedAt: '2026-08-12T10:00:00.000Z',
    from: [{ email: 'hello@example.com' }],
    to: [],
    cc: [],
    bcc: [],
    folders: [],
    attachments: [],
    ...overrides,
  };
}

test('accepts Gmail purchases category without keyword guessing', () => {
  const result = filterCommerceEmail(email({ folders: ['INBOX', 'CATEGORY_PURCHASES'] }));
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('gmail_category_purchases'));
});

test('accepts known carrier sender', () => {
  const result = filterCommerceEmail(email({ from: [{ email: 'notify@expressone.hu' }] }));
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('known_carrier_sender'));
});

test('accepts schema.org commerce markup', () => {
  const result = filterCommerceEmail(email({
    bodyHtml: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Order"}</script>',
  }));
  assert.equal(result.relevant, true);
  assert.deepEqual(result.commerceMarkupTypes, ['Order']);
});

test('ignores clearly unrelated email', () => {
  const result = filterCommerceEmail(email({ subject: 'Weekly team notes', snippet: 'Meeting recap' }));
  assert.equal(result.relevant, false);
  assert.deepEqual(result.reasons, []);
});
