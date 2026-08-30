import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  archiveNormalizedEmailSourceV1,
  type EmailArchiveObjectStore,
  type EmailArchivePutInput,
} from './source-archive-v1.js';
import type { NormalizedEmail } from './types.js';

class MemoryImmutableStore implements EmailArchiveObjectStore {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string; sha256: string }>();

  async putImmutable(input: EmailArchivePutInput): Promise<void> {
    const bytes = Buffer.from(input.bytes);
    const existing = this.objects.get(input.objectKey);
    if (existing) {
      assert.equal(existing.sha256, input.sha256, 'same immutable key must keep the same hash');
      assert.deepEqual(existing.bytes, bytes, 'same immutable key must keep the same bytes');
      return;
    }
    this.objects.set(input.objectKey, {
      bytes,
      contentType: input.contentType,
      sha256: input.sha256,
    });
  }
}

function email(): NormalizedEmail {
  return {
    provider: 'mailgun',
    providerMessageId: '<private-provider-message-id@example.com>',
    subject: 'Order #A-42',
    from: [{ email: 'orders@shop.example' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-30T20:00:00.000Z',
    bodyText: 'Order A-42 confirmed. https://shop.example/orders/A-42',
    bodyHtml: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Order","orderNumber":"A-42"}</script><p>Order A-42 confirmed.</p>',
    headers: [{ name: 'Authentication-Results', value: 'mx; dkim=pass; spf=pass; dmarc=pass' }],
    folders: ['inbound'],
    attachments: [],
  };
}

test('archives immutable raw MIME plus normalized document with opaque content-addressed keys', async () => {
  const store = new MemoryImmutableStore();
  const raw = Buffer.from('From: orders@shop.example\r\nSubject: Order A-42\r\n\r\nhello', 'utf8');
  const result = await archiveNormalizedEmailSourceV1({
    userId: '11111111-1111-4111-8111-111111111111',
    emailConnectionId: '22222222-2222-4222-8222-222222222222',
    email: email(),
    store,
    rawSource: {
      bytes: raw,
      contentType: 'message/rfc822',
      retainedUntil: '2027-08-30T20:00:00.000Z',
    },
  });

  assert.equal(store.objects.size, 2);
  assert.equal(result.rawRef?.sha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.rawRef?.sizeBytes, raw.byteLength);
  assert.equal(result.rawRef?.contentType, 'message/rfc822');
  assert.equal(result.document.rawRef?.objectKey, result.rawRef?.objectKey);
  assert.equal(result.document.authentication.dkim, 'pass');
  assert.equal(result.document.structuredData[0]?.schemaType, 'Order');
  assert.ok(result.normalizedRef.objectKey.endsWith(`${result.normalizedRef.sha256}.json`));

  for (const key of store.objects.keys()) {
    assert.equal(key.includes('private-provider-message-id'), false);
    assert.equal(key.includes('11111111-1111-4111-8111-111111111111'), false);
    assert.equal(key.includes('22222222-2222-4222-8222-222222222222'), false);
  }
});

test('same source is retry-idempotent with deterministic trace and normalized hash', async () => {
  const store = new MemoryImmutableStore();
  const input = {
    userId: '11111111-1111-4111-8111-111111111111',
    emailConnectionId: '22222222-2222-4222-8222-222222222222',
    email: email(),
    store,
  };

  const first = await archiveNormalizedEmailSourceV1(input);
  const second = await archiveNormalizedEmailSourceV1(input);
  assert.equal(first.traceId, second.traceId);
  assert.equal(first.normalizedRef.sha256, second.normalizedRef.sha256);
  assert.equal(first.normalizedRef.objectKey, second.normalizedRef.objectKey);
  assert.equal(store.objects.size, 1);
  assert.equal(first.rawRef, null);
});

test('invalid retention timestamp fails before a raw reference can be trusted', async () => {
  const store = new MemoryImmutableStore();
  await assert.rejects(
    archiveNormalizedEmailSourceV1({
      userId: 'u',
      emailConnectionId: 'c',
      email: email(),
      store,
      rawSource: { bytes: Buffer.from('raw'), retainedUntil: 'not-a-date' },
    }),
    /valid timestamp/,
  );
});
