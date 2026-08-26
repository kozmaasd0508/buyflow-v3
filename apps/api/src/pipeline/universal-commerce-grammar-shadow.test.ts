import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from './normalized-inbound-pipeline.js';
import { runUniversalCommerceGrammarShadow } from './universal-commerce-grammar-shadow.js';

function email(input: {
  subject: string;
  body: string;
}): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'shadow-test-1',
    subject: input.subject,
    from: [{ email: 'orders@never-seen-shop.example', name: 'Never Seen Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-24T19:30:00.000Z',
    bodyHtml: `<p>${input.body.replace(/\n/g, '</p><p>')}</p>`,
    folders: ['inbound'],
    attachments: [],
  };
}

test('normalized inbound plan records universal grammar without changing existing classification authority', () => {
  const message = email({
    subject: 'Megrendelés visszaigazolása',
    body: [
      'Köszönjük, megrendelését megkaptuk.',
      'Rendelésszám: 8734621',
      'Rendelés részletei',
      '1x Ismeretlen termék 24 990 Ft',
      'Fizetési mód: Bankkártya',
      'Szállítási mód: Házhozszállítás',
      'Végösszeg: 24 990 Ft',
    ].join('\n'),
  });

  const plan = planNormalizedInboundEmail({ email: message });
  const shadow = plan.structuredResult.universal_commerce_grammar_shadow as Record<string, unknown>;

  assert.ok(shadow);
  assert.equal(shadow.mode, 'shadow');
  assert.equal(shadow.productionWrites, 0);
  assert.equal(shadow.aiCalls, 0);
  assert.equal(shadow.lifecycle, 'order_created');
  assert.equal(shadow.decision, 'actionable');

  // The observer is diagnostic only. Existing parser ownership is unchanged.
  assert.notEqual(plan.parserVersion, 'universal-commerce-grammar-v1');
});

test('review request is blocked in shadow and diagnostic leaks no raw identity value', () => {
  const message = email({
    subject: 'Order #19601, how did it go?',
    body: 'Order number: 19601\nPlease share your review and rate your purchase.',
  });

  const shadow = runUniversalCommerceGrammarShadow(message);
  const serialized = JSON.stringify(shadow);

  assert.equal(shadow.lifecycle, 'review_request');
  assert.equal(shadow.decision, 'blocked');
  assert.equal(shadow.eventType, null);
  assert.equal(shadow.productionWrites, 0);
  assert.equal(shadow.aiCalls, 0);
  assert.equal(serialized.includes('19601'), false);
  assert.equal(serialized.includes('never-seen-shop'), false);
});

test('unknown message can stay REVIEW while universal grammar diagnostic is still recorded', () => {
  const message = email({
    subject: 'Fontos információ',
    body: 'Tájékoztatás a szolgáltatásunkról.',
  });

  const plan = planNormalizedInboundEmail({ email: message });
  const shadow = plan.structuredResult.universal_commerce_grammar_shadow as Record<string, unknown>;

  assert.equal(plan.status, 'review');
  assert.equal(plan.classification, null);
  assert.equal(shadow.lifecycle, 'unknown');
  assert.equal(shadow.decision, 'review');
});
