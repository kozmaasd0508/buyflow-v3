import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  EVENTMIND_V11_MODEL_ID,
  EVENTMIND_V11_RUNTIME_PROTOCOL,
  EVENTMIND_V11_RUNTIME_VERSION,
  EVENTMIND_V11_TEMPLATE_VERSION,
  type EventMindV11RuntimeConfig,
} from './eventmind-v11-runtime.js';
import {
  EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS,
  EVENTMIND_V13_PROMPT_VERSION,
  EVENTMIND_V13_SOURCE_ID,
  EVENTMIND_V13_SOURCE_VERSION,
  buildEventMindPromptV13,
  runEventMindV13,
} from './eventmind-v13-candidate.js';

const ADAPTER_SHA = 'a'.repeat(64);

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
    receivedAt: '2026-09-02T12:00:00.000Z',
    folders: ['CATEGORY_PURCHASES'],
    attachments: [],
    bodyText: [
      'Your parcel is available at the pickup locker now.',
      '----- Original Message -----',
      'Old status: delivered.',
      'Internal candidate PURCHASE-SECRET-999.',
    ].join('\n'),
    ...overrides,
  };
}

function enabledConfig(overrides: Partial<Extract<EventMindV11RuntimeConfig, { enabled: true }>> = {}): Extract<EventMindV11RuntimeConfig, { enabled: true }> {
  return {
    enabled: true,
    endpoint: 'http://127.0.0.1:4394/v1/eventmind',
    expectedAdapterSha256: ADAPTER_SHA,
    expectedModelId: EVENTMIND_V11_MODEL_ID,
    expectedRuntimeVersion: EVENTMIND_V11_RUNTIME_VERSION,
    expectedTemplateVersion: EVENTMIND_V11_TEMPLATE_VERSION,
    timeoutMs: 1_000,
    ...overrides,
  };
}

function runtimePayload(output = '{"is_commerce":true,"event_type":"READY_FOR_PICKUP"}') {
  return {
    protocol_version: EVENTMIND_V11_RUNTIME_PROTOCOL,
    model_id: EVENTMIND_V11_MODEL_ID,
    adapter_sha256: ADAPTER_SHA,
    runtime_version: EVENTMIND_V11_RUNTIME_VERSION,
    template_version: EVENTMIND_V11_TEMPLATE_VERSION,
    thinking_enabled: false,
    deterministic: true,
    output,
  };
}

test('V13-lite prompt adds only REAL120-targeted distinctions and excludes identity data', () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  const prompt = buildEventMindPromptV13(document);

  for (const label of ['OTHER', 'SHIPPED', 'SHIPMENT_CREATED', 'READY_FOR_PICKUP', 'DELIVERED']) {
    assert.match(prompt, new RegExp(label));
  }
  assert.match(prompt, /BUYER-SIDE/i);
  assert.match(prompt, /mailbox owner is SENDING/i);
  assert.match(prompt, /READY_FOR_PICKUP.*not DELIVERED/i);
  assert.match(prompt, /handed to the carrier/i);
  assert.doesNotMatch(prompt, /provider-secret-123/);
  assert.doesNotMatch(prompt, /thread-secret-456/);
  assert.doesNotMatch(prompt, /PURCHASE-SECRET-999/);
});

test('V13-lite caps semantic text before the model prompt', () => {
  const oversized = 'A'.repeat(EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS + 5_000);
  const document = normalizeEmailDocumentV1(sourceEmail({ bodyText: oversized }));
  const prompt = buildEventMindPromptV13(document);
  const marker = 'EVENTMIND_EMAIL_VIEW:\n';
  const markerIndex = prompt.indexOf(marker);
  assert.notEqual(markerIndex, -1);
  const input = JSON.parse(prompt.slice(markerIndex + marker.length)) as {
    semanticText: string | null;
    semanticTextTruncated: boolean;
  };
  assert.equal(input.semanticText?.length, EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS);
  assert.equal(input.semanticTextTruncated, true);
});

test('V13-lite successful result keeps semantic-only authority and distinct provenance', async () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  const fetchImpl = (async () => new Response(JSON.stringify(runtimePayload()), { status: 200 })) as typeof fetch;
  const result = await runEventMindV13(document, enabledConfig(), fetchImpl);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.prediction.event_type, 'READY_FOR_PICKUP');
  assert.equal(result.override.semanticLabel, 'READY_FOR_PICKUP');
  assert.equal(result.override.sourceId, EVENTMIND_V13_SOURCE_ID);
  assert.equal(result.override.sourceVersion, EVENTMIND_V13_SOURCE_VERSION);
  assert.equal(result.runtime.promptVersion, EVENTMIND_V13_PROMPT_VERSION);
  assert.equal(result.runtime.attempts, 1);
  assert.equal('purchaseId' in result.override, false);
  assert.equal('trackingId' in result.override, false);
});

test('V13-lite uses one deterministic runtime attempt and does not retry HTTP failures', async () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  let calls = 0;
  let requestBody: any = null;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body));
    return new Response('{"ok":false}', { status: 503 });
  }) as typeof fetch;

  const result = await runEventMindV13(document, enabledConfig(), fetchImpl);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'RUNTIME_HTTP_ERROR');
  assert.equal(result.detail, 'HTTP 503');
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.deepEqual(requestBody.generation, {
    do_sample: false,
    enable_thinking: false,
    max_new_tokens: 48,
  });
});

test('V13-lite invalid model output remains a visible model-quality failure', async () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify(runtimePayload('{"is_commerce":true,"event_type":"PICKED_UP"}')), { status: 200 });
  }) as typeof fetch;

  const result = await runEventMindV13(document, enabledConfig(), fetchImpl);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'INVALID_MODEL_OUTPUT');
  assert.equal(result.detail, 'INVALID_VALUES');
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});
