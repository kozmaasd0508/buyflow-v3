import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import type { NormalizedEmail } from '../email/types.js';
import { EVENTMIND_EVENT_TYPES } from './eventmind-v1.js';
import {
  buildEventMindV14Messages,
  EVENTMIND_V14_MAX_SEMANTIC_TEXT_CHARS,
  EVENTMIND_V14_SYSTEM_PROMPT,
} from './eventmind-v14-zero-shot.js';

function sourceEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'gmail',
    providerMessageId: 'provider-secret-123',
    providerThreadId: 'thread-secret-456',
    subject: 'Package update',
    from: [{ email: 'shipping@shop.example', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-09-04T12:00:00.000Z',
    folders: ['CATEGORY_PURCHASES'],
    attachments: [],
    bodyText: [
      'Your parcel is now available at the pickup locker.',
      '----- Original Message -----',
      'Old state: delivered.',
      'Internal candidate PURCHASE-SECRET-999.',
    ].join('\n'),
    ...overrides,
  };
}

test('V14 gives explicit definitions for every legal event', () => {
  for (const eventType of EVENTMIND_EVENT_TYPES) {
    assert.match(EVENTMIND_V14_SYSTEM_PROMPT, new RegExp(`\\b${eventType}\\b`));
  }
  assert.match(EVENTMIND_V14_SYSTEM_PROMPT, /tracking number alone never proves SHIPPED/i);
  assert.match(EVENTMIND_V14_SYSTEM_PROMPT, /available in locker\/pickup point -> READY_FOR_PICKUP/i);
  assert.match(EVENTMIND_V14_SYSTEM_PROMPT, /Refund request received\/discussed -> OTHER/i);
  assert.match(EVENTMIND_V14_SYSTEM_PROMPT, /mailbox owner is SENDING as a merchant are OTHER/i);
});

test('V14 keeps system instructions separate from the email user message', () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  const messages = buildEventMindV14Messages(document);
  assert.equal(messages.system, EVENTMIND_V14_SYSTEM_PROMPT);
  assert.match(messages.user, /^Classify this MailLens EventMind email view/);
  assert.match(messages.user, /EVENTMIND_EMAIL_VIEW:/);
  assert.doesNotMatch(messages.user, /EVENT DEFINITIONS/);
});

test('V14 input still excludes provider/internal identity fields', () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  const messages = buildEventMindV14Messages(document);
  assert.doesNotMatch(messages.user, /provider-secret-123/);
  assert.doesNotMatch(messages.user, /thread-secret-456/);
  assert.doesNotMatch(messages.user, /PURCHASE-SECRET-999/);
});

test('V14 caps semanticText without changing the model-facing contract', () => {
  const oversized = 'A'.repeat(EVENTMIND_V14_MAX_SEMANTIC_TEXT_CHARS + 5_000);
  const document = normalizeEmailDocumentV1(sourceEmail({ bodyText: oversized }));
  const messages = buildEventMindV14Messages(document);
  const marker = 'EVENTMIND_EMAIL_VIEW:\n';
  const index = messages.user.indexOf(marker);
  assert.notEqual(index, -1);
  const input = JSON.parse(messages.user.slice(index + marker.length)) as {
    semanticText: string | null;
    semanticTextTruncated: boolean;
  };
  assert.equal(input.semanticText?.length, EVENTMIND_V14_MAX_SEMANTIC_TEXT_CHARS);
  assert.equal(input.semanticTextTruncated, true);
});
