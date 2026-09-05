import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGmailDirectCandidate } from './gmail-direct-candidate-gate.js';
import { normalizeGmailMessage } from './gmail-incremental-provider.js';
import type { NormalizedEmail } from './types.js';
import { normalizedEmailToDeterministicInput } from '../ingestion/normalized-email-deterministic.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'gmail',
    providerMessageId: 'mail-lens-test',
    subject: 'Account notification',
    from: [{ email: 'orders@shop.example' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-09-02T10:00:00.000Z',
    snippet: 'Generic preview without commerce evidence.',
    folders: ['INBOX'],
    attachments: [],
    ...overrides,
  };
}

test('full provider plain text is the canonical deterministic body, never the shorter snippet', () => {
  const input = normalizedEmailToDeterministicInput(email({
    bodyText: 'Thank you for your order. Order number: 123456. Total: 25.00 EUR.',
  }));
  assert.match(input.bodyText, /Order number: 123456/);
  assert.doesNotMatch(input.bodyText, /Generic preview/);

  const document = buildEmailDocumentV1(email({
    bodyText: 'Thank you for your order. Order number: 123456. Total: 25.00 EUR.',
  }));
  assert.match(document.text, /Order number: 123456/);
});

test('Gmail privacy gate can observe commerce proven only in the full plain body', () => {
  const decision = evaluateGmailDirectCandidate(email({
    subject: 'Status update',
    bodyText: 'We received your order. Order number: 654321. Total: 40.00 EUR.',
  }));
  assert.equal(decision.action, 'observe');
  assert.ok(['deterministic_commerce_match', 'universal_commerce_semantics'].includes(decision.reason));
});

test('named text attachments remain attachments and cannot inject content into the message body', () => {
  const normalized = normalizeGmailMessage({
    id: 'm-text-attachment',
    internalDate: '1788120000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'orders@shop.example' },
        { name: 'To', value: 'buyer@example.com' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: b64url('CURRENT BODY: order is processing.') },
        },
        {
          mimeType: 'text/plain',
          filename: 'old-message.txt',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="old-message.txt"' }],
          body: { attachmentId: 'att-text', data: b64url('INJECTED OLD BODY: delivered.') },
        },
      ],
    },
  });

  assert.equal(normalized.bodyText, 'CURRENT BODY: order is processing.');
  assert.equal(normalized.attachments.length, 1);
  assert.equal(normalized.attachments[0]?.id, 'att-text');
  assert.equal(normalized.attachments[0]?.filename, 'old-message.txt');
});
