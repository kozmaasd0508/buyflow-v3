import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReplaceAiOffFallbackWithDeterministic,
  parseDeterministicCommerceEmail,
} from './deterministic-commerce-parser.js';

test('central deterministic parser falls through to generic order confirmation parser', () => {
  const parsed = parseDeterministicCommerceEmail({
    senderDomains: ['orders.unknown-demo-store.eu'],
    subject: 'Order confirmation',
    bodyText: [
      'Thanks for your order',
      'Order ID: DEMO-2026-8871',
      'Order summary',
      'Desk Lamp | Qty 1 | 39.90 EUR',
      'Order total: 44.90 EUR',
      'Payment method: Visa',
      'Shipping method: Standard delivery',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'generic-order-confirmation-v1.1');
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.order_number, 'DEMO-2026-8871');
});

test('safe reparse policy replaces only AI-off fallback review evidence', () => {
  assert.equal(canReplaceAiOffFallbackWithDeterministic({
    validatedResult: {
      parser_version: 'deterministic-ai-off-fallback-v1',
      validation_status: 'review',
    },
    validationStatus: 'review',
    processingStatus: 'review',
  }), true);
});

test('safe reparse policy never overwrites trusted deterministic or processed evidence', () => {
  assert.equal(canReplaceAiOffFallbackWithDeterministic({
    validatedResult: { parser_version: 'limone-order-v1' },
    validationStatus: 'validated',
    processingStatus: 'processed',
  }), false);

  assert.equal(canReplaceAiOffFallbackWithDeterministic({
    validatedResult: { parser_version: 'deterministic-ai-off-fallback-v1' },
    validationStatus: 'review',
    processingStatus: 'processed',
  }), false);

  assert.equal(canReplaceAiOffFallbackWithDeterministic({
    validatedResult: { parser_version: 'deterministic-ai-off-fallback-v1' },
    validationStatus: 'validated',
    processingStatus: 'review',
  }), false);
});
