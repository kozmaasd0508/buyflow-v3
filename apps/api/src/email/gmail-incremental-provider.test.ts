import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GmailIncrementalEmailProvider,
  normalizeGmailMessage,
} from './gmail-incremental-provider.js';

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('normalizes Gmail full payload with plain/html bodies, headers and attachment metadata', () => {
  const message = normalizeGmailMessage({
    id: 'm1',
    threadId: 't1',
    internalDate: '1788120000000',
    labelIds: ['INBOX', 'CATEGORY_UPDATES'],
    snippet: 'snippet',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Order confirmed' },
        { name: 'From', value: 'Shop <orders@shop.example>' },
        { name: 'To', value: 'Buyer <buyer@example.com>' },
        { name: 'Authentication-Results', value: 'mx; dkim=pass header.d=shop.example' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('FULL PLAIN BODY') } },
        { mimeType: 'text/html', body: { data: b64url('<p>FULL HTML BODY</p>') } },
        {
          mimeType: 'application/pdf',
          filename: 'invoice.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment' }],
          body: { attachmentId: 'att-1', size: 321 },
        },
      ],
    },
  });

  assert.equal(message.provider, 'gmail');
  assert.equal(message.providerMessageId, 'm1');
  assert.equal(message.providerThreadId, 't1');
  assert.equal(message.subject, 'Order confirmed');
  assert.equal(message.from[0]?.email, 'orders@shop.example');
  assert.equal(message.bodyText, 'FULL PLAIN BODY');
  assert.equal(message.bodyHtml, '<p>FULL HTML BODY</p>');
  assert.deepEqual(message.folders, ['INBOX', 'CATEGORY_UPDATES']);
  assert.deepEqual(message.attachments, [{
    id: 'att-1',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 321,
  }]);
  assert.ok(message.headers.some((header) => header.name === 'Authentication-Results'));
});

test('direct Gmail provider exposes exact raw MIME and attachment bytes without logging token/content', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    if (url.includes('/messages/m1?format=raw')) {
      return jsonResponse({ id: 'm1', raw: b64url('From: a@example.com\r\n\r\nRAW MIME') });
    }
    if (url.includes('/messages/m1/attachments/att-1')) {
      return jsonResponse({ data: b64url(Buffer.from([1, 2, 3, 4])) });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  const provider = new GmailIncrementalEmailProvider({
    getAccessToken: () => 'secret-access-token',
    fetchImpl,
  });
  const raw = await provider.getRawMessage('m1');
  const attachment = await provider.downloadAttachment('m1', 'att-1');

  assert.equal(raw.toString('utf8'), 'From: a@example.com\r\n\r\nRAW MIME');
  assert.deepEqual([...attachment], [1, 2, 3, 4]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.authorization === 'Bearer secret-access-token'));
  assert.ok(calls.every((call) => !call.url.includes('secret-access-token')));
});

test('initial sync captures history cursor before snapshot and history changes are replayed safely', async () => {
  const operations: string[] = [];
  const fullMessage = (id: string, subject: string) => ({
    id,
    internalDate: '1788120000000',
    snippet: subject,
    labelIds: ['INBOX'],
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From', value: 'orders@shop.example' },
        { name: 'To', value: 'buyer@example.com' },
      ],
      body: { data: b64url(subject) },
    },
  });

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/users/me/profile')) {
      operations.push('profile');
      return jsonResponse({ historyId: '100' });
    }
    if (url.includes('/users/me/messages?')) {
      operations.push('list');
      return jsonResponse({ messages: [{ id: 'm1' }] });
    }
    if (url.includes('/users/me/messages/m1?format=full')) {
      operations.push('get:m1');
      return jsonResponse(fullMessage('m1', 'Initial order'));
    }
    if (url.includes('/users/me/history?')) {
      operations.push('history');
      assert.ok(url.includes('startHistoryId=100'));
      return jsonResponse({
        historyId: '105',
        history: [
          { id: '101', messagesAdded: [{ message: { id: 'm2' } }] },
          { id: '102', labelsAdded: [{ message: { id: 'm2' }, labelIds: ['STARRED'] }] },
          { id: '103', labelsRemoved: [{ message: { id: 'm3' }, labelIds: ['INBOX'] }] },
          { id: '104', messagesDeleted: [{ message: { id: 'm4' } }] },
        ],
      });
    }
    if (url.includes('/users/me/messages/m2?format=full')) {
      operations.push('get:m2');
      return jsonResponse(fullMessage('m2', 'New order'));
    }
    if (url.includes('/users/me/messages/m3?format=full')) {
      operations.push('get:m3');
      return jsonResponse(fullMessage('m3', 'Updated labels'));
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  const provider = new GmailIncrementalEmailProvider({
    getAccessToken: () => 'token',
    fetchImpl,
  });
  const initial = await provider.initialSync({ query: 'newer_than:30d', limit: 10 });
  assert.equal(initial.cursor.value, '100');
  assert.equal(initial.messages[0]?.providerMessageId, 'm1');
  assert.deepEqual(operations.slice(0, 3), ['profile', 'list', 'get:m1']);

  const changes = await provider.getChanges(initial.cursor);
  assert.equal(changes.resetRequired, false);
  assert.equal(changes.nextCursor.value, '105');
  const byId = new Map(changes.changes.map((change) => [change.providerMessageId, change]));
  assert.equal(byId.get('m2')?.kind, 'message_created');
  assert.equal(byId.get('m3')?.kind, 'message_updated');
  assert.equal(byId.get('m4')?.kind, 'message_deleted');
  assert.equal(byId.get('m2')?.message?.bodyText, 'New order');
});

test('expired Gmail history cursor requests reset instead of guessing a new cursor', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/users/me/history?')) return jsonResponse({ error: 'historyId too old' }, 404);
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  const provider = new GmailIncrementalEmailProvider({
    getAccessToken: () => 'token',
    fetchImpl,
  });
  const previous = { provider: 'gmail' as const, value: '99', observedAt: '2026-08-30T20:00:00.000Z' };
  const result = await provider.getChanges(previous);
  assert.equal(result.resetRequired, true);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.nextCursor, previous);
});

test('Gmail watch uses configured Pub/Sub topic and renews without granting write authority', async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    if (url.endsWith('/users/me/watch')) {
      return jsonResponse({ historyId: '200', expiration: '1788206400000' });
    }
    if (url.endsWith('/users/me/stop')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  const provider = new GmailIncrementalEmailProvider({
    getAccessToken: () => 'token',
    pubsubTopicName: 'projects/buyflow/topics/gmail',
    watchLabelIds: ['INBOX', 'INBOX'],
    fetchImpl,
  });
  const first = await provider.startWatch();
  assert.equal(first.providerPayload?.historyId, '200');
  assert.ok(first.expiresAt);
  const watchBody = JSON.parse(requests[0]?.body ?? '{}') as Record<string, unknown>;
  assert.equal(watchBody.topicName, 'projects/buyflow/topics/gmail');
  assert.deepEqual(watchBody.labelIds, ['INBOX']);
  assert.equal(watchBody.labelFilterBehavior, 'INCLUDE');

  await provider.renewWatch(first);
  await provider.stopWatch(first);
  assert.equal(requests.filter((request) => request.url.endsWith('/watch')).length, 2);
  assert.equal(requests.at(-1)?.url.endsWith('/stop'), true);
});
