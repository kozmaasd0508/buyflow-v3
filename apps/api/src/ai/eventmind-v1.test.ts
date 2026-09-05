import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  EVENTMIND_EVENT_TYPES,
  buildEventMindInputV1,
  buildEventMindPromptV1,
  decodeEventMindPredictionV1,
  eventMindSemanticOverrideFromV1,
} from './eventmind-v1.js';

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'gmail',
    providerMessageId: 'provider-message-secret-123',
    providerThreadId: 'thread-secret-456',
    subject: 'Your package is moving',
    from: [{ email: 'shipping@shop.example', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-09-02T10:00:00.000Z',
    snippet: 'STALE DELIVERED SNIPPET',
    folders: ['CATEGORY_PURCHASES', 'INBOX'],
    attachments: [{
      id: 'attachment-secret-id',
      filename: 'invoice-INV-SECRET-77.html',
      contentType: 'text/html',
    }],
    headers: [{
      name: 'Authentication-Results',
      value: 'mx.example; dkim=pass header.d=shop.example',
    }],
    ...overrides,
  };
}

test('EventMind input is a MailLens-only semantic projection with no raw/provider/Purchase identity channel', () => {
  const source = email({
    bodyText: [
      'Current status: your package is in transit.',
      '----- Original Message -----',
      'Old status: delivered yesterday.',
      'Internal purchase candidate: PURCHASE-SECRET-999.',
    ].join('\n'),
    bodyHtml: `
      <script type="application/ld+json">
        {
          "@context":"https://schema.org",
          "@type":"ParcelDelivery",
          "trackingNumber":"TRACK-SECRET-123",
          "trackingStatus":"IN_TRANSIT",
          "url":"https://shop.example/track/TRACK-SECRET-123",
          "partOfOrder":{
            "@type":"Order",
            "orderNumber":"ORDER-SECRET-456",
            "orderStatus":"ORDER_PROCESSING"
          }
        }
      </script>
      <p>Visible HTML should not bypass provider plain text.</p>
    `,
  });

  const document = normalizeEmailDocumentV1(source, {
    traceId: 'trace-secret-789',
    rawRef: {
      objectKey: 'raw/secret-message.eml',
      sha256: 'a'.repeat(64),
      sizeBytes: 1234,
      contentType: 'message/rfc822',
      retainedUntil: '2026-10-02T10:00:00.000Z',
    },
  });
  const input = buildEventMindInputV1(document);
  const serialized = JSON.stringify(input);
  const prompt = buildEventMindPromptV1(input);

  assert.deepEqual(Object.keys(input).sort(), [
    'from',
    'quotedHistoryDetected',
    'receivedAt',
    'semanticText',
    'semanticTextTruncated',
    'structuredData',
    'subject',
    'viewVersion',
  ]);
  assert.match(input.semanticText ?? '', /in transit/i);
  assert.doesNotMatch(input.semanticText ?? '', /delivered yesterday/i);
  assert.equal(input.quotedHistoryDetected, true);

  for (const forbidden of [
    'provider-message-secret-123',
    'thread-secret-456',
    'STALE DELIVERED SNIPPET',
    'PURCHASE-SECRET-999',
    'TRACK-SECRET-123',
    'ORDER-SECRET-456',
    'INV-SECRET-77',
    'attachment-secret-id',
    'trace-secret-789',
    'raw/secret-message.eml',
    'Authentication-Results',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(prompt, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(serialized, /trackingStatus/);
  assert.match(serialized, /IN_TRANSIT/);
  assert.match(serialized, /orderStatus/);
  assert.match(serialized, /ORDER_PROCESSING/);
});

test('EventMind exposes exactly the locked 18-event taxonomy', () => {
  assert.equal(EVENTMIND_EVENT_TYPES.length, 18);
  assert.deepEqual(EVENTMIND_EVENT_TYPES, [
    'ORDER_CREATED',
    'ORDER_PROCESSING',
    'ORDER_PACKING',
    'SHIPMENT_CREATED',
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'READY_FOR_PICKUP',
    'DELIVERED',
    'DELIVERY_FAILED',
    'DELAYED',
    'CANCELLED',
    'REFUNDED',
    'PAYMENT',
    'INVOICE',
    'RETURN',
    'WARRANTY',
    'OTHER',
  ]);
});

test('EventMind decoder is fail-closed on extra identity fields, invalid labels and commerce mismatch', () => {
  assert.deepEqual(
    decodeEventMindPredictionV1('{"is_commerce":true,"event_type":"SHIPPED","purchase_id":"p-1"}'),
    { ok: false, reason: 'INVALID_SCHEMA' },
  );
  assert.deepEqual(
    decodeEventMindPredictionV1('{"is_commerce":true,"event_type":"NOT_A_REAL_EVENT"}'),
    { ok: false, reason: 'INVALID_VALUES' },
  );
  assert.deepEqual(
    decodeEventMindPredictionV1('{"is_commerce":true,"event_type":"OTHER"}'),
    { ok: false, reason: 'COMMERCE_INVARIANT_MISMATCH' },
  );
  assert.deepEqual(
    decodeEventMindPredictionV1('not-json'),
    { ok: false, reason: 'INVALID_JSON' },
  );
});

test('decoded V11 semantics can change only the semantic event override, never identity', () => {
  const decoded = decodeEventMindPredictionV1('{"is_commerce":true,"event_type":"SHIPPED"}');
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;

  const semantic = eventMindSemanticOverrideFromV1(decoded.prediction);
  assert.equal(semantic.ok, true);
  if (!semantic.ok) return;

  assert.deepEqual(Object.keys(semantic.override).sort(), [
    'eventType',
    'semanticLabel',
    'sourceId',
    'sourceVersion',
  ]);
  assert.deepEqual(semantic.override, {
    eventType: 'shipment_created',
    semanticLabel: 'SHIPPED',
    sourceId: 'qwen3-8b-buyflow-v11',
    sourceVersion: 'eventmind-decoder-v1',
  });
  assert.equal('purchaseId' in semantic.override, false);
  assert.equal('orderId' in semantic.override, false);
  assert.equal('trackingId' in semantic.override, false);
});
