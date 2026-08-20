import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { parseNormalizedDeterministicEmail } from './normalized-email-deterministic.js';

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'reply-1',
    subject: 'Re: iPon - Rendelés #3091626',
    from: [{ email: 'info@ipon.hu', name: 'iPon Computer Kft.' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-04-22T19:10:04.000Z',
    bodyHtml: null,
    snippet: '',
    folders: ['inbox'],
    attachments: [],
    ...overrides,
  };
}

test('reply support thread cannot create a new order from quoted historical commerce content', () => {
  const parsed = parseNormalizedDeterministicEmail(email({
    snippet: [
      'Tisztelt Vásárló, a korábbi rendelés már lezárult.',
      'Gáborné Kozma ezt írta (időpont: 2026. ápr. 22.):',
      'iPon - Rendelés #3091626',
      'Köszönjük rendelését. Rendelési szám: 3091626',
    ].join('\n'),
  }));

  assert.equal(parsed, null);
});

test('reply subject may still pass when the newly authored prefix explicitly confirms a new order', () => {
  const parsed = parseNormalizedDeterministicEmail(email({
    providerMessageId: 'reply-2',
    subject: 'Re: rendelési egyeztetés',
    snippet: [
      'Megrendelés visszaigazolása: 2026/8420/003',
      'Köszönjük, rendelését rögzítettük.',
      '-----Original Message-----',
      'Korábbi rendelés: 2026/8420/002',
    ].join('\n'),
  }));

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.ok(parsed.reasons.includes('reply_thread_explicit_new_order_evidence'));
});
