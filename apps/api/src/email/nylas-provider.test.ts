import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailProvider } from './provider.js';
import type { NormalizedEmail, SearchMessagesPage } from './types.js';
import { normalizeNylasMessage } from './nylas-provider.js';
import {
  GMAIL_PURCHASES_QUERY,
  decideGmailPurchasesGate,
  isMessageInGmailPurchases,
} from '../ingestion/gmail-purchases-gate.js';

test('normalizes a Nylas message into the provider-neutral email contract', () => {
  const email = normalizeNylasMessage({
    id: 'msg_123',
    date: 1_700_000_000,
    threadId: 'thread_123',
    subject: 'Your order has shipped',
    from: [{ email: 'shop@example.com', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.com' }],
    snippet: 'Tracking number: ABC123',
    body: '<p>Tracking number: ABC123</p>',
    attachments: [
      {
        id: 'att_1',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 1234,
      },
    ],
  });

  assert.equal(email.provider, 'nylas');
  assert.equal(email.providerMessageId, 'msg_123');
  assert.equal(email.providerThreadId, 'thread_123');
  assert.equal(email.from[0]?.email, 'shop@example.com');
  assert.equal(email.attachments[0]?.filename, 'invoice.pdf');
  assert.equal(email.receivedAt, '2023-11-14T22:13:20.000Z');
});

function gateEmail(id: string): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: id,
    receivedAt: '2026-08-13T20:00:00.000Z',
    from: [],
    to: [],
    cc: [],
    bcc: [],
    folders: [],
    attachments: [],
  };
}

function providerWithPages(
  pages: SearchMessagesPage[],
  seen: Array<{ query: string; cursor?: string }>,
): EmailProvider {
  let index = 0;
  return {
    name: 'nylas',
    async searchMessages(input) {
      seen.push({
        query: input.query,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      });
      return pages[index++] ?? { messages: [] };
    },
    async getMessage() {
      throw new Error('getMessage must not be used by the purchases gate');
    },
  };
}

test('Gmail purchases gate finds the exact Nylas message id across pages', async () => {
  const seen: Array<{ query: string; cursor?: string }> = [];
  const provider = providerWithPages([
    { messages: [gateEmail('other')], nextCursor: 'next' },
    { messages: [gateEmail('target')] },
  ], seen);

  assert.equal(await isMessageInGmailPurchases(provider, 'target'), true);
  assert.deepEqual(seen, [
    { query: GMAIL_PURCHASES_QUERY },
    { query: GMAIL_PURCHASES_QUERY, cursor: 'next' },
  ]);
});

test('Gmail purchases gate rejects a message absent from category:purchases', async () => {
  const seen: Array<{ query: string; cursor?: string }> = [];
  const provider = providerWithPages([
    { messages: [gateEmail('other')] },
  ], seen);

  assert.equal(await isMessageInGmailPurchases(provider, 'target'), false);
  assert.equal(seen.length, 1);
});

test('Gmail purchases gate retries one categorization miss, then rejects the second', () => {
  assert.equal(decideGmailPurchasesGate(true, 1), 'pass');
  assert.equal(decideGmailPurchasesGate(false, 1), 'retry');
  assert.equal(decideGmailPurchasesGate(false, 2), 'reject');
});
