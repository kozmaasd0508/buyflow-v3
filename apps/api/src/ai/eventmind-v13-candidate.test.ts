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

test('V13 prompt enumerates the taxonomy and hard lifecycle distinctions without identity data', () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  const prompt = buildEventMindPromptV13(document);

  for (const label of ['OTHER', 'SHIPPED', 'SHIPMENT_CREATED', 'READY_FOR_PICKUP', 'DELIVERED']) {
    assert.match(prompt, new RegExp(label));
  }
  assert.match(prompt, /mailbox owner is the buyer/i);
  assert.match(prompt, /goods the mailbox owner is SENDING/i);
  assert.match(prompt, /READY_FOR_PICKUP.*NOT DELIVERED/i);
  assert.match(prompt, /tracking\/pre-advice.*NOT physically received/i);
  assert.match(prompt, /handed to the carrier/i);
  assert.doesNotMatch(prompt, /provider-secret-123/);
  assert.doesNotMatch(prompt, /thread-secret-456/);
  assert.doesNotMatch(prompt, /PURCHASE-SECRET-999/);
});

test('V13 successful result keeps semantic-only authority and distinct provenance', async () => {
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

test('V13 retries only transient HTTP failures and preserves deterministic request settings', async () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  let calls = 0;
  let requestBody: any = null;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body));
    if (calls < 3) return new Response('{"ok":false}', { status: 503 });
    return new Response(JSON.stringify(runtimePayload()), { status: 200 });
  }) as typeof fetch;

  const result = await runEventMindV13(document, enabledConfig(), fetchImpl);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.runtime.attempts, 3);
  assert.equal(calls, 3);
  assert.deepEqual(requestBody.generation, {
    do_sample: false,
    enable_thinking: false,
    max_new_tokens: 48,
  });
});

test('V13 does not retry invalid model output because that is a model-quality failure', async () => {
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
