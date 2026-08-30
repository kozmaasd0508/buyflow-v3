import assert from 'node:assert/strict';
import test from 'node:test';
import { upgradeNormalizedEmailToDocumentV1 } from './document-v1.js';
import type { NormalizedEmail } from './types.js';

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: overrides.provider ?? 'gmail',
    providerMessageId: overrides.providerMessageId ?? 'msg-1',
    providerThreadId: overrides.providerThreadId,
    subject: overrides.subject,
    from: overrides.from ?? [{ email: 'merchant@example.com' }],
    to: overrides.to ?? [{ email: 'buyer@example.com' }],
    cc: overrides.cc ?? [],
    bcc: overrides.bcc ?? [],
    receivedAt: overrides.receivedAt ?? '2026-08-30T18:00:00.000Z',
    snippet: overrides.snippet,
    bodyHtml: overrides.bodyHtml,
    headers: overrides.headers,
    folders: overrides.folders ?? ['INBOX'],
    attachments: overrides.attachments ?? [],
  };
}

test('upgrades the legacy normalized email without inventing unavailable evidence', () => {
  const document = upgradeNormalizedEmailToDocumentV1(email({ subject: 'Order received' }));

  assert.equal(document.schemaVersion, '1');
  assert.equal(document.subject, 'Order received');
  assert.equal(document.bodyText, null);
  assert.deepEqual(document.structuredData, []);
  assert.deepEqual(document.links, []);
  assert.equal(document.authentication.dkim, 'unknown');
  assert.equal(document.authentication.spf, 'unknown');
  assert.equal(document.authentication.dmarc, 'unknown');
  assert.equal(document.rawRef, null);
});

test('preserves supplied raw-source, structured-data and trace provenance', () => {
  const document = upgradeNormalizedEmailToDocumentV1(email(), {
    bodyText: 'Order #12345',
    structuredData: [
      {
        kind: 'json_ld',
        schemaType: 'Order',
        payload: { orderNumber: '12345' },
        source: 'body_html',
      },
    ],
    authentication: { dkim: 'pass', spf: 'pass', dmarc: 'pass' },
    rawRef: {
      objectKey: 'raw/user/message.eml',
      sha256: 'a'.repeat(64),
      sizeBytes: 1234,
      contentType: 'message/rfc822',
      retainedUntil: null,
    },
    normalizerVersion: 'email-document-v1.0.0',
    traceId: '00000000-0000-4000-8000-000000000001',
  });

  assert.equal(document.bodyText, 'Order #12345');
  assert.equal(document.structuredData[0]?.schemaType, 'Order');
  assert.equal(document.authentication.dkim, 'pass');
  assert.equal(document.rawRef?.sha256.length, 64);
  assert.equal(document.normalizerVersion, 'email-document-v1.0.0');
  assert.equal(document.traceId, '00000000-0000-4000-8000-000000000001');
});
