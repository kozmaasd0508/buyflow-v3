import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { evaluateShoppingEmailPurpose } from './shopping-email-purpose-gate.js';

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'msg-1',
    subject: 'Weekly news',
    from: [{ email: 'hello@example.com', name: 'Example' }],
    to: [{ email: 'user@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-23T18:00:00.000Z',
    snippet: 'Read our latest stories.',
    folders: ['inbound'],
    attachments: [],
    ...overrides,
  };
}

test('ignores strong promotional or repurchase marketing noise', () => {
  const decision = evaluateShoppingEmailPurpose(email({
    subject: 'Exkluzív ajánlat - új kollekció',
    snippet: 'Fedezd fel az új kollekciót és vásárolj újra. Kuponkód: SAVE20',
  }));

  assert.equal(decision.action, 'ignore');
  assert.equal(decision.reason, 'shopping_email_excluded_promotional_or_repurchase_marketing');
});

test('does not ignore a real order confirmation even if it contains promotional wording', () => {
  const decision = evaluateShoppingEmailPurpose(email({
    subject: 'Order confirmation #123456 - exclusive offer inside',
    snippet: 'Thank you for your order. Order number: 123456. Shop now and use coupon code NEXT10.',
  }));

  assert.equal(decision.action, 'continue');
});

test('ignores known provider messages that are not purchase lifecycle events', () => {
  const decision = evaluateShoppingEmailPurpose(email({
    subject: 'Sikeres fizetés',
    from: [{ email: 'noreply@simplepay.hu', name: 'SimplePay' }],
    snippet: 'Az Intrum.hu részére végzett fizetés sikeres volt.',
  }));

  assert.equal(decision.action, 'ignore');
  assert.equal(decision.reason, 'shopping_email_excluded_known_non_purchase_provider_message');
});

test('keeps unknown mail for REVIEW instead of dropping it', () => {
  const decision = evaluateShoppingEmailPurpose(email());
  assert.equal(decision.action, 'continue');
  assert.equal(decision.reason, 'shopping_email_not_proven_non_purchase');
});
